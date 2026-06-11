#!/usr/bin/env node
/**
 * build.js — Yahwehcare frontend pre-compiler
 *
 * What it does:
 *  1. Extracts the inline <script type="text/babel"> block from index.html
 *  2. Compiles the JSX with @babel/core + @babel/preset-react
 *  3. Writes app.js  (compiled, cache-busted with a hash comment)
 *  4. Compiles enterprise-components.js → enterprise-components-compiled.js
 *  5. Rewrites index.html so it:
 *       • drops @babel/standalone
 *       • drops the inline text/babel block
 *       • loads app.js + enterprise-components-compiled.js instead
 *       • removes XLSX from <head> (lazy-loaded on export click)
 *       • adds resource hints (preconnect / dns-prefetch)
 *
 * Run:  node build.js
 * Vercel runs this automatically via package.json "build" script.
 */

const fs   = require('fs');
const path = require('path');
const babel = require('@babel/core');

const DIR = __dirname;

// ── 1. Compile src/app-source.jsx ────────────────────────────────────────────
// Source lives in src/app-source.jsx so build.js is idempotent (can re-run freely).
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

const appJs = `/* Yahwehcare — compiled ${new Date().toISOString()} */\n${compiled.code}\n`;
fs.writeFileSync(path.join(DIR, 'app.js'), appJs);
console.log(`[build] app.js written (${Math.round(appJs.length / 1024)}KB)`);

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
const ecJs = `/* enterprise-components — compiled ${new Date().toISOString()} */\n${ecCompiled.code}\n`;
fs.writeFileSync(path.join(DIR, 'enterprise-components-compiled.js'), ecJs);
console.log(`[build] enterprise-components-compiled.js written (${Math.round(ecJs.length / 1024)}KB)`);

// index.html is pre-patched (committed) — no HTML rewriting needed on each build.
console.log('[build] Done ✓');
