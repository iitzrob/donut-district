const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');
const DECISION_COLORS = {
  accepted: 0x57f287, // Discord green
  denied: 0xed4245, // Discord red
};
const ticketStore = require('../utils/ticketStore');
const applicationQuestions = require('../data/applicationQuestions');
const { runApplicationFlow } = require('../utils/applicationFlow');
const { buildDecisionRow } = require('../utils/applicationDecision');
const { createPrivateChannel } = require('../utils/ticketCreation');
const { isStaff } = require('../utils/permissions');
const { noClaimRow } = require('../utils/ticketActions');
const { bold } = require('../utils/textStyle');

async function handleApplicationSelect(interaction) {
  const value = interaction.values[0];
  const appConfig = applicationQuestions[value];
  if (!appConfig) {
    return interaction.reply({ content: bold('Unknown application type.'), ephemeral: true });
  }

  const existing = ticketStore.findOpenByUser(interaction.user.id, value);
  if (existing) {
    return interaction.reply({
      content: bold('You already have an open application of this type — check your DMs with the bot to continue it.'),
      ephemeral: true,
    });
  }

  const appCfg = config.applicationCategories[value] || {};
  if (!appCfg.reviewChannelId) {
    return interaction.reply({
      content: bold("This application type isn't fully set up yet (no review channel configured) — ask an admin to check config.js."),
      ephemeral: true,
    });
  }

  const reviewChannel = await interaction.client.channels.fetch(appCfg.reviewChannelId).catch(() => null);
  if (!reviewChannel) {
    return interaction.reply({
      content: bold("The review channel for this application type couldn't be found — ask an admin to check config.js."),
      ephemeral: true,
    });
  }

  const introEmbed = new EmbedBuilder()
    .setTitle(bold(appConfig.label))
    .setDescription(
      bold(
        `You'll be asked ${appConfig.questions.length} questions one at a time. Just type your answer here to move to the next one, or press Cancel at any point to stop.`
      )
    )
    .setColor(0x2b2d31);

  let dmChannel;
  try {
    dmChannel = await interaction.user.createDM();
    await dmChannel.send({ embeds: [introEmbed] });
  } catch (err) {
    return interaction.reply({
      content: bold("I couldn't DM you to start the application — please enable direct messages from server members in your Privacy Settings and try again."),
      ephemeral: true,
    });
  }

  await interaction.reply({ content: bold("Check your DMs — I've started your application there!"), ephemeral: true });

  const appId = crypto.randomUUID();
  ticketStore.add(appId, {
    type: 'application',
    category: value,
    openerId: interaction.user.id,
    openedAt: Date.now(),
  });

  runApplicationFlow(dmChannel, interaction.user, appConfig, {
    reviewChannel,
    pingRoleId: appCfg.pingRoleId,
    appId,
  }).catch((err) => {
    console.error('Application flow error:', err);
  });
}

function getAppId(interaction) {
  return interaction.customId.split(':')[1];
}

function reasonModal(customId, title) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

// Builds the "<applicant>'s submission has been <accepted/denied> successfully
// by <staff>" line used both as the public confirmation and as the text
// stamped on the review message once the buttons are disabled. Appends a
// Reason line underneath when one was given.
//
// The mentions (<@id>) are left as literal ASCII so Discord renders them —
// only the surrounding bot-authored words get the bold-Unicode treatment.
// The reason itself is staff-typed text and is left exactly as written.
function decisionMessage(action, meta, actor, reason) {
  let msg = `<@${meta.openerId}>${bold("'s submission has been")} **${bold(action)}** ${bold('successfully by')} ${actor}.`;
  if (reason) msg += `\n**${bold('Reason')}:** ${reason}`;
  return msg;
}

// Disables every button on the review message and stamps it with the final
// decision (and reason, if one was given). Works for both a plain button
// interaction and a modal-submit interaction — both expose `.message`.
async function finalizeDecision(interaction, action, meta, reason) {
  const disabledRow = buildDecisionRow(getAppId(interaction), { disabled: true });
  const content = decisionMessage(action, meta, interaction.user, reason);

  const [existingEmbed] = interaction.message.embeds;
  const color = DECISION_COLORS[action];
  const embeds =
    existingEmbed && color !== undefined
      ? [EmbedBuilder.from(existingEmbed).setColor(color)]
      : undefined;

  await interaction.message
    .edit({ content, components: [disabledRow], ...(embeds ? { embeds } : {}) })
    .catch(() => {});
}

function getOpenApplication(interaction) {
  const appId = getAppId(interaction);
  const meta = ticketStore.get(appId);
  if (!meta || meta.type !== 'application') return { appId, meta: null };
  return { appId, meta };
}

async function processAccept(interaction, appId, meta, reason) {
  const appCfg = config.applicationCategories[meta.category] || {};
  const roleId = appCfg.acceptedRoleId;
  let roleNote = '';

  if (roleId) {
    try {
      const member = await interaction.guild.members.fetch(meta.openerId);
      await member.roles.add(roleId);
      roleNote = ` <@&${roleId}> ${bold('has been given to')} <@${meta.openerId}>.`;
    } catch (err) {
      console.error('Failed to add accepted role:', err);
      roleNote = ` ${bold('(Could not assign the accepted role automatically — check bot role position/permissions.)')}`;
    }
  }

  await interaction.editReply(decisionMessage('accepted', meta, interaction.user, reason) + roleNote);
  await finalizeDecision(interaction, 'accepted', meta, reason);
  ticketStore.remove(appId);

  try {
    const applicant = await interaction.client.users.fetch(meta.openerId);
    const msg = reason
      ? `🎉 ${bold('Your application has been')} **${bold('accepted')}**!\n**${bold('Reason')}:** ${reason}`
      : `🎉 ${bold('Your application has been')} **${bold('accepted')}**! ${bold('Staff will follow up if there are next steps.')}`;
    await applicant.send(msg);
  } catch {
    // Applicant has DMs closed — nothing more we can do.
  }
}

async function processDeny(interaction, appId, meta, reason) {
  await interaction.reply(decisionMessage('denied', meta, interaction.user, reason));
  await finalizeDecision(interaction, 'denied', meta, reason);
  ticketStore.remove(appId);

  try {
    const applicant = await interaction.client.users.fetch(meta.openerId);
    const msg = reason
      ? `${bold('Your application was')} **${bold('denied')}**.\n**${bold('Reason')}:** ${reason}`
      : `${bold('Your application was')} **${bold('denied')}**. ${bold("You're welcome to apply again in the future.")}`;
    await applicant.send(msg);
  } catch {
    // Applicant has DMs closed — nothing more we can do.
  }
}

async function handleApplicationAccept(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: bold('Only staff can accept/deny applications.'), ephemeral: true });
  }
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  await interaction.deferReply();
  await processAccept(interaction, appId, meta, null);
}

async function handleApplicationAcceptReason(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: bold('Only staff can accept/deny applications.'), ephemeral: true });
  }
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  await interaction.showModal(reasonModal(`application_accept_reason_modal:${appId}`, 'Accept with Reason'));
}

async function handleApplicationAcceptReasonModal(interaction) {
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  await interaction.deferReply();
  const reason = interaction.fields.getTextInputValue('reason');
  await processAccept(interaction, appId, meta, reason);
}

async function handleApplicationDeny(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: bold('Only staff can accept/deny applications.'), ephemeral: true });
  }
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  await processDeny(interaction, appId, meta, null);
}

async function handleApplicationDenyReason(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: bold('Only staff can accept/deny applications.'), ephemeral: true });
  }
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  await interaction.showModal(reasonModal(`application_deny_reason_modal:${appId}`, 'Deny with Reason'));
}

async function handleApplicationDenyReasonModal(interaction) {
  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }
  const reason = interaction.fields.getTextInputValue('reason');
  await processDeny(interaction, appId, meta, reason);
}

// "Open a Ticket" — pulls the applicant into a private ticket channel under
// the category configured for their application type (config.js ->
// applicationCategories.<type>.ticketCategoryId), pinging the same role that
// gets pinged for that application type. This ticket has no Claim button.
async function handleApplicationOpenTicket(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: bold('Only staff can open a ticket for an application.'), ephemeral: true });
  }

  const { appId, meta } = getOpenApplication(interaction);
  if (!meta) {
    return interaction.reply({ content: bold('This application is no longer available (already handled, or the bot restarted).'), ephemeral: true });
  }

  if (meta.ticketChannelId) {
    return interaction.reply({
      content: `${bold('A ticket is already open for this application:')} <#${meta.ticketChannelId}>`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const appConfig = applicationQuestions[meta.category];
  const appCfg = config.applicationCategories[meta.category] || {};
  const applicant = await interaction.client.users.fetch(meta.openerId).catch(() => null);

  const { channel, rolesWithAccess } = await createPrivateChannel({
    guild: interaction.guild,
    name: `${appConfig.prefix}-${applicant ? applicant.username : meta.openerId}`,
    parentId: appCfg.ticketCategoryId,
    openerId: meta.openerId,
    roleIds: [config.staffRoleId, appCfg.pingRoleId],
  });

  // Question text is bot-authored, so it gets bolded; each answer is the
  // applicant's own typed text and is left exactly as they wrote it.
  const answersBlock = (meta.answers || [])
    .map((a, i) => `**${bold(`${i + 1}. ${a.question}`)}**\n${a.answer}`)
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle(bold(`${appConfig.label} — Ticket`))
    .setDescription(
      `<@${meta.openerId}>, ${bold('staff have opened a ticket to follow up on your application.')}${answersBlock ? `\n\n${answersBlock}` : ''}`
    )
    .setColor(0x2b2d31);

  // No Claim button here on purpose — application ticket, not a support ticket.
  const closeRow = noClaimRow();

  const pings = [`<@${meta.openerId}>`];
  if (appCfg.pingRoleId) pings.push(`<@&${appCfg.pingRoleId}>`);

  await channel.send({ content: pings.join(' '), embeds: [embed], components: [closeRow] });

  ticketStore.add(channel.id, {
    type: 'ticket',
    category: `${meta.category}_application`,
    openerId: meta.openerId,
    openedAt: Date.now(),
    rolesWithAccess,
    claimedBy: null,
  });

  ticketStore.update(appId, { ticketChannelId: channel.id });

  await interaction.message.edit({ components: [buildDecisionRow(appId, { ticketOpened: true })] }).catch(() => {});

  await interaction.editReply(`${bold('Ticket created:')} ${channel}`);
}

module.exports = {
  handleApplicationSelect,
  handleApplicationAccept,
  handleApplicationAcceptReason,
  handleApplicationAcceptReasonModal,
  handleApplicationDeny,
  handleApplicationDenyReason,
  handleApplicationDenyReasonModal,
  handleApplicationOpenTicket,
};
