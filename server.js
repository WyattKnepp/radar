// Tiny static file server for public/. No dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// Display strings come from .env (private) or .env.example (the default).
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATED = new Set(['index.html', 'manifest.webmanifest']);
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function loadConfig() {
  let text;
  try {
    text = await readFile(process.env.CONFIG_FILE || path.join(APP_DIR, '.env'), 'utf8');
  } catch {
    text = await readFile(path.join(APP_DIR, '.env.example'), 'utf8');
  }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return { appName: env.VAR_TITLE || 'Radar', labels: { rad: env.VAR_A || 'A', notRad: env.VAR_B || 'B' } };
}

async function render(text) {
  const cfg = await loadConfig();
  const values = {
    appName: cfg.appName,
    appNameUpper: cfg.appName.toUpperCase(),
    labelNotRadUpper: cfg.labels.notRad.toUpperCase(),
    labelRadUpper: cfg.labels.rad.toUpperCase(),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(values[k] ?? ''));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(await loadConfig()));
    return;
  }
  try {
    let body = await readFile(file);
    if (TEMPLATED.has(path.basename(file))) body = await render(body.toString('utf8'));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`radar listening on http://${HOST}:${PORT}`);
});
