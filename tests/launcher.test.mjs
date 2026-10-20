import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('launcher replaces only Tracker, leaves unrelated node processes alive', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const launcher = fileURLToPath(new URL('../tools/launch.ps1', import.meta.url));
  const port = 46000 + Math.floor(Math.random() * 1000);
  const processes = [];
  const decoy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', 'C:/another-project/tools/serve.mjs']);
  processes.push(decoy);
  function launch() {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Port', String(port), '-NoBrowser'], { stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child);
    return child;
  }
  async function ready(child) {
    let output = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Launcher timeout: ${output}`)), 30000);
      child.stdout.on('data', (part) => {
        output += part;
        if (output.includes(`http://localhost:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', (part) => { output += part; });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Launcher exited ${code}: ${output}`)); });
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch { /* A failed connection yields before the next attempt. */ }
    }
    throw new Error('Server never became ready');
  }
  try {
    const first = launch(); await ready(first);
    const firstStopped = new Promise((resolve) => first.once('exit', resolve));
    const second = launch(); await ready(second);
    await firstStopped;
    assert.equal(decoy.exitCode, null, 'unrelated node process was not killed');
    assert.equal((await fetch(`http://localhost:${port}/`)).status, 200);
    assert.equal(second.exitCode, null);
  } finally {
    for (const child of processes.reverse()) {
      if (child.exitCode === null) {
        try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already stopped. */ }
      }
    }
  }
});

test('launcher refuses a port owned by another app without stopping it', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const launcher = fileURLToPath(new URL('../tools/launch.ps1', import.meta.url));
  const foreign = spawn(process.execPath, ['-e', 'const s = require("node:http").createServer((q,r)=>r.end("other app")); s.listen(0,()=>console.log("TRACKER_TEST_PORT="+s.address().port));']);
  let child;
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Foreign server did not start: ${output}`)), 10000);
      foreign.stdout.on('data', (part) => {
        output += part;
        const found = /TRACKER_TEST_PORT=(\d+)\r?\n/.exec(output);
        if (found) { clearTimeout(timer); resolve(Number(found[1])); }
      });
      foreign.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Port', String(port), '-NoBrowser']);
    let output = '';
    child.stdout.on('data', (part) => { output += part; });
    child.stderr.on('data', (part) => { output += part; });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Launcher failed to reject an occupied port')), 25000);
      child.once('close', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(code, 1, output);
    assert.match(output, /belongs to another program/);
    assert.equal(foreign.exitCode, null);
    assert.equal(await (await fetch(`http://localhost:${port}/`)).text(), 'other app');
  } finally {
    for (const owned of [child, foreign]) if (owned && owned.exitCode === null) {
      try { execFileSync('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already stopped. */ }
    }
  }
});