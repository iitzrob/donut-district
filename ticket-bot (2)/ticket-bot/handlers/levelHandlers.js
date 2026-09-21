const levels = require('../utils/levels');
const ticketStore = require('../utils/ticketStore');
const config = require('../config');

// Gives `member` the reward role(s) for `level`. Called on every level-up, and
// it looks at everything up to their level, so anyone who is missing a role
// (e.g. they leveled before the rewards were set up) gets it on their next
// level-up. Throws if Discord refuses — the caller logs it.
async function applyRoleRewards(member, level) {
  const { earned, highest, all } = levels.rolesForLevel(level);
  if (!earned.length) return;

  const has = (roleId) => member.roles.cache.has(roleId);
  let toAdd;
  let toRemove = [];

  if (levels.cfg.stackRoleRewards) {
    toAdd = earned.filter((roleId) => !has(roleId));
  } else {
    toAdd = has(highest) ? [] : [highest];
    toRemove = all.filter((roleId) => roleId !== highest && has(roleId));
  }

  if (toAdd.length) await member.roles.add(toAdd, `Reached level ${level}`);
  if (toRemove.length) await member.roles.remove(toRemove, `Replaced by a higher level reward (level ${level})`);
}

// Makes a member's reward roles match `level` in BOTH directions — used after
// /xp-add and /xp-remove, so removing XP also takes away roles they no longer
// qualify for. Throws if Discord refuses — the caller handles it.
async function syncRoleRewards(member, level) {
  const { earned, highest, all } = levels.rolesForLevel(level);
  if (!all.length) return;

  const has = (roleId) => member.roles.cache.has(roleId);
  let toAdd;
  let toRemove;

  if (levels.cfg.stackRoleRewards) {
    toAdd = earned.filter((roleId) => !has(roleId));
    toRemove = all.filter((roleId) => !earned.includes(roleId) && has(roleId));
  } else {
    toAdd = highest && !has(highest) ? [highest] : [];
    toRemove = all.filter((roleId) => roleId !== highest && has(roleId));
  }

  if (toAdd.length) await member.roles.add(toAdd, `Level set to ${level} by staff`);
  if (toRemove.length) await member.roles.remove(toRemove, `Level set to ${level} by staff`);
}

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

  await announceLevelUp(message, result.level).catch((err) =>
    console.error('[levels] Failed to send the level-up message:', err)
  );

  // Role rewards. A failure here (missing permission, role above the bot) is
  // only logged — it never stops the announcement or XP.
  try {
    const member = message.member || (await message.guild.members.fetch(message.author.id));
    await applyRoleRewards(member, result.level);
  } catch (err) {
    console.error(`[levels] Couldn't give the level ${result.level} role reward to ${message.author.tag}:`, err.message);
  }
}

async function announceLevelUp(message, level) {
  const { cfg } = levels;

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
    content: `${message.author} has reached level **${level}**. Keep up the grind!!`,
    allowedMentions: { users: [message.author.id] },
  });
}

module.exports = { handleLevelMessage, applyRoleRewards, syncRoleRewards };
