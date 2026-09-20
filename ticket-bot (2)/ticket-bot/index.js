require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Collection, Events, ChannelType } = require('discord.js');
const cron = require('node-cron');

const config = require('./config');
const points = require('./utils/points');
const {
  closeChannel,
  requestClose,
  handleCloseAgree,
  handleCloseDisagree,
  claimTicket,
  unclaimTicket,
  handleRenameButton,
  handleRenameModalSubmit,
} = require('./utils/ticketActions');
const { handleTicketOpen } = require('./handlers/ticketHandlers');
const {
  handleApplicationSelect,
  handleApplicationAccept,
  handleApplicationAcceptReason,
  handleApplicationAcceptReasonModal,
  handleApplicationDeny,
  handleApplicationDenyReason,
  handleApplicationDenyReasonModal,
  handleApplicationOpenTicket,
} = require('./handlers/applicationHandlers');
const { handleLeaderboardRoleSelect } = require('./handlers/leaderboardHandlers');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  // Needed so DM channels/messages arrive properly — applications are now
  // answered over DM instead of in a per-applicant guild channel.
  partials: [Partials.Channel, Partials.Message],
});

// Load slash commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Checks every category id in config.js against the server the bot is in and
// prints a warning naming the exact setting if one is wrong. A bad id is what
// causes "parent_id[CHANNEL_PARENT_INVALID]: Category does not exist" when
// someone opens a ticket. Empty ('') ids are skipped on purpose — those
// tickets are just created without a category.
async function checkConfiguredCategories(c) {
  const guild = await c.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.warn(`[config check] The bot isn't in the server GUILD_ID=${config.guildId}.`);
    return;
  }

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return;

  const toCheck = [];
  for (const [key, v] of Object.entries(config.ticketCategories || {})) {
    toCheck.push([`ticketCategories.${key}.categoryId`, v.categoryId]);
  }
  for (const [key, v] of Object.entries(config.applicationCategories || {})) {
    toCheck.push([`applicationCategories.${key}.ticketCategoryId`, v.ticketCategoryId]);
  }

  let problems = 0;
  for (const [label, id] of toCheck) {
    if (!id) continue;
    const channel = channels.get(id);
    if (!channel) {
      problems++;
      console.warn(`[config check] ${label} = "${id}" — no channel with that id exists in "${guild.name}".`);
    } else if (channel.type !== ChannelType.GuildCategory) {
      problems++;
      console.warn(`[config check] ${label} = "${id}" — that's the channel #${channel.name}, not a category.`);
    }
  }
  if (!problems) console.log('[config check] All category ids in config.js look good.');
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await checkConfiguredCategories(c).catch((err) => console.error('[config check] failed:', err));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('ticket_open_')) {
        return await handleTicketOpen(interaction);
      }
      if (interaction.customId === 'ticket_close_btn') {
        return await closeChannel(interaction);
      }
      if (interaction.customId === 'ticket_request_close_btn') {
        return await requestClose(interaction);
      }
      if (interaction.customId.startsWith('ticket_close_agree:')) {
        return await handleCloseAgree(interaction);
      }
      if (interaction.customId.startsWith('ticket_close_disagree:')) {
        return await handleCloseDisagree(interaction);
      }
      if (interaction.customId === 'ticket_claim_btn') {
        return await claimTicket(interaction);
      }
      if (interaction.customId === 'ticket_unclaim_btn') {
        return await unclaimTicket(interaction);
      }
      if (interaction.customId === 'ticket_rename_btn') {
        return await handleRenameButton(interaction);
      }
      // Order matters: the "_reason" variants must be checked before their
      // plain counterparts since e.g. 'application_accept_reason:' also
      // starts with 'application_accept' (but not with 'application_accept:').
      if (interaction.customId.startsWith('application_accept_reason:')) {
        return await handleApplicationAcceptReason(interaction);
      }
      if (interaction.customId.startsWith('application_accept:')) {
        return await handleApplicationAccept(interaction);
      }
      if (interaction.customId.startsWith('application_deny_reason:')) {
        return await handleApplicationDenyReason(interaction);
      }
      if (interaction.customId.startsWith('application_deny:')) {
        return await handleApplicationDeny(interaction);
      }
      if (interaction.customId.startsWith('application_open_ticket:')) {
        return await handleApplicationOpenTicket(interaction);
      }
      // application_yes / application_no / application_cancel buttons are
      // consumed directly by the awaitMessageComponent collectors inside
      // utils/applicationFlow.js — nothing to do for them here.
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'ticket_rename_modal') {
        return await handleRenameModalSubmit(interaction);
      }
      if (interaction.customId.startsWith('application_accept_reason_modal:')) {
        return await handleApplicationAcceptReasonModal(interaction);
      }
      if (interaction.customId.startsWith('application_deny_reason_modal:')) {
        return await handleApplicationDenyReasonModal(interaction);
      }
      // ticket_modal_* (the per-category intake form) is consumed directly
      // by the awaitModalSubmit collector inside handlers/ticketHandlers.js
      // — nothing to do for it here.
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'application_select') {
      return await handleApplicationSelect(interaction);
    }

    if (interaction.isRoleSelectMenu() && interaction.customId === 'leaderboard_role_select') {
      return await handleLeaderboardRoleSelect(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: 'Something went wrong while handling that.', ephemeral: true })
        .catch(() => {});
    }
  }
});

// Weekly points reset — every Monday at 1:00 AM in the configured timezone.
cron.schedule(
  '0 1 * * 1',
  () => {
    points.resetAll();
    console.log('[Points] Weekly leaderboard has been reset.');
  },
  { timezone: config.timezone }
);

client.login(config.token);
