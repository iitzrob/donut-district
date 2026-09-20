const crypto = require('crypto');
const createStore = require('./jsonStore');

// payments.json shape: { [paymentId]: payment }
// payment = {
//   id, status: 'active' | 'paid' | 'expired' | 'cancelled',
//   guildId, channelId, messageId, createdBy, createdAt, deadline,
//   payerDiscordId, receiverDiscordId, payerIgn, receiverIgn,
//   amount,
//   payerStart, receiverStart,   // money when tracking began
//   payerNow, receiverNow,       // money at the last successful check
//   progress,                    // how much of `amount` has moved so far
//   finishedAt, resolvedBy       // set once it's no longer active
// }
const store = createStore('payments.json', {});

function create(fields) {
  const all = store.all();
  let id;
  do {
    id = crypto.randomBytes(3).toString('hex');
  } while (all[id]);

  const payment = { id, status: 'active', createdAt: Date.now(), progress: 0, ...fields };
  store.set(id, payment);
  return payment;
}

function get(id) {
  return store.get(id) || null;
}

function update(id, patch) {
  const current = store.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  store.set(id, next);
  return next;
}

function remove(id) {
  store.delete(id);
}

function getActive() {
  return Object.values(store.all()).filter((p) => p.status === 'active');
}

// Drops finished payments older than `days` so the file doesn't grow forever.
function pruneFinished(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = store.all();
  const kept = {};
  let removed = 0;
  for (const [id, p] of Object.entries(all)) {
    if (p.status !== 'active' && (p.finishedAt || p.createdAt || 0) < cutoff) {
      removed++;
      continue;
    }
    kept[id] = p;
  }
  if (removed) store.overwriteAll(kept);
  return removed;
}

// ---- Parsing ----

// "500k", "2.5m", "1b", "1,000,000", "$750000" -> number, or null if it's not
// a sensible amount. Commas only count as thousands separators, so "1,5m"
// is rejected instead of silently turning into 15m.
function parseAmount(input) {
  if (input === null || input === undefined) return null;
  let text = String(input).trim().toLowerCase().replace(/[$\s_]/g, '');
  if (!text) return null;

  if (text.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?[kmbt]?$/.test(text)) return null;
    text = text.replace(/,/g, '');
  }

  const match = text.match(/^(\d+(?:\.\d+)?|\.\d+)([kmbt])?$/);
  if (!match) return null;

  const multiplier = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]] || 1;
  const value = Math.round(parseFloat(match[1]) * multiplier);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};
const DURATION_TOKEN = '(\\d+(?:\\.\\d+)?)(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)';

// "30m", "2h", "1d", "1h30m", "2 hours" -> milliseconds, or null.
// A bare number counts as minutes.
function parseDuration(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;

  if (/^\d+$/.test(text)) return Number(text) * UNIT_MS.m;
  if (!new RegExp(`^(?:${DURATION_TOKEN})+$`).test(text)) return null;

  let total = 0;
  for (const [, num, unit] of text.matchAll(new RegExp(DURATION_TOKEN, 'g'))) {
    total += parseFloat(num) * UNIT_MS[unit[0]];
  }
  const ms = Math.round(total);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// ---- Formatting ----

function shortMoney(n) {
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(n) >= size) return `${+(n / size).toFixed(2)}${suffix}`;
  }
  return String(Math.round(n));
}

// $2,500,000
function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// $2,500,000 (2.5M)
function moneyWithShort(n) {
  return Math.abs(n) < 1000 ? money(n) : `${money(n)} (${shortMoney(n)})`;
}

module.exports = {
  create,
  get,
  update,
  remove,
  getActive,
  pruneFinished,
  parseAmount,
  parseDuration,
  money,
  moneyWithShort,
};
