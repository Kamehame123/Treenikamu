// Bluetooth heart-rate monitors (Polar H10 and any strap using the standard Heart Rate Service).
// Pure helpers come first so they can be tested without a browser.

export const HR_MIN = 25;
export const HR_MAX = 250;
export const HR_STALE_MS = 5000;
export const HR_MIN_SAMPLES = 10;

// Heart Rate Measurement characteristic (0x2A37). Returns null for malformed data.
// `contact` is true/false when the strap reports skin contact, otherwise null.
export function parseHeartRateMeasurement(view) {
  if (!view || view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  const wide = (flags & 1) === 1;
  if (view.byteLength < (wide ? 3 : 2)) return null;
  const bpm = wide ? view.getUint16(1, true) : view.getUint8(1);
  const contact = (flags & 4) === 4 ? (flags & 2) === 2 : null;
  return { bpm, contact };
}

// 0 bpm and out-of-range values are what straps send without skin contact; never record them.
export const isPlausibleBpm = (bpm) => Number.isInteger(bpm) && bpm >= HR_MIN && bpm <= HR_MAX;

export const emptyHr = (id = '') => ({ id, sum: 0, n: 0, max: 0 });

export function addHrSample(acc, bpm) {
  if (!isPlausibleBpm(bpm)) return acc;
  return { ...acc, sum: acc.sum + bpm, n: acc.n + 1, max: Math.max(acc.max, bpm) };
}

// Stored on a finished workout. Too few samples is unknown, not a guess.
export function summarizeHr(acc) {
  if (!acc || !Number.isFinite(acc.n) || acc.n < HR_MIN_SAMPLES) return null;
  return { avg: Math.round(acc.sum / acc.n), max: acc.max, n: acc.n };
}

// Normalises stored/imported values; anything unusable is dropped rather than coerced.
export function sanitizeHr(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { avg, max, n } = raw;
  if (![avg, max, n].every((v) => typeof v === 'number')) return null;
  if (!isPlausibleBpm(avg) || !isPlausibleBpm(max) || avg > max || !Number.isInteger(n) || n < 1 || n > 1e7) return null;
  return { avg, max, n };
}

export const hrSupported = (bluetooth = globalThis.navigator?.bluetooth) => !!bluetooth?.requestDevice;

const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];

// status: idle | connecting | connected | reconnecting | error
export function createMonitor({ bluetooth = globalThis.navigator?.bluetooth, onChange = () => {}, onSample = () => {}, now = () => Date.now(), remember = () => {}, recall = () => null, retryMs = RETRY_MS } = {}) {
  const info = { status: 'idle', name: '', bpm: null, at: 0, error: '' };
  let device = null, characteristic = null, wanted = false, attempt = 0, retryTimer = null, retries = 0;

  const set = (patch) => {
    const before = `${info.status}|${info.name}|${info.error}`;
    Object.assign(info, patch);
    if (before !== `${info.status}|${info.name}|${info.error}`) onChange(info);
  };
  const handleValue = (event) => {
    const parsed = parseHeartRateMeasurement(event.target.value);
    if (!parsed || parsed.contact === false || !isPlausibleBpm(parsed.bpm)) { info.bpm = null; return; }
    info.bpm = parsed.bpm; info.at = now();
    onSample(parsed.bpm, info.at);
  };
  const release = async () => {
    const ch = characteristic;
    characteristic = null;
    if (ch) {
      ch.removeEventListener('characteristicvaluechanged', handleValue);
      try { await ch.stopNotifications(); } catch { /* Already disconnected. */ }
    }
  };
  const onDisconnected = () => {
    if (!wanted) return;
    void release();
    info.bpm = null;
    set({ status: 'reconnecting', error: '' });
    scheduleRetry();
  };
  // Each attempt owns its token; a later disconnect or reconnect makes older attempts inert.
  async function open(token) {
    const server = await device.gatt.connect();
    if (token !== attempt || !wanted) { server.disconnect?.(); return false; }
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    if (token !== attempt || !wanted) { server.disconnect?.(); return false; }
    await ch.startNotifications();
    if (token !== attempt || !wanted) { try { await ch.stopNotifications(); } catch { /* Superseded. */ } server.disconnect?.(); return false; }
    ch.addEventListener('characteristicvaluechanged', handleValue);
    characteristic = ch;
    retries = 0;
    set({ status: 'connected', name: device.name || 'Sykemittari', error: '' });
    remember(device.id);
    return true;
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    const token = ++attempt;
    const delay = retryMs[Math.min(retries++, retryMs.length - 1)];
    retryTimer = setTimeout(async () => {
      if (token !== attempt || !wanted) return;
      try { await open(token); }
      catch { if (token === attempt && wanted) scheduleRetry(); }
    }, delay);
  }
  async function attach(next, token) {
    if (device && device !== next) device.removeEventListener?.('gattserverdisconnected', onDisconnected);
    device = next;
    device.addEventListener('gattserverdisconnected', onDisconnected);
    set({ status: 'connecting', name: device.name || '', error: '' });
    try { await open(token); }
    catch (error) {
      if (token !== attempt || !wanted) return;
      wanted = false;
      try { device.gatt?.disconnect(); } catch { /* Not connected. */ }
      set({ status: 'error', error: connectErrorText(error) });
    }
  }

  return {
    info,
    // Must be called from a user gesture: the browser shows its own device chooser.
    async connect() {
      if (!hrSupported(bluetooth)) { set({ status: 'error', error: 'Selain ei tue Bluetooth-sykemittareita.' }); return; }
      if (['connecting', 'connected', 'reconnecting'].includes(info.status)) return;
      const token = ++attempt;
      clearTimeout(retryTimer); retries = 0; wanted = true;
      set({ status: 'connecting', error: '' });
      let picked;
      try { picked = await bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] }); }
      catch (error) {
        if (token !== attempt) return;
        wanted = false;
        // Dismissing the chooser is not an error.
        set(error?.name === 'NotFoundError' ? { status: 'idle', error: '' } : { status: 'error', error: connectErrorText(error) });
        return;
      }
      if (token !== attempt || !wanted) return;
      await attach(picked, token);
    },
    // Reconnects silently to a previously permitted device, where the browser supports it.
    async restore() {
      if (!bluetooth?.getDevices || wanted || info.status !== 'idle') return;
      let devices;
      try { devices = await bluetooth.getDevices(); } catch { return; }
      const id = recall();
      const known = devices?.find((d) => d.id === id);
      if (!known || wanted) return;
      wanted = true;
      await attach(known, ++attempt);
      if (info.status === 'error') set({ status: 'idle', error: '' });
    },
    async disconnect() {
      wanted = false; attempt++; clearTimeout(retryTimer);
      await release();
      device?.removeEventListener?.('gattserverdisconnected', onDisconnected);
      try { device?.gatt?.disconnect(); } catch { /* Already disconnected. */ }
      info.bpm = null;
      set({ status: 'idle', error: '' });
    },
    // The latest reading, or null once it is too old to trust.
    current() {
      return info.status === 'connected' && info.bpm !== null && now() - info.at <= HR_STALE_MS ? info.bpm : null;
    },
  };
}

function connectErrorText(error) {
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return 'Bluetooth-yhteys on estetty. Salli Bluetooth selaimen asetuksista ja yritä uudelleen.';
  if (error?.name === 'NotSupportedError') return 'Laite ei tarjoa sykepalvelua. Valitse sykemittari.';
  return 'Yhdistäminen ei onnistunut. Kostuta mittarin elektrodit, pidä se lähellä ja sulje muut sovellukset, jotka käyttävät sitä.';
}
