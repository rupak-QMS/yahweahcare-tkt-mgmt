#!/usr/bin/env node
/**
 * build.js — Yahwehcare frontend compiler
 *
 * Steps:
 *  1. Compile src/app-source.jsx  → app.js  (Babel JSX → JS, then Terser minify)
 *  2. Compile enterprise-components.js → enterprise-components-compiled.js
 *
 * React + ReactDOM are loaded from jsDelivr CDN (pinned to 18.3.1) — no download step needed.
 *
 * Run:  node build.js
 * Vercel runs this automatically via the "build" script in package.json.
 */

const fs    = require('fs');
const path  = require('path');
const babel = require('@babel/core');
const { minify } = require('terser');

const DIR = __dirname;

async function terserMinify(code) {
  const result = await minify(code, {
    compress: { drop_console: false, passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  return result.code;
}

async function main() {

// ── 1. Compile src/app-source.jsx ────────────────────────────────────────────
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

// ── 2. Compile enterprise-components.js ──────────────────────────────────────
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

// ── 3. Minify with Terser ─────────────────────────────────────────────────────
console.log('[build] Minifying app.js…');
const minifiedApp = await terserMinify(compiled.code);
const appJs = `/* Yahwehcare build:${Date.now()} */\n${minifiedApp}`;
fs.writeFileSync(path.join(DIR, 'app.js'), appJs);
console.log(`[build] app.js written (${Math.round(appJs.length / 1024)}KB, was ${Math.round(compiled.code.length / 1024)}KB)`);

console.log('[build] Minifying enterprise-components-compiled.js…');
const minifiedEc = await terserMinify(ecCompiled.code);
const ecJs = `/* ec build:${Date.now()} */\n${minifiedEc}`;
fs.writeFileSync(path.join(DIR, 'enterprise-components-compiled.js'), ecJs);
console.log(`[build] enterprise-components-compiled.js written (${Math.round(ecJs.length / 1024)}KB)`);

console.log('[build] Done ✓');

} // end main()
main().catch(err => { console.error('[build] Fatal:', err); process.exit(1); });
