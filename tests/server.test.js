import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

let child;
let base;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CONFIG_FILE: path.join(ROOT, '.env.example') },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      await fetch(base + '/');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('server did not start');
});

after(() => child?.kill());

describe('api: static site', () => {
  test('serves the page at / with 200', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /RADDAR/);
    assert.match(html, /NOT RAD/);
  });

  test('serves the manifest as a standalone app named Raddar', async () => {
    const res = await fetch(base + '/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /manifest\+json/);
    const m = await res.json();
    assert.equal(m.display, 'standalone');
    assert.equal(m.short_name, 'Raddar');
  });

  test('serves the logic module as javascript', async () => {
    const res = await fetch(base + '/logic.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  });

  test('serves every icon the page and manifest reference as png', async () => {
    for (const p of ['/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('content-type'), 'image/png');
    }
  });

  test('answers 404 for missing files', async () => {
    const res = await fetch(base + '/nope.html');
    assert.equal(res.status, 404);
  });

  test('does not serve files outside public/', async () => {
    const res = await fetch(base + '/..%2fpackage.json');
    assert.equal(res.status, 404);
  });
});
