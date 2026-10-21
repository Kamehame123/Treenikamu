// Browser acceptance checks. Development-only dependencies are resolved by support.mjs.
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit, devices, AxeBuilder, startServer, tap, tapConfirm, openSettings } from './support.mjs';

const shots = join(tmpdir(), 'tracker-shots'); mkdirSync(shots, { recursive: true });
const { server, url } = await startServer();
let failed = 0, passed = 0;
function check(ok, message) { if (ok) passed++; else { failed++; console.error(`  FAIL: ${message}`); } }
function eq(a, b, message) { check(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} (expected ${JSON.stringify(b)})`); }

async function audit(page, label) {
  const result = await new AxeBuilder({ page }).analyze();
  eq(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${label}: axe, all severities`);
  const small = await page.evaluate(() => [...document.querySelectorAll('button,input,select,summary,a:not(.sr)')].filter((e) => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 47.9 || r.width < 47.9);
  }).map((e) => e.outerHTML.slice(0, 100)));
  eq(small, [], `${label}: 48px touch targets`);
  eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
}

async function views(page, name, view) {
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(page, `${name}/${view}/${theme}`);
    await page.screenshot({ path: join(shots, `${name}-${view}-${theme}.png`), fullPage: true, scale: 'css' });
    await page.setViewportSize({ width: 320, height: 640 });
    await audit(page, `${name}/${view}/${theme}/320`);
    await page.screenshot({ path: join(shots, `${name}-${view}-${theme}-320.png`), fullPage: true, scale: 'css' });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(shots, `${name}-${view}-desktop.png`), fullPage: true, scale: 'css' });
  await audit(page, `${name}/${view}/desktop`);
  await page.setViewportSize({ width: 844, height: 390 });
  await audit(page, `${name}/${view}/landscape`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
}

async function suite(name, type, device) {
  console.log(`\n== ${name}`);
  const browser = await type.launch();
  try {
    // Axe and Playwright screenshots inject helper styles. Bypass policy only in
    // this audit context; the separate offline/functional context below enforces it.
    const context = await browser.newContext({ ...devices[device], colorScheme: 'dark', bypassCSP: true });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], policyErrors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => { if (/Content Security Policy|Refused to|violates.*directive/.test(msg.text())) policyErrors.push(msg.text()); });
    await page.goto(url);
    const button = (name) => page.getByRole('button', { name, exact: true });
    const sets = () => page.locator('.set');
    const histCount = async () => { await tap(button('Historia')); const n = await page.locator('.hist').count(); await tap(button('Harjoituksiin')); return n; };
    const doneCount = () => page.locator('.set[aria-pressed="true"]').count();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('gym-tracker-v1')));
    await views(page, name, 'home');
    await openSettings(page);
    await audit(page, `${name}/settings-open`);
    await page.screenshot({ path: join(shots, `${name}-settings.png`), fullPage: true, scale: 'css' });
    const download = page.waitForEvent('download');
    await tap(button('Vie varmuuskopio'));
    const file = await download;
    const backup = JSON.parse(readFileSync(await file.path(), 'utf8'));
    eq(backup.format, 'gym-tracker-backup', 'export envelope'); eq(backup.formatVersion, 1, 'export envelope version');
    eq(backup.data.v, 1, 'export schema'); eq(backup.data.routines.length, 1, 'export contains plans');

    const importFile = async (key, payload, asks = true) => {
      const before = await page.locator('#import-status').textContent().catch(() => null);
      const chooser = page.waitForEvent('filechooser');
      await page.locator(`[data-key="${key}"]`).click();
      await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)) });
      if (asks) await page.getByRole('alertdialog').getByRole('button').nth(1).click();
      await page.waitForFunction((prev) => { const s = document.getElementById('import-status'); return s && s.textContent !== prev; }, before);
    };
    const extra = JSON.parse(JSON.stringify(backup));
    extra.data.routines.push({ id: 'imp-1', name: 'Imported plan', exercises: [{ id: 'x1', name: 'Curl', sets: 2, reps: '10', weight: '' }] });
    extra.data.history = [{ id: 'imp-h', name: 'Old session', startedAt: 1000, endedAt: 2000, setsDone: 1, setsTotal: 1 }];
    await importFile('import', extra);
    let after = await saved();
    eq([after.routines.length, after.history.length], [2, 1], 'import adds plans and history');
    await importFile('import', extra);
    after = await saved();
    eq([after.routines.length, after.history.length], [2, 1], 'importing the same file again changes nothing');
    await page.reload();
    eq(await page.locator('.routine-details[open]').count(), 0, 'programs start collapsed after reload');
    await views(page, name, 'home-programs');
    await page.locator('.routine-details > summary').first().click();
    eq(await page.locator('.routine-details[open]').count(), 1, 'program disclosure opens independently');
    await audit(page, `${name}/expanded-program`);
    await openSettings(page);
    await importFile('import', { v: 1, routines: [{ id: 'old-1', name: 'Legacy plan', exercises: [{ name: 'Press' }] }], history: [] });
    eq((await saved()).routines.length, 3, 'legacy pre-envelope export imports');
    await importFile('import', 'not a backup', false);
    eq((await saved()).routines.length, 3, 'invalid file leaves data unchanged');
    await importFile('import', { format: 'gym-tracker-backup', formatVersion: 1, data: { v: 999, routines: [] } }, false);
    eq((await saved()).routines.length, 3, 'newer-version file leaves data unchanged');
    await importFile('restore', backup);
    after = await saved();
    eq([after.routines.length, after.history.length], [1, 0], 'restore replaces plans and history');
    await page.locator('.settings > summary').click();

    await tap(button('Aloita harjoitus'));
    eq(await sets().count(), 15, 'starter has 15 independent sets');
    await page.locator('[data-key="s0-0"]').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
    eq(await page.locator('[data-key="s0-0"]').getAttribute('aria-pressed'), 'true', 'Space logs focused set');
    eq(await page.locator('[data-key="s0-0"]').evaluate((e) => e === document.activeElement), true, 'set keeps keyboard focus after logging');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
    eq(await doneCount(), 0, 'Enter undoes focused set');
    await tap(page.locator('[data-key="s0-1"]'));
    await tap(page.locator('[data-key="s2-0"]'));
    eq(await doneCount(), 2, 'out-of-order taps logged');
    eq(await page.getByRole('progressbar').getAttribute('value'), '2', 'progress value');
    await tap(page.locator('[data-key="s0-1"]'));
    eq(await doneCount(), 1, 'tap again undoes only one set');
    eq(await page.locator('.ex.current h2').innerText(), 'Takakyykky', 'next indicator');
    check(await page.locator('#rest[data-state="run"]').isVisible(), 'rest visible');
    const endBefore = (await saved()).restEnd;
    await tap(button('+30 s')); eq((await saved()).restEnd, endBefore + 30000, '+30 seconds is exact');
    await page.reload(); eq(await doneCount(), 1, 'session recovers after reload');
    check(await page.locator('#rest[data-state="run"]').isVisible(), 'rest survives reload');
    await views(page, name, 'workout');
    await tap(button('Ohita')); check(await page.locator('#rest').isHidden(), 'skip dismisses timer');
    for (let i = 0; i < 3; i++) await tap(page.locator(`[data-key="s0-${i}"]`));
    eq(await page.locator('.ex.current h2').innerText(), 'Penkkipunnerrus', 'next advances after whole exercise');
    await page.reload(); eq(await doneCount(), 4, 'all independent sets survive reload');

    for (let i = 0; i < 17; i++) await tap(page.locator('[data-action="addset"]').first());
    eq(await page.locator('.ex').first().locator('.set').count(), 20, 'max set count');
    check(await page.locator('[data-action="addset"]').first().isDisabled(), 'max disables add');
    for (let i = 0; i < 19; i++) {
      // Removing a completed set asks first; undone sets are removed directly.
      const lastDone = await page.locator('.ex').first().locator('.set').last().getAttribute('aria-pressed') === 'true';
      const remove = page.locator('[data-action="rmset"]').first();
      if (lastDone) await tapConfirm(remove); else await tap(remove);
    }
    eq(await page.locator('.ex').first().locator('.set').count(), 1, 'min set count');
    check(await page.locator('[data-action="rmset"]').first().isDisabled(), 'min disables removal');
    await tapConfirm(button('Lopeta kesken')); eq(await histCount(), 1, 'finish early history');
    await page.reload(); eq(await histCount(), 1, 'history durable after reload');

    await tap(button('Aloita harjoitus'));
    const n = await sets().count();
    for (let i = 0; i < n; i++) await tap(sets().nth(i));
    eq(await doneCount(), 15, 'all sets completed');
    check(await page.locator('#rest').isHidden(), 'no timer after final set');
    await tap(button('Tallenna harjoitus')); eq(await histCount(), 2, 'complete saved');
    await page.reload(); eq(await histCount(), 2, 'completed history durable');

    await tap(button('Luo treeniohjelma'));
    await tap(button('Tallenna harjoitus')); check(await page.locator('#err').isVisible(), 'validation errors visible');
    await page.locator('[data-f="rname"]').fill('<img src=x onerror=window.__xss=1>');
    await page.locator('[data-f="name"]').first().fill('Dumbbell curl');
    await tap(button('Lisää liike'));
    await views(page, name, 'library');
    await page.locator('.custom-exercise > summary').click();
    await audit(page, `${name}/custom-exercise-form`);
    await page.locator('#custom-category summary').click();
    await audit(page, `${name}/custom-category-options`);
    await page.locator('#custom-category summary').click();
    await page.locator('.custom-exercise > summary').click();
    await page.locator('#library-category summary').click();
    await audit(page, `${name}/library-category-options`);
    await page.locator('#library-category summary').click();
    await page.locator('#exercise-search').fill('Dippi');
    await tap(page.locator('[data-id="lib-dippi"]'));
    await tap(page.locator('[data-action="up"]').nth(1));
    eq(await page.locator('[data-f="name"]').first().inputValue(), 'Dippi', 'reorder');
    await page.reload(); eq(await page.locator('[data-f="name"]').first().inputValue(), 'Dippi', 'draft + order restored');
    await views(page, name, 'editor');
    await tap(button('Tallenna harjoitus'));
    eq(await page.locator('.routine').count(), 2, 'new plan saved');
    eq(await page.evaluate(() => window.__xss ?? null), null, 'no XSS');
    check(await page.getByText('<img src=x onerror=window.__xss=1>', { exact: true }).isVisible(), 'malicious name text-only');

    await tap(button('Aloita harjoitus').first()); await tap(page.locator('[data-key="s0-0"]'));
    await tap(button('Takaisin harjoituksiin')); await tap(button('Muokkaa: Koko keho A'));
    await page.locator('[data-f="sets"]').first().fill('5'); await tap(button('Tallenna harjoitus'));
    await tap(button('Jatka harjoitusta')); eq(await sets().count(), 15, 'template edit leaves active snapshot alone');
    await tapConfirm(button('Hylkää harjoitus')); eq(await histCount(), 2, 'discard adds no history');
    await tap(page.getByRole('button', { name: /Muokkaa: <img/ })); await tapConfirm(button('Poista harjoitus'));
    eq(await page.locator('.routine').count(), 1, 'delete template');

    for (const bad of ['{nope', '{"routines":5,"session":{"exercises":"x"},"history":[1,null]}']) {
      await page.evaluate((value) => localStorage.setItem('gym-tracker-v1', value), bad); await page.reload();
      check(await page.getByRole('heading', { name: 'Treenipäiväkirja', exact: true }).isVisible(), 'corrupt storage recovers');
    }
    eq(errors, [], 'no page errors'); eq(policyErrors, [], 'no content-security-policy violations');
    await context.close();

    // Real cached reload with requests blocked, on BOTH engines.
    const offline = await browser.newContext({ ...devices[device] });
    const p = await offline.newPage(); p.setDefaultTimeout(15000);
    const enforcedPolicyErrors = [];
    p.on('console', (message) => { if (/Content Security Policy|Refused to|violates.*directive/.test(message.text())) enforcedPolicyErrors.push(message.text()); });
    await p.goto(url);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload();
    await offline.setOffline(true);
    await p.reload();
    check(await p.getByRole('heading', { name: 'Treenipäiväkirja', exact: true }).isVisible(), `${name} offline reload`);
    await tap(p.getByRole('button', { name: 'Aloita harjoitus', exact: true }));
    await tap(p.locator('[data-key="s0-0"]'));
    await p.reload();
    eq(await p.locator('.set[aria-pressed="true"]').count(), 1, `${name} offline progress recovery`);
    await tap(p.getByRole('button', { name: 'Takaisin harjoituksiin', exact: true }));
    await tap(p.getByRole('button', { name: 'Muokkaa: Koko keho A', exact: true }));
    await tap(p.getByRole('button', { name: 'Lisää liike', exact: true }));
    await p.locator('#exercise-search').fill('bench press');
    check(await p.locator('[data-id="lib-penkkipunnerrus"]').isVisible(), `${name}: full catalogue searches offline`);
    await tap(p.locator('[data-id="lib-penkkipunnerrus"]'));
    eq(await p.locator('[data-f="name"]').last().inputValue(), 'Penkkipunnerrus', `${name}: library choice works offline`);
    eq(enforcedPolicyErrors, [], `${name}: strict CSP enforced, no app violations`);
    await offline.close();
  } finally { await browser.close(); }
}

try {
  for (const args of [['pixel7-chromium', chromium, 'Pixel 7'], ['iphone14-webkit', webkit, 'iPhone 14']]) {
    try { await suite(...args); } catch (e) { failed++; console.error('ERROR:', e.stack); }
  }
} finally { server.kill(); }
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${shots}`);
process.exitCode = failed ? 1 : 0;
