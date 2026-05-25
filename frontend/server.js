// ============================================================
// Tiny static server for the Yahweh Care frontend
//
// Run:   node server.js
// Visit: http://localhost:4000
//
// Microsoft SSO needs the frontend served over HTTP (not file://)
// because cookies don't work on the file:// scheme.
// ============================================================

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // SPA-ish fallback — anything without an extension falls back to index.html
  if (!path.extname(urlPath)) urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  // Block path-traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found: ' + urlPath);
    }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`✓ Yahweh Care frontend running at http://localhost:${PORT}`);
  console.log(`  HRMS backend expected at http://localhost:4002`);
});
