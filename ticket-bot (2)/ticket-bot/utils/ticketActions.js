const {
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');
const ticketStore = require('./ticketStore');
const { isStaff } = require('./permissions');
const { buildTranscript } = require('./transcript');

// This role always keeps SendMessages in a ticket, even after it's claimed
// and every other role gets locked out. Edit config.alwaysCanTypeRoleId to
// change it.
const ALWAYS_CAN_TYPE_ROLE_ID = config.alwaysCanTypeRoleId;

// Simple one-line system-notice embed used for claim/unclaim/close/rename
// notifications, so they look consistent instead of plain text.
function systemEmbed(description) {
  return new EmbedBuilder().setDescription(description).setColor(0x2b2d31);
}

// Posts a one-line embed (optionally with files, e.g. a transcript) to
// config.ticketLogChannelId. Silently does nothing if that's not set, and
// never throws — a logging failure shouldn't break the action itself.
async function logToChannel(interaction, description, files) {
  if (!config.ticketLogChannelId) return;
  try {
    const logChannel = await interaction.client.channels.fetch(config.ticketLogChannelId);
    await logChannel.send({ embeds: [systemEmbed(description)], files });
  } catch (err) {
    console.error('Failed to post to ticket log channel:', err);
  }
}

async function closeChannel(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can close this.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }

  await interaction.reply({ embeds: [systemEmbed('🔒 Closing ticket, making a transcript...')] });

  await finishClose(
    interaction,
    meta,
    `Ticket **#${interaction.channel.name}** closed by ${interaction.user} (opened by <@${meta.openerId}>).`
  );
}

// The actual closing work — transcript, DM to the opener, log message, then
// deleting the channel. Shared by the Close Ticket button / /ticket-close and
// by the "Agree" button on a close request. The caller is responsible for
// having already told the channel it's closing (reply / followUp) and for
// any permission checks.
async function finishClose(interaction, meta, logText) {
  const channel = interaction.channel;

  let transcript;
  try {
    transcript = await buildTranscript(channel);
  } catch (err) {
    console.error('Failed to build transcript:', err);
  }

  if (transcript && meta.openerId) {
    try {
      const opener = await interaction.client.users.fetch(meta.openerId);
      const closedEmbed = new EmbedBuilder()
        .setTitle('🔒 Ticket Closed')
        .setDescription(
          `Hello **${opener.username}**,\n\n` +
            `Your ticket (\`${channel.name}\`) has been closed.\n` +
            `A full transcript of your ticket conversation is attached below.`
        )
        .setColor(0x2b2d31)
        .setTimestamp();
      await opener.send({ files: [transcript], embeds: [closedEmbed] });
    } catch (err) {
      console.error('Failed to DM transcript to ticket opener:', err);
    }
  }

  // Also post the transcript in the log channel (skipped if it couldn't be built).
  if (config.ticketLogChannelId) {
    await logToChannel(interaction, logText, transcript ? [transcript] : undefined);
  }

  ticketStore.remove(channel.id);

  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 5000);
}

// ---- Request Close ----
// Staff press "Request Close" on a ticket. The bot pings the ticket opener
// with an embed asking whether they agree, with green Agree / red Disagree
// buttons. Only the opener can answer. Agree closes the ticket exactly like
// Close Ticket does; Disagree just dismisses the request. The requester's id
// is stored in the button ids (ticket_close_agree:<id>), so this survives bot
// restarts and nothing extra has to be saved.

// Channels whose close is already in progress from an Agree click, so a
// double-click can't start two closes.
const closing = new Set();

async function requestClose(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can request to close this.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta || !meta.openerId) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setDescription(`<@${meta.openerId}>, ${interaction.user} requested to close this ticket. Do you agree?`)
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close_agree:${interaction.user.id}`)
      .setLabel('Agree')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ticket_close_disagree:${interaction.user.id}`)
      .setLabel('Disagree')
      .setStyle(ButtonStyle.Danger)
  );

  // The ping goes in the message content — mentions inside an embed show the
  // name but don't notify anyone.
  await interaction.reply({
    content: `<@${meta.openerId}>`,
    embeds: [embed],
    components: [row],
  });
}

async function handleCloseAgree(interaction) {
  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }
  if (interaction.user.id !== meta.openerId) {
    return interaction.reply({ content: `Only <@${meta.openerId}> can respond to this.`, ephemeral: true });
  }
  if (closing.has(interaction.channel.id)) {
    return interaction.reply({ content: 'This ticket is already closing.', ephemeral: true });
  }
  closing.add(interaction.channel.id);

  const requesterId = interaction.customId.split(':')[1];

  await interaction.update({
    embeds: [systemEmbed(`${interaction.user} agreed to close this ticket.`)],
    components: [],
  });
  await interaction.followUp({ embeds: [systemEmbed('🔒 Closing ticket, making a transcript...')] });

  await finishClose(
    interaction,
    meta,
    `Ticket **#${interaction.channel.name}** closed by <@${requesterId}> after <@${meta.openerId}> agreed to the close request.`
  );
}

async function handleCloseDisagree(interaction) {
  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }
  if (interaction.user.id !== meta.openerId) {
    return interaction.reply({ content: `Only <@${meta.openerId}> can respond to this.`, ephemeral: true });
  }

  const requesterId = interaction.customId.split(':')[1];

  await interaction.update({
    embeds: [systemEmbed(`${interaction.user} declined the request from <@${requesterId}> to close this ticket.`)],
    components: [],
  });
}

async function renameChannel(interaction, newName) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can rename this.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }

  const sanitized = newName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 90);

  const oldName = interaction.channel.name;
  await interaction.channel.setName(sanitized);

  await interaction.reply({
    embeds: [systemEmbed(`${interaction.user} renamed this ticket to \`${sanitized}\``)],
  });

  await logToChannel(
    interaction,
    `✏️ ${interaction.user} renamed ticket **#${oldName}** to \`${sanitized}\`.`
  );
}

// Strips the footer off an embed and returns a fresh EmbedBuilder — used so
// unclaiming removes the "Claimed by" note that claiming added.
function withoutFooter(embed) {
  if (!embed) return null;
  const data = embed.toJSON();
  delete data.footer;
  return EmbedBuilder.from(data);
}

// Button rows shown on a ticket message — no emojis on any of them. Claim
// Ticket is green (Success), Rename Ticket is blurple (Primary), Request
// Close is grey (Secondary) and Close Ticket is red (Danger). Claim Ticket
// flips to Unclaim Ticket (grey) once claimed.
function renameButton() {
  return new ButtonBuilder()
    .setCustomId('ticket_rename_btn')
    .setLabel('Rename Ticket')
    .setStyle(ButtonStyle.Primary);
}

function requestCloseButton() {
  return new ButtonBuilder()
    .setCustomId('ticket_request_close_btn')
    .setLabel('Request Close')
    .setStyle(ButtonStyle.Secondary);
}

function closeButton() {
  return new ButtonBuilder()
    .setCustomId('ticket_close_btn')
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);
}

function claimedRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_unclaim_btn')
      .setLabel('Unclaim Ticket')
      .setStyle(ButtonStyle.Secondary),
    renameButton(),
    requestCloseButton(),
    closeButton()
  );
}

function unclaimedRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim_btn')
      .setLabel('Claim Ticket')
      .setStyle(ButtonStyle.Success),
    renameButton(),
    requestCloseButton(),
    closeButton()
  );
}

// Application tickets have no Claim button (it's not a support ticket).
function noClaimRow() {
  return new ActionRowBuilder().addComponents(renameButton(), requestCloseButton(), closeButton());
}

// Claiming a ticket locks SendMessages on every role that normally has
// access to it (the staff role + that category's ping role), then grants
// SendMessages back to just the claiming staff member. Administrators are
// unaffected since Discord's Administrator permission bypasses channel
// overwrites entirely, the ticket opener's own overwrite is never touched so
// they can keep talking, and ALWAYS_CAN_TYPE_ROLE_ID is skipped entirely so
// that role can always type even in a claimed ticket.
async function claimTicket(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can claim tickets.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta || meta.type !== 'ticket') {
    return interaction.reply({ content: 'This channel cannot be claimed.', ephemeral: true });
  }

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (meta.claimedBy && meta.claimedBy !== interaction.user.id && !isAdmin) {
    return interaction.reply({
      content: `This ticket is already claimed by <@${meta.claimedBy}>.`,
      ephemeral: true,
    });
  }

  const roleIds = meta.rolesWithAccess || [];
  for (const roleId of roleIds) {
    if (roleId === ALWAYS_CAN_TYPE_ROLE_ID) continue; // this role always keeps access
    await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: false }).catch(() => {});
  }
  await interaction.channel.permissionOverwrites
    .edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    })
    .catch(() => {});

  ticketStore.update(interaction.channel.id, { claimedBy: interaction.user.id });

  const embed = interaction.message.embeds[0]
    ? EmbedBuilder.from(interaction.message.embeds[0]).setFooter({ text: `Claimed by ${interaction.user.tag}` })
    : null;

  await interaction.update({
    embeds: embed ? [embed] : interaction.message.embeds,
    components: [claimedRow()],
  });
  await interaction.followUp({
    embeds: [systemEmbed(`${interaction.user} claimed this ticket`)],
  });

  await logToChannel(
    interaction,
    `🔒 ${interaction.user} claimed ticket **#${interaction.channel.name}**.`
  );
}

async function unclaimTicket(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can unclaim tickets.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta || meta.type !== 'ticket' || !meta.claimedBy) {
    return interaction.reply({ content: 'This ticket is not currently claimed.', ephemeral: true });
  }

  const isClaimer = meta.claimedBy === interaction.user.id;
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isClaimer && !isAdmin) {
    return interaction.reply({
      content: `Only <@${meta.claimedBy}> (or an admin) can unclaim this ticket.`,
      ephemeral: true,
    });
  }

  const roleIds = meta.rolesWithAccess || [];
  for (const roleId of roleIds) {
    await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true }).catch(() => {});
  }
  await interaction.channel.permissionOverwrites.delete(meta.claimedBy).catch(() => {});

  ticketStore.update(interaction.channel.id, { claimedBy: null });

  const embed = withoutFooter(interaction.message.embeds[0]);

  await interaction.update({
    embeds: embed ? [embed] : interaction.message.embeds,
    components: [unclaimedRow()],
  });
  await interaction.followUp({
    embeds: [systemEmbed(`🔓 Ticket unclaimed by ${interaction.user} — staff can type here again.`)],
  });

  await logToChannel(
    interaction,
    `🔓 ${interaction.user} unclaimed ticket **#${interaction.channel.name}**.`
  );
}

// Rename Ticket button — opens a small modal asking for the new name, since
// buttons can't collect text input directly. The modal submit calls the same
// renameChannel() used by /ticket-rename and /rename, so behavior stays
// identical no matter how staff trigger a rename.
function renameModal() {
  const modal = new ModalBuilder().setCustomId('ticket_rename_modal').setTitle('Rename Ticket');
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('New channel name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(90);
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return modal;
}

async function handleRenameButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can rename this.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }

  await interaction.showModal(renameModal());
}

async function handleRenameModalSubmit(interaction) {
  const newName = interaction.fields.getTextInputValue('name');
  await renameChannel(interaction, newName);
}

// /ticket-add user:<user> — staff only, adds someone to whatever ticket or
// application-ticket channel the command is run in.
async function addUserToTicket(interaction, user) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can add someone to a ticket.', ephemeral: true });
  }

  const meta = ticketStore.get(interaction.channel.id);
  if (!meta) {
    return interaction.reply({ content: 'This is not a ticket or application channel.', ephemeral: true });
  }

  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  await interaction.reply(`${user} has been added to this ticket by ${interaction.user}.`);
}

module.exports = {
  closeChannel,
  requestClose,
  handleCloseAgree,
  handleCloseDisagree,
  renameChannel,
  claimTicket,
  unclaimTicket,
  handleRenameButton,
  handleRenameModalSubmit,
  addUserToTicket,
  claimedRow,
  unclaimedRow,
  noClaimRow,
};
