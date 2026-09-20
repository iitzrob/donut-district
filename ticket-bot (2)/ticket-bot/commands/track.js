const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const { isStaff } = require('../utils/permissions');
const payments = require('../utils/payments');
const donut = require('../utils/donutStats');
const { buildEmbed, buildButtons } = require('../handlers/paymentHandlers');

const settings = {
  staffOnly: true,
  maxActive: 10,
  maxDurationDays: 7,
  statsCommand: '!stats',
  ...(config.payments || {}),
};

const MIN_DURATION_MS = 60 * 1000;
// Minecraft names are letters/numbers/underscores; Bedrock names start with a dot.
const IGN_PATTERN = /^\.?[A-Za-z0-9_]{1,32}$/;

// /track payment payer_ign:<name> receiver_ign:<name> amount:<amount> time:<time to pay>
//   [user:<payer's Discord account>] [receiver:<receiver's Discord account>]
// /track test name:<DonutSMP username>
//
// The in-game names are what get tracked. The Discord users are optional —
// they're only used to ping/show people in the tracker message.
// The bot runs the Donut Stats bot's !stats command for both players now and
// again every so often — see utils/donutStats.js and handlers/paymentHandlers.js.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('track')
    .setDescription('Track things')
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('payment')
        .setDescription('Track a DonutSMP payment by watching the payer and receiver balances')
        .addStringOption((opt) =>
          opt
            .setName('payer_ign')
            .setDescription('DonutSMP username of the person who is paying')
            .setRequired(true)
            .setMaxLength(32)
        )
        .addStringOption((opt) =>
          opt
            .setName('receiver_ign')
            .setDescription('DonutSMP username of the person receiving the payment')
            .setRequired(true)
            .setMaxLength(32)
        )
        .addStringOption((opt) =>
          opt
            .setName('amount')
            .setDescription('Amount they have to pay, e.g. 500k, 2.5m, 1b')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('time')
            .setDescription('How long they have to pay, e.g. 30m, 2h, 1d')
            .setRequired(true)
        )
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Optional: the payer\'s Discord account (gets pinged)')
        )
        .addUserOption((opt) =>
          opt.setName('receiver').setDescription('Optional: the receiver\'s Discord account')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Check that the Donut Stats setup works by looking up one player')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('DonutSMP username to look up')
            .setRequired(true)
            .setMaxLength(32)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Use this in the server.', ephemeral: true });
    }
    if (settings.staffOnly && !isStaff(interaction.member)) {
      return interaction.reply({ content: 'Only staff can use this.', ephemeral: true });
    }

    if (interaction.options.getSubcommand() === 'test') return runTest(interaction);
    return startPayment(interaction);
  },
};

// /track test — runs one !stats lookup and shows exactly what came back, so a
// wrong channel, a bot that doesn't answer, or an unreadable format is obvious.
async function runTest(interaction) {
  const name = interaction.options.getString('name').trim();
  if (!IGN_PATTERN.test(name)) {
    return interaction.reply({ content: `"${name}" doesn't look like a DonutSMP username.`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await donut.lookup(name);
    const precision = result.step > 1 ? ` (rounded — it only changes in steps of ${payments.money(result.step)})` : '';
    return interaction.editReply(
      `Working. Donut Stats says \`${name}\` has **${payments.money(result.value)}**${precision}.`
    );
  } catch (err) {
    let msg = statsErrorMessage(err, name, 'name');
    if (err.raw) {
      msg += `\n\nThis is what the bot said, so the reader can be adjusted to match:\n\`\`\`\n${err.raw.slice(0, 1200).replace(/```/g, "'''")}\n\`\`\``;
    }
    return interaction.editReply(msg);
  }
}

async function startPayment(interaction) {
  const payerIgn = (interaction.options.getString('payer_ign') || '').trim();
  const receiverIgn = (interaction.options.getString('receiver_ign') || '').trim();
  const payer = interaction.options.getUser('user'); // optional
  const receiver = interaction.options.getUser('receiver'); // optional
  const amount = payments.parseAmount(interaction.options.getString('amount'));
  const durationMs = payments.parseDuration(interaction.options.getString('time'));

  for (const [option, ign] of [
    ['payer_ign', payerIgn],
    ['receiver_ign', receiverIgn],
  ]) {
    if (!IGN_PATTERN.test(ign)) {
      return interaction.reply({
        content: `\`${option}\` should be a DonutSMP username (letters, numbers and underscores).`,
        ephemeral: true,
      });
    }
  }
  if (payerIgn.toLowerCase() === receiverIgn.toLowerCase()) {
    return interaction.reply({
      content: 'The payer and the receiver have the same DonutSMP username.',
      ephemeral: true,
    });
  }
  if ((payer && payer.bot) || (receiver && receiver.bot)) {
    return interaction.reply({ content: "Bots can't be part of a payment.", ephemeral: true });
  }
  if (payer && receiver && payer.id === receiver.id) {
    return interaction.reply({
      content: "The payer and the receiver can't be the same person.",
      ephemeral: true,
    });
  }
  if (!amount) {
    return interaction.reply({
      content: "I couldn't read that amount. Try something like `500k`, `2.5m`, `1b` or `1,000,000`.",
      ephemeral: true,
    });
  }
  if (!durationMs) {
    return interaction.reply({
      content: "I couldn't read that time. Try something like `30m`, `2h`, `1d` or `1h30m`.",
      ephemeral: true,
    });
  }
  const maxMs = settings.maxDurationDays * 24 * 60 * 60 * 1000;
  if (durationMs < MIN_DURATION_MS || durationMs > maxMs) {
    return interaction.reply({
      content: `The time has to be between 1 minute and ${settings.maxDurationDays} days.`,
      ephemeral: true,
    });
  }
  if (payments.getActive().length >= settings.maxActive) {
    return interaction.reply({
      content: `There are already ${settings.maxActive} payments being tracked. Wait for one to finish (or cancel one) and try again.`,
      ephemeral: true,
    });
  }

  // Looking both players up takes a few seconds, so acknowledge first.
  await interaction.deferReply({ ephemeral: true });

  // Starting balances. If either lookup fails there's nothing to compare
  // against later, so stop here and say why.
  let payerStats;
  let receiverStats;
  try {
    payerStats = await donut.lookup(payerIgn);
  } catch (err) {
    return interaction.editReply(statsErrorMessage(err, payerIgn, 'payer_ign'));
  }
  try {
    receiverStats = await donut.lookup(receiverIgn);
  } catch (err) {
    return interaction.editReply(statsErrorMessage(err, receiverIgn, 'receiver_ign'));
  }

  const channel =
    interaction.channel || (await interaction.client.channels.fetch(interaction.channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply("I can't post in this channel.");
  }

  const payment = payments.create({
    guildId: interaction.guildId,
    channelId: channel.id,
    messageId: null,
    createdBy: interaction.user.id,
    payerDiscordId: payer ? payer.id : null,
    receiverDiscordId: receiver ? receiver.id : null,
    payerIgn,
    receiverIgn,
    amount,
    deadline: Date.now() + durationMs,
    payerStart: payerStats.value,
    receiverStart: receiverStats.value,
    payerNow: payerStats.value,
    receiverNow: receiverStats.value,
  });

  // Posted as a normal channel message (not the slash command reply) so the
  // bot can keep editing it for as long as the payment is being tracked.
  let message;
  try {
    message = await channel.send({
      content: payer ? `<@${payer.id}>` : undefined,
      embeds: [buildEmbed(payment)],
      components: buildButtons(payment),
      allowedMentions: { users: payer ? [payer.id] : [] },
    });
  } catch (err) {
    payments.remove(payment.id);
    console.error('[payments] Failed to post the tracker message:', err);
    return interaction.editReply(
      "I couldn't post the tracker in this channel. Check that I can send messages and embeds here."
    );
  }

  payments.update(payment.id, { messageId: message.id });

  let reply = `Tracking started (ID \`${payment.id}\`). I'll post here when the payment goes through or time runs out.`;

  // If Donut Stats shows rounded money (like 2.92B), small payments can't be seen.
  const coarsest = Math.max(payerStats.step, receiverStats.step);
  if (coarsest > 1 && amount < coarsest * 2) {
    reply += `\n\nHeads up: Donut Stats only shows money rounded to the nearest ${payments.money(coarsest)}, so a payment this small may not show up. Use the **Mark as Paid** button if it doesn't.`;
  }
  await interaction.editReply(reply);
}

function statsErrorMessage(err, ign, option) {
  const command = `${settings.statsCommand} ${ign}`;
  switch (err.code) {
    case 'NOT_CONFIGURED':
      return `The Donut Stats channel isn't set up. Put the channel id in \`payments.statsChannelId\` in config.js (${err.message})`;
    case 'SEND_FAILED':
      return `I couldn't run \`${command}\` in the Donut Stats channel. Check that I can view and send messages there.`;
    case 'NO_REPLY':
      return `I ran \`${command}\` but the Donut Stats bot didn't answer. Make sure it's in that channel and can see it, and that it answers text commands from other bots. \`/track test\` shows what's happening.`;
    case 'UNPARSEABLE':
      return `The Donut Stats bot answered \`${command}\` but I couldn't find the money in its reply.`;
    case 'NOT_FOUND':
      return `Donut Stats couldn't find a player called \`${ign}\`. Check the spelling of the \`${option}\` option.`;
    default:
      console.error('[payments] Donut Stats lookup failed:', err);
      return "Something went wrong while asking Donut Stats. Try again in a moment.";
  }
}
