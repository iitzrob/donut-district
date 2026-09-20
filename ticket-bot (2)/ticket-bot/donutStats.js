const config = require('../config');

// Gets a player's money by running the Donut Stats bot's !stats command.
//
// The bot posts "!stats <name>" in the channel set as payments.statsChannelId
// (a channel in the server where the Donut Stats bot lives), waits for the
// Donut Stats bot to answer, and reads the money out of its reply.
//
// Requests go through a queue one at a time, with a short pause between them,
// so replies can't be mixed up and the channel isn't flooded.

const cfg = {
  statsChannelId: '',
  statsBotId: '',
  statsCommand: '!stats',
  replyTimeoutSeconds: 20,
  deleteMessages: true,
  moneyRegex: '',
  ...(config.payments || {}),
};

const MIN_GAP_MS = 2000; // pause between two !stats commands

class DonutStatsError extends Error {
  // code: NOT_CONFIGURED, SEND_FAILED, NO_REPLY, UNPARSEABLE, NOT_FOUND
  // raw: the text of the reply we couldn't read (shown by /track test)
  constructor(code, message, raw = null) {
    super(message);
    this.name = 'DonutStatsError';
    this.code = code;
    this.raw = raw;
  }
}

let clientRef = null;

function init(client) {
  clientRef = client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Reading the reply ----

// Everything readable in a message: normal text plus every part of its embeds.
function messageText(message) {
  const parts = [message.content || ''];
  for (const e of message.embeds || []) {
    if (e.author && e.author.name) parts.push(e.author.name);
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields || []) parts.push(`${f.name}: ${f.value}`);
    if (e.footer && e.footer.text) parts.push(e.footer.text);
  }
  return parts.join('\n');
}

// Drops custom emoji and markdown symbols so "**Money:** $1.5M" reads plainly.
function clean(text) {
  return text.replace(/<a?:\w+:\d+>/g, '').replace(/[*_`~|>\\]/g, '');
}

const normalize = (s) => s.toLowerCase().replace(/[*_`~\s\\]/g, '');

// The word "money" (or "balance") followed by a number like 1,500,000 or 1.5B,
// either on the same line ("Money: $1.5M") or on the next one ("Money" then
// "$1.5M"). "Money made" / "Money spent" style lines are skipped on purpose,
// and so is a label followed by "(" or "#" (like "Money (rank #4)"), so a rank
// can't be mistaken for the balance — that just shows up as unreadable.
// Group 1 = the number, group 2 = an optional k/m/b/t or word suffix.
const DEFAULT_MONEY_RE =
  /\b(?:money|balance|bal)\b(?!\s*(?:made|spent|from|earned|per|leaderboard|rank))(?:[^0-9\n#(]{0,25}?|[^0-9\n#(]{0,10}\n[^\p{L}\p{N}\n]{0,6})(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|[kmbt])?\b/iu;

const NOT_FOUND_RE =
  /(not found|couldn'?t find|could not find|no player|no stats|doesn'?t exist|does not exist|invalid (?:player|user|username)|unknown player)/i;

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

let moneyRe = DEFAULT_MONEY_RE;
if (cfg.moneyRegex) {
  try {
    moneyRe = new RegExp(cfg.moneyRegex, 'iu');
  } catch (err) {
    console.error(`[payments] payments.moneyRegex in config.js isn't a valid regex, using the default: ${err.message}`);
  }
}

// Returns { value, step } or null. `step` is how coarse the number is:
// "1,500,000" is exact (step 1) but "2.92B" only moves in 10,000,000 jumps.
function parseMoney(rawText) {
  const match = clean(rawText).match(moneyRe);
  if (!match) return null;

  const numText = match[1];
  if (numText.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(numText)) return null;
  const number = Number(numText.replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;

  const suffix = match[2] ? match[2].toLowerCase() : null;
  const multiplier = suffix ? SUFFIX[suffix] : 1;
  const value = Math.round(number * multiplier);
  if (!Number.isSafeInteger(value)) return null;

  const decimals = (numText.split('.')[1] || '').length;
  const step = suffix ? multiplier / 10 ** decimals : 1;
  return { value, step };
}

// ---- Running !stats ----

// Starts listening for the Donut Stats bot's answer. Call setSent() once our
// "!stats <name>" message has been posted (its id is needed to recognise
// replies); anything that arrived before that is checked at that point, so a
// very fast reply can't slip through.
function listenForReply(channel, name) {
  let sent = null;
  const buffered = [];
  const replies = [];
  let unreadable = null; // text of a matching reply that had no money in it (yet)
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const finish = (fn) => {
    clearTimeout(timer);
    clientRef.off('messageCreate', onCreate);
    clientRef.off('messageUpdate', onUpdate);
    if (cfg.deleteMessages) {
      // Tidy up if the bot is allowed to — silently ignore it if not.
      for (const m of [sent, ...replies]) if (m) m.delete().catch(() => {});
    }
    fn();
  };

  const consider = (m) => {
    if (m.channelId !== channel.id) return;
    if (!m.author || !m.author.bot || m.author.id === clientRef.user.id) return;
    if (cfg.statsBotId && m.author.id !== cfg.statsBotId) return;

    const text = messageText(m);
    const isReplyToUs = m.reference && m.reference.messageId === sent.id;
    if (!isReplyToUs && !normalize(text).includes(normalize(name))) return;

    if (!replies.includes(m)) replies.push(m);

    const parsed = parseMoney(text);
    if (parsed) return finish(() => settle.resolve({ ...parsed, raw: text }));
    if (NOT_FOUND_RE.test(text)) {
      return finish(() =>
        settle.reject(new DonutStatsError('NOT_FOUND', `Donut Stats couldn't find "${name}".`, text))
      );
    }
    // Some bots post "Loading..." first and edit the message afterwards —
    // keep listening until the timeout.
    unreadable = text || '(empty message)';
  };

  const onCreate = (m) => {
    if (sent) consider(m);
    else buffered.push(m);
  };
  const onUpdate = async (_old, updated) => {
    try {
      const full = updated.partial ? await updated.fetch() : updated;
      if (sent) consider(full);
      else buffered.push(full);
    } catch {
      // message vanished — ignore
    }
  };

  const timer = setTimeout(() => {
    finish(() =>
      settle.reject(
        unreadable === null
          ? new DonutStatsError('NO_REPLY', `The Donut Stats bot didn't answer "${cfg.statsCommand} ${name}".`)
          : new DonutStatsError('UNPARSEABLE', "Couldn't find the money in Donut Stats' reply.", unreadable)
      )
    );
  }, Math.max(5, Number(cfg.replyTimeoutSeconds) || 20) * 1000);

  clientRef.on('messageCreate', onCreate);
  clientRef.on('messageUpdate', onUpdate);

  return {
    promise,
    setSent(message) {
      sent = message;
      for (const m of buffered.splice(0)) consider(m);
    },
    abort() {
      finish(() => {});
    },
  };
}

async function runStats(name) {
  if (!clientRef || !cfg.statsChannelId) {
    throw new DonutStatsError('NOT_CONFIGURED', 'payments.statsChannelId is not set in config.js.');
  }
  const channel = await clientRef.channels.fetch(cfg.statsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new DonutStatsError(
      'NOT_CONFIGURED',
      `I can't see a text channel with id ${cfg.statsChannelId}. Is the bot in that server?`
    );
  }

  const listener = listenForReply(channel, name);
  let sent;
  try {
    sent = await channel.send(`${cfg.statsCommand} ${name}`);
  } catch (err) {
    listener.abort();
    throw new DonutStatsError('SEND_FAILED', `Couldn't post in the stats channel: ${err.message}`);
  }
  listener.setSent(sent);
  return listener.promise;
}

// ---- Queue ----

let chain = Promise.resolve();
let lastRun = 0;

function enqueue(fn) {
  const run = chain.then(async () => {
    const wait = lastRun + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastRun = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

// { value, step, raw } — throws DonutStatsError
function lookup(name) {
  return enqueue(() => runStats(name));
}

async function getMoney(name) {
  return (await lookup(name)).value;
}

module.exports = { init, lookup, getMoney, parseMoney, DonutStatsError };
