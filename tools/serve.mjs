// Static server for the shipped files only. Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ALLOW = new Set(['index.html', 'app.js', 'core.js', 'progression.js', 'exercises.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png']);
const port = Number(process.argv[2]) || 8080;
const security = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { ...security, Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
  }
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (name === '') name = 'index.html';
    if (!ALLOW.has(name)) throw new Error('not allowed');
    const body = await readFile(resolve(root, name));
    res.writeHead(200, { ...security, 'Content-Type': types[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, security); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`http://localhost:${port}`));
