const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const payments = require('../utils/payments');
const donut = require('../utils/donutStats');
const { isStaff } = require('../utils/permissions');

const settings = {
  pollSeconds: 60,
  requireBoth: true,
  ...(config.payments || {}),
};
const POLL_MS = Math.max(20, Number(settings.pollSeconds) || 60) * 1000;

// If the balance lookup is failing right when time runs out, wait this long
// for one good final check before calling the payment expired.
const EXPIRY_GRACE_MS = 5 * 60 * 1000;

// Finished payments are kept in payments.json for this many days.
const KEEP_FINISHED_DAYS = 30;

const COLORS = {
  active: 0xf1c40f,
  paid: 0x2ecc71,
  expired: 0xe74c3c,
  cancelled: 0x95a5a6,
};

// Shown on an active tracker while the last check didn't work.
const ERROR_NOTES = {
  NO_REPLY: "The last check didn't work: the Donut Stats bot didn't answer.",
  UNPARSEABLE: "The last check didn't work: I couldn't read the money in Donut Stats' reply.",
  NOT_FOUND: "The last check didn't work: Donut Stats couldn't find one of the players.",
  OTHER: "The last check didn't work. I'll keep trying.",
};

const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

// The Discord user is optional — a payment is really about the two in-game names.
// "@user\n`Name`" when there's a Discord user, otherwise just "`Name`".
function personLine(discordId, ign) {
  return discordId ? `<@${discordId}>\n\`${ign}\`` : `\`${ign}\``;
}

// How a person is named in a channel message: their mention, or the in-game name.
function personName(discordId, ign) {
  return discordId ? `<@${discordId}>` : `**${ign}**`;
}

// ---- Message (embed + buttons) ----

function buildEmbed(p) {
  const percent = p.amount ? Math.min(100, Math.floor((p.progress / p.amount) * 100)) : 0;

  const embed = new EmbedBuilder()
    .setColor(COLORS[p.status] || COLORS.active)
    .setTitle('Payment Tracker')
    .addFields(
      { name: 'Payer', value: personLine(p.payerDiscordId, p.payerIgn), inline: true },
      { name: 'Receiver', value: personLine(p.receiverDiscordId, p.receiverIgn), inline: true },
      { name: 'Amount', value: payments.moneyWithShort(p.amount), inline: true },
      { name: 'Pay by', value: `${ts(p.deadline, 'f')} (${ts(p.deadline, 'R')})`, inline: false },
      {
        name: 'Progress',
        value: `${payments.money(p.progress)} / ${payments.money(p.amount)} (${percent}%)`,
        inline: false,
      }
    );

  if (p.status === 'active') {
    const note = p.lastError ? `\n${ERROR_NOTES[p.lastError] || ERROR_NOTES.OTHER}` : '';
    embed
      .setDescription(`Waiting for the payment. Both balances are checked with Donut Stats automatically.${note}`)
      .setFooter({ text: `ID ${p.id} · checks every ${POLL_MS / 1000}s` });
  } else if (p.status === 'paid') {
    const how = p.resolvedBy ? `Marked as paid by <@${p.resolvedBy}>` : 'Payment received';
    embed
      .setTitle('Payment Tracker — Paid')
      .setDescription(`${how} ${ts(p.finishedAt, 'R')}.`)
      .setFooter({ text: `ID ${p.id}` });
  } else if (p.status === 'expired') {
    embed
      .setTitle('Payment Tracker — Expired')
      .setDescription('Time ran out before the full amount was paid.')
      .setFooter({ text: `ID ${p.id}` });
  } else {
    embed
      .setTitle('Payment Tracker — Cancelled')
      .setDescription(`Cancelled by <@${p.resolvedBy}>.`)
      .setFooter({ text: `ID ${p.id}` });
  }
  return embed;
}

function buildButtons(p) {
  if (p.status !== 'active') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`payment_paid:${p.id}`)
        .setLabel('Mark as Paid')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`payment_cancel:${p.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ---- Talking to Discord ----

let clientRef = null;

// Re-draws the tracker message after progress or status changes. The message
// is edited through the channel (not the slash command reply) because
// interaction replies stop being editable after 15 minutes.
async function refreshMessage(p) {
  if (!clientRef || !p.messageId) return;
  try {
    const channel = await clientRef.channels.fetch(p.channelId);
    const message = await channel.messages.fetch(p.messageId);
    await message.edit({ embeds: [buildEmbed(p)], components: buildButtons(p) });
  } catch (err) {
    // Usually the ticket channel was deleted or the message was removed —
    // tracking carries on regardless.
    console.warn(`[payments] Couldn't update the message for payment ${p.id}: ${err.message}`);
  }
}

// Posts a result in the original channel. If that channel is gone (e.g. the
// ticket was closed) the person who started the tracker gets a DM instead.
async function notify(p, content, userIds) {
  if (!clientRef) return;
  try {
    const channel = await clientRef.channels.fetch(p.channelId);
    await channel.send({ content, allowedMentions: { users: userIds } });
    return;
  } catch {
    // fall through to the DM
  }
  try {
    const user = await clientRef.users.fetch(p.createdBy);
    await user.send(`${content}\n(The channel this payment was tracked in is no longer available.)`);
  } catch (err) {
    console.warn(`[payments] Couldn't tell anyone about the result of payment ${p.id}: ${err.message}`);
  }
}

// ---- Checking balances ----

// Works out how much of the payment has gone through so far.
// Returns { progress, payerNow, receiverNow } or null if the lookups didn't
// give enough information to judge.
function measure(p, payerRes, receiverRes) {
  const moved = [];
  if (payerRes.ok) moved.push(p.payerStart - payerRes.value); // payer's money going down
  if (receiverRes.ok) moved.push(receiverRes.value - p.receiverStart); // receiver's money going up

  if (settings.requireBoth ? moved.length < 2 : moved.length < 1) return null;

  const raw = settings.requireBoth ? Math.min(...moved) : Math.max(...moved);
  return {
    progress: Math.max(0, Math.min(p.amount, raw)),
    payerNow: payerRes.ok ? payerRes.value : p.payerNow,
    receiverNow: receiverRes.ok ? receiverRes.value : p.receiverNow,
  };
}

async function checkPayment(p, lookup) {
  const [payerRes, receiverRes] = [await lookup(p.payerIgn), await lookup(p.receiverIgn)];

  // Nothing will work this round if the stats channel isn't set up.
  for (const res of [payerRes, receiverRes]) {
    if (!res.ok && res.error.code === 'NOT_CONFIGURED') {
      console.error(`[payments] ${res.error.message}`);
      return 'abort';
    }
  }

  const now = Date.now();
  const measured = measure(p, payerRes, receiverRes);
  const pastDeadline = now >= p.deadline;

  // The user may have pressed Mark as Paid / Cancel while we were waiting on
  // the API, so look again before writing anything.
  const fresh = payments.get(p.id);
  if (!fresh || fresh.status !== 'active') return 'done';

  if (!measured) {
    // Lookups failed. Keep waiting, unless we're long past the deadline.
    if (pastDeadline && now >= p.deadline + EXPIRY_GRACE_MS) {
      await finish(fresh, 'expired');
      return 'expired';
    }
    // Let the tracker message say the last check failed (only when that changes).
    const failed = [payerRes, receiverRes].find((r) => !r.ok);
    const code = failed && failed.error ? failed.error.code || 'OTHER' : 'OTHER';
    if (fresh.lastError !== code) {
      await refreshMessage(payments.update(fresh.id, { lastError: code }));
    }
    return 'skipped';
  }

  if (measured.progress >= fresh.amount) {
    await finish(fresh, 'paid', measured);
    return 'paid';
  }

  if (pastDeadline) {
    await finish(fresh, 'expired', measured);
    return 'expired';
  }

  if (measured.progress !== fresh.progress || fresh.lastError) {
    const updated = payments.update(fresh.id, { ...measured, lastError: null });
    await refreshMessage(updated);
  } else {
    payments.update(fresh.id, { payerNow: measured.payerNow, receiverNow: measured.receiverNow });
  }
  return 'waiting';
}

async function finish(p, status, measured = {}, resolvedBy = null) {
  const updated = payments.update(p.id, {
    ...measured,
    status,
    lastError: null,
    finishedAt: Date.now(),
    resolvedBy,
    ...(status === 'paid' && !resolvedBy ? { progress: p.amount } : {}),
  });
  await refreshMessage(updated);

  // Pings the Discord users involved plus whoever started the tracker.
  const who = [...new Set([updated.payerDiscordId, updated.receiverDiscordId, updated.createdBy].filter(Boolean))];
  const payer = personName(updated.payerDiscordId, updated.payerIgn);
  const receiver = personName(updated.receiverDiscordId, updated.receiverIgn);
  // Whoever started the tracker gets pinged too, unless they're already named above.
  const starter = [updated.payerDiscordId, updated.receiverDiscordId].includes(updated.createdBy)
    ? ''
    : ` (<@${updated.createdBy}>)`;
  if (status === 'paid' && !resolvedBy) {
    await notify(
      updated,
      `Payment complete: ${payer} paid ${receiver} ${payments.moneyWithShort(updated.amount)}.${starter}`,
      who
    );
  } else if (status === 'expired') {
    await notify(
      updated,
      `Time's up: ${payer} didn't pay ${receiver} the full ${payments.moneyWithShort(updated.amount)} in time (${payments.money(updated.progress)} went through).${starter}`,
      who
    );
  }
  return updated;
}

let running = false;

async function checkAll() {
  if (running) return; // previous round still going (slow API) — skip this one
  running = true;
  try {
    const active = payments.getActive();
    if (!active.length) return;

    // Several payments can involve the same player — look each one up once per round.
    const cache = new Map();
    const lookup = (name) => {
      const key = name.toLowerCase();
      if (!cache.has(key)) {
        cache.set(
          key,
          donut.getMoney(name).then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error })
          )
        );
      }
      return cache.get(key);
    };

    for (const p of active) {
      try {
        const result = await checkPayment(p, lookup);
        if (result === 'abort') break;
      } catch (err) {
        console.error(`[payments] Error while checking payment ${p.id}:`, err);
      }
    }
  } finally {
    running = false;
  }
}

function startPaymentTracker(client) {
  clientRef = client;
  donut.init(client);
  const removed = payments.pruneFinished(KEEP_FINISHED_DAYS);
  if (removed) console.log(`[payments] Removed ${removed} old finished payment(s).`);

  const active = payments.getActive().length;
  if (active) console.log(`[payments] Resuming ${active} active payment(s).`);

  setInterval(() => {
    checkAll().catch((err) => console.error('[payments] Check failed:', err));
  }, POLL_MS);
  checkAll().catch((err) => console.error('[payments] Check failed:', err));
}

// ---- Buttons on the tracker message ----

async function handlePaymentButton(interaction) {
  const [action, id] = interaction.customId.split(':');
  const p = payments.get(id);

  if (!p) {
    return interaction.reply({ content: 'That payment tracker no longer exists.', ephemeral: true });
  }
  if (p.status !== 'active') {
    // Already finished (e.g. it just got paid) — show the final state.
    return interaction.update({ embeds: [buildEmbed(p)], components: [] });
  }

  const allowed =
    isStaff(interaction.member) ||
    interaction.user.id === p.createdBy ||
    interaction.user.id === p.receiverDiscordId;
  if (!allowed) {
    return interaction.reply({
      content: 'Only staff or the person receiving the payment can do that.',
      ephemeral: true,
    });
  }

  const status = action === 'payment_paid' ? 'paid' : 'cancelled';
  const updated = payments.update(p.id, {
    status,
    finishedAt: Date.now(),
    resolvedBy: interaction.user.id,
    ...(status === 'paid' ? { progress: p.amount } : {}),
  });
  await interaction.update({ embeds: [buildEmbed(updated)], components: [] });
}

module.exports = {
  buildEmbed,
  buildButtons,
  startPaymentTracker,
  handlePaymentButton,
  checkAll,
};
