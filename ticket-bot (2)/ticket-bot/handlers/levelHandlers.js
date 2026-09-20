const levels = require('../utils/levels');
const ticketStore = require('../utils/ticketStore');
const config = require('../config');

// Runs on every message. Gives the author XP (once per cooldown) and, if that
// levels them up, posts the announcement in the level-up channel.
async function handleLevelMessage(message) {
  if (message.author.bot || message.system || !message.guild) return;
  if (message.guild.id !== config.guildId) return;

  const { cfg } = levels;

  // Optional: only count messages in certain channels (empty = every channel).
  if (cfg.xpChannelIds.length && !cfg.xpChannelIds.includes(message.channel.id)) return;

  // In-memory check first — most messages stop here, so the slower
  // ticket check below only runs about once a minute per person.
  if (!levels.offCooldown(message.author.id)) return;

  // Chatting inside tickets doesn't earn XP.
  if (ticketStore.get(message.channel.id)) return;

  const result = levels.grantMessageXp(message.author.id);
  if (!result) return;

  if (!cfg.channelId) {
    console.warn('[levels] config.levels.channelId is empty, so level-up messages are not being sent.');
    return;
  }

  const channel = await message.client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[levels] Can't find a text channel with id ${cfg.channelId} for level-up messages.`);
    return;
  }

  await channel.send({
    content: `${message.author} has reached level **${result.level}**. Keep up the grind!!`,
    allowedMentions: { users: [message.author.id] },
  });
}

module.exports = { handleLevelMessage };
