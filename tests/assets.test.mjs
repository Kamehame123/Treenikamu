import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

for (const size of [180, 192, 512, 'maskable-512']) {
  const px = parseInt(String(size).replace('maskable-', ''), 10);
  test(`${size}px icon has valid PNG dimensions, checksums and pixel bounds`, async () => {
    const png = await readFile(new URL(`../icon-${size}.png`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), px); assert.equal(png.readUInt32BE(20), px);
    const compressed = [];
    let end = false;
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      const bytes = png.subarray(offset + 4, offset + 8 + length);
      assert.equal(bytes.length, length + 4);
      let crc = 0xffffffff;
      for (const b of bytes) {
        crc ^= b;
        for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      assert.equal((~crc) >>> 0, png.readUInt32BE(offset + 8 + length));
      const type = bytes.toString('ascii', 0, 4);
      if (type === 'IDAT') compressed.push(bytes.subarray(4));
      if (type === 'IEND') end = true;
      offset += length + 12;
    }
    assert.ok(end); assert.equal(inflateSync(Buffer.concat(compressed)).length, (px * 3 + 1) * px);
  });
}

test('manifest supports full-screen icon launch and landscape without changing app identity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.notEqual(manifest.orientation, 'portrait');
  for (const icon of manifest.icons) assert.ok((await readFile(new URL(`../${icon.src}`, import.meta.url))).length > 0);
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('page ships its own Content-Security-Policy and the service worker caches every icon', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'self'[^"]*">/);
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  for (const icon of manifest.icons) assert.ok(worker.includes(`'./${icon.src}'`), icon.src);
});

test('iOS home-screen launch retains app-capable metadata and safe-area support', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});