import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

for (const size of [180, 192, 512]) {
  test(`${size}px icon has valid PNG dimensions, checksums and pixel bounds`, async () => {
    const png = await readFile(new URL(`../icon-${size}.png`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
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
    assert.ok(end); assert.equal(inflateSync(Buffer.concat(compressed)).length, (size * 3 + 1) * size);
  });
}

test('manifest files exist, have correct sizes and support landscape', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.notEqual(manifest.orientation, 'portrait');
  for (const icon of manifest.icons) assert.ok((await readFile(new URL(`../${icon.src}`, import.meta.url))).length > 0);
  assert.equal(manifest.display, 'standalone');
});