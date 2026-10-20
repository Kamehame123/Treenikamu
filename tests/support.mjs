import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prefer pinned local dev dependencies. PW_DIR remains an explicit override.
let require = createRequire(import.meta.url);
if (process.env.PW_DIR) require = createRequire(join(process.env.PW_DIR, 'loader.cjs'));
else {
  try { require.resolve('playwright'); }
  catch { require = createRequire(join(tmpdir(), 'pwtest', 'loader.cjs')); }
}
export const { chromium, webkit, devices } = require('playwright');
export const AxeBuilder = require('@axe-core/playwright').default;
export const root = fileURLToPath(new URL('../', import.meta.url));

export async function tap(locator) {
  await locator.click();
  await locator.page().waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') !== 'true');
}

export async function startServer() {
  const port = 24000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['tools/serve.mjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  server.stderr.on('data', (s) => { stderr += s; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.kill(); reject(new Error(`Server not ready: ${stderr}`)); }, 10000);
    server.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    server.once('error', (e) => { clearTimeout(timeout); reject(e); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${stderr}`)); });
  });
  return { server, url: `http://localhost:${port}/` };
}