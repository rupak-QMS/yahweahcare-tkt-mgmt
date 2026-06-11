#!/usr/bin/env node
/**
 * build.js — Yahwehcare frontend compiler
 *
 * Steps:
 *  1. Download React + ReactDOM (self-host for 1-year cache from our own CDN edge)
 *  2. Compile src/app-source.jsx  → app.js  (Babel JSX → JS)
 *  3. Compile enterprise-components.js → enterprise-components-compiled.js
 *  4. Minify app.js + enterprise-components with Terser
 *
 * Run:  node build.js
 * Vercel runs this automatically via the "build" script in package.json.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const babel = require('@babel/core');
const { minify } = require('terser');

const DIR = __dirname;

// ── helpers ──────────────────────────────────────────────────────────────────
function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
      console.log(`[build] ${path.basename(dest)} already exists — skipping download`);
      return resolve();
    }
    console.log(`[build] Downloading ${path.basename(dest)}…`);
    const file = fs.createWriteStream(dest);
    function get(u) {
      https.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) { file.close(); return download(res.headers.location, dest).then(resolve).catch(reject); }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    }
    get(url);
  });
}

async function terserMinify(code, filename) {
  const result = await minify(code, {
    compress: { drop_console: false, passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  return result.code;
}

async function main() {

// ── 1. Self-host React + ReactDOM ─────────────────────────────────────────────
// Downloaded once; served with max-age=31536000 from our Vercel edge.
await Promise.all([
  download('https://unpkg.com/react@18/umd/react.production.min.js',      path.join(DIR, 'react.production.min.js')),
  download('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', path.join(DIR, 'react-dom.production.min.js')),
]).catch(err => console.warn('[build] React download failed (offline?), using CDN fallback:', err.message));

// ── 2. Compile src/app-source.jsx ─────────────────────────────────────────────
const jsxSource = fs.readFileSync(path.join(DIR, 'src', 'app-source.jsx'), 'utf8');
console.log(`[build] Compiling src/app-source.jsx (${Math.round(jsxSource.length / 1024)}KB)…`);

let compiled;
try {
  compiled = babel.transformSync(jsxSource, {
    presets: ['@babel/preset-react'],
    filename: 'app.jsx',
    comments: false,
    compact: false,
  });
} catch (err) {
  console.error('[build] Babel error:', err.message);
  process.exit(1);
}

// ── 3. Compile enterprise-components.js ───────────────────────────────────────
const ecSrc = fs.readFileSync(path.join(DIR, 'enterprise-components.js'), 'utf8');
console.log(`[build] Compiling enterprise-components.js (${Math.round(ecSrc.length / 1024)}KB)…`);
let ecCompiled;
try {
  ecCompiled = babel.transformSync(ecSrc, {
    presets: ['@babel/preset-react'],
    filename: 'enterprise-components.jsx',
    comments: false,
    compact: false,
  });
} catch (err) {
  console.error('[build] Babel error (enterprise-components):', err.message);
  process.exit(1);
}

// ── 4. Minify with Terser ──────────────────────────────────────────────────────
console.log('[build] Minifying app.js…');
const minifiedApp = await terserMinify(compiled.code, 'app.js');
const appJs = `/* Yahwehcare build:${Date.now()} */\n${minifiedApp}`;
fs.writeFileSync(path.join(DIR, 'app.js'), appJs);
console.log(`[build] app.js written (${Math.round(appJs.length / 1024)}KB, was ${Math.round(compiled.code.length / 1024)}KB)`);

console.log('[build] Minifying enterprise-components-compiled.js…');
const minifiedEc = await terserMinify(ecCompiled.code, 'enterprise-components.jsx');
const ecJs = `/* ec build:${Date.now()} */\n${minifiedEc}`;
fs.writeFileSync(path.join(DIR, 'enterprise-components-compiled.js'), ecJs);
console.log(`[build] enterprise-components-compiled.js written (${Math.round(ecJs.length / 1024)}KB)`);

console.log('[build] Done ✓');

} // end main()
main().catch(err => { console.error('[build] Fatal:', err); process.exit(1); });
