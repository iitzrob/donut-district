const createStore = require('./jsonStore');

// { [userId]: { reason: string, since: number (ms timestamp) } }
const store = createStore('afk.json', {});

function setAfk(userId, reason) {
  store.set(userId, { reason: reason || 'AFK', since: Date.now() });
}

function getAfk(userId) {
  return store.get(userId);
}

function clearAfk(userId) {
  store.delete(userId);
}

// Turns a millisecond duration into something like "2h 5m" or "45s".
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);

  return parts.slice(0, 2).join(' ');
}

module.exports = { setAfk, getAfk, clearAfk, formatDuration };
