const fs = require('fs');
const path = require('path');
const config = require('../config');

// Level settings live in config.js under `levels`. These defaults are only a
// safety net in case that block is missing.
const cfg = {
  channelId: '',
  maxLevel: 500,
  xpMin: 15,
  xpMax: 40,
  cooldownSeconds: 60,
  xpChannelIds: [],
  roleRewards: {},
  stackRoleRewards: false,
  ...(config.levels || {}),
};

// ---- Storage ----
// Everything is kept in memory and written to data/levels.json a few seconds
// after something changes (and again on shutdown), so a busy chat doesn't
// rewrite the file on every message. Data shape: { "<userId>": { xp: 1234 } }
const FILE = path.join(__dirname, '..', 'data', 'levels.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

let data = load();
let dirty = false;
let saveTimer = null;

function flushSync() {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(data));
    fs.renameSync(`${FILE}.tmp`, FILE); // swap in one step so a crash can't leave half a file
    dirty = false;
  } catch (err) {
    console.error('[levels] Failed to save levels.json:', err);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSync();
  }, 5000);
}

// pm2 restart / stop sends SIGINT or SIGTERM — exit cleanly so the 'exit'
// hook below gets to write anything still waiting to be saved.
process.on('exit', flushSync);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}

// ---- Level math ----
// Arcane's default ("Linear") curve: getting from level L to level L+1 costs
// (L * 100) + 75 XP — 75 XP for level 1, 175 more for level 2, 275 more for
// level 3, and so on.
function xpToNext(level) {
  return level * 100 + 75;
}

// Total XP you need to be AT level n (the sum of xpToNext for levels 0..n-1,
// which works out to 50n² + 25n).
function totalXpForLevel(n) {
  if (n <= 0) return 0;
  return 50 * n * n + 25 * n;
}

function levelFromXp(xp) {
  let low = 0;
  let high = cfg.maxLevel;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (totalXpForLevel(mid) <= xp) low = mid;
    else high = mid - 1;
  }
  return low;
}

// Where someone is inside their current level (for the progress bar).
function getProgress(xp) {
  const level = levelFromXp(xp);
  if (level >= cfg.maxLevel) return { level, maxed: true, into: 0, needed: 0 };
  return { level, maxed: false, into: xp - totalXpForLevel(level), needed: xpToNext(level) };
}

// ---- Earning XP ----
const cooldowns = new Map(); // userId -> timestamp of their last XP gain

// Cheap in-memory check, so the caller can skip any slower checks for
// messages that wouldn't earn XP anyway.
function offCooldown(userId) {
  return Date.now() - (cooldowns.get(userId) || 0) >= cfg.cooldownSeconds * 1000;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Gives a message's worth of XP. Returns { level } if that pushed the user up
// to a new level, otherwise null.
function grantMessageXp(userId) {
  if (!offCooldown(userId)) return null;
  cooldowns.set(userId, Date.now());

  const entry = data[userId] || { xp: 0 };
  const before = levelFromXp(entry.xp);
  if (before >= cfg.maxLevel) return null; // already at the cap

  entry.xp = Math.min(entry.xp + randInt(cfg.xpMin, cfg.xpMax), totalXpForLevel(cfg.maxLevel));
  data[userId] = entry;
  scheduleSave();

  const after = levelFromXp(entry.xp);
  return after > before ? { level: after } : null;
}

// ---- Role rewards ----
// The configured rewards as [{ level, roleId }], lowest level first. Levels
// with an empty role id are skipped.
function getRoleRewards() {
  return Object.entries(cfg.roleRewards || {})
    .filter(([, roleId]) => roleId)
    .map(([level, roleId]) => ({ level: Number(level), roleId }))
    .sort((a, b) => a.level - b.level);
}

// What someone at `level` is entitled to:
//   earned  - every reward role for levels up to theirs
//   highest - the role for the highest reward level they've reached
//   all     - every configured reward role (used to remove the lower ones)
function rolesForLevel(level) {
  const rewards = getRoleRewards();
  const earned = [...new Set(rewards.filter((r) => r.level <= level).map((r) => r.roleId))];
  return {
    earned,
    highest: earned.length ? earned[earned.length - 1] : null,
    all: [...new Set(rewards.map((r) => r.roleId))],
  };
}

// ---- Staff adjustments ----
// Used by /xp-add and /xp-remove. XP never goes below 0 or above the max level.
function setXp(userId, xp) {
  const before = getXp(userId);
  const after = Math.max(0, Math.min(Math.floor(xp), totalXpForLevel(cfg.maxLevel)));
  data[userId] = { ...(data[userId] || {}), xp: after };
  scheduleSave();
  return {
    beforeXp: before,
    afterXp: after,
    beforeLevel: levelFromXp(before),
    afterLevel: levelFromXp(after),
  };
}

function addXp(userId, amount) {
  return setXp(userId, getXp(userId) + amount);
}

function removeXp(userId, amount) {
  return setXp(userId, getXp(userId) - amount);
}

// Moves someone up/down by whole levels and keeps their progress into the
// level where possible (clamped so it can't spill into the next level).
function shiftLevels(userId, delta) {
  const xp = getXp(userId);
  const level = levelFromXp(xp);
  const target = Math.max(0, Math.min(cfg.maxLevel, level + delta));

  let newXp;
  if (target >= cfg.maxLevel) {
    newXp = totalXpForLevel(cfg.maxLevel);
  } else {
    const into = xp - totalXpForLevel(level);
    newXp = totalXpForLevel(target) + Math.min(into, xpToNext(target) - 1);
  }
  return setXp(userId, newXp);
}

function addLevels(userId, count) {
  return shiftLevels(userId, count);
}

function removeLevels(userId, count) {
  return shiftLevels(userId, -count);
}

// ---- Reading ----
function getXp(userId) {
  return data[userId]?.xp || 0;
}

// Everyone with XP, highest first: [{ userId, xp }]
function getRanked() {
  return Object.entries(data)
    .map(([userId, entry]) => ({ userId, xp: entry.xp }))
    .filter((e) => e.xp > 0)
    .sort((a, b) => b.xp - a.xp);
}

// 1-based position on the leaderboard, or null if they have no XP yet.
function getRank(userId) {
  const index = getRanked().findIndex((e) => e.userId === userId);
  return index === -1 ? null : index + 1;
}

module.exports = {
  cfg,
  xpToNext,
  totalXpForLevel,
  levelFromXp,
  getProgress,
  getRoleRewards,
  rolesForLevel,
  offCooldown,
  grantMessageXp,
  addXp,
  removeXp,
  addLevels,
  removeLevels,
  getXp,
  getRanked,
  getRank,
  flushSync,
};
