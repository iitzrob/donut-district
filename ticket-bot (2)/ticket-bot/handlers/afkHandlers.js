const { EmbedBuilder } = require('discord.js');
const { getAfk, clearAfk, formatDuration } = require('../utils/afk');

async function handleAfkMessage(message) {
  if (message.author.bot) return;

  // The author was AFK and just sent a message — welcome them back.
  const authorAfk = getAfk(message.author.id);
  if (authorAfk) {
    clearAfk(message.author.id);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(` Welcome back <@${message.author.id}>, we missed you!`);

    await message.channel.send({ embeds: [welcomeEmbed] }).catch(() => {});
  }

  // Anyone @mentioned, or whoever's message this is a reply to, gets checked
  // for an AFK status. A Set avoids pinging the same AFK user twice if they
  // were both mentioned and replied to in the same message.
  const mentionedIds = new Set(message.mentions.users.map((u) => u.id));

  if (message.reference) {
    try {
      const repliedMessage = await message.fetchReference();
      if (repliedMessage?.author) mentionedIds.add(repliedMessage.author.id);
    } catch {
      // Original message may have been deleted — nothing to check.
    }
  }

  mentionedIds.delete(message.author.id);

  for (const userId of mentionedIds) {
    const afk = getAfk(userId);
    if (!afk) continue;

    const afkEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(`Hey, <@${userId}> is afk: ${afk.reason}`)
      .addFields({
        name: 'Last Seen',
        value: `${formatDuration(Date.now() - afk.since)} ago`,
      });

    await message.channel.send({ embeds: [afkEmbed] }).catch(() => {});
  }
}

module.exports = { handleAfkMessage };
