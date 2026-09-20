const { SlashCommandBuilder } = require('discord.js');
const levels = require('../utils/levels');

const PER_PAGE = 10;

const fmt = (n) => n.toLocaleString('en-US');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Check levels')
    .addSubcommand((sub) =>
      sub
        .setName('rank')
        .setDescription('Show your level, or someone else’s')
        .addUserOption((opt) => opt.setName('user').setDescription('Who to look up (default: you)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('Show the server level leaderboard')
        .addIntegerOption((opt) =>
          opt.setName('page').setDescription('Which page to show').setMinValue(1)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Plain text only. Mentions show the person's name without pinging them.
    const noPings = { parse: [] };

    if (sub === 'rank') {
      const user = interaction.options.getUser('user') || interaction.user;
      const xp = levels.getXp(user.id);
      const { level, maxed, into, needed } = levels.getProgress(xp);
      const rank = levels.getRank(user.id);

      const first = `<@${user.id}> — Level **${level}**${maxed ? ' (MAX)' : ''} · ${
        rank ? `Rank #${rank}` : 'Unranked'
      }`;
      const second = maxed
        ? `${fmt(xp)} total XP`
        : `${fmt(into)} / ${fmt(needed)} XP to level ${level + 1} · ${fmt(xp)} total XP`;

      return interaction.reply({ content: `${first}\n${second}`, allowedMentions: noPings });
    }

    // /level leaderboard
    const ranked = levels.getRanked();
    if (!ranked.length) {
      return interaction.reply({ content: 'Nobody has earned any XP yet.' });
    }

    const pages = Math.ceil(ranked.length / PER_PAGE);
    const page = Math.min(interaction.options.getInteger('page') || 1, pages);
    const start = (page - 1) * PER_PAGE;

    const lines = ranked
      .slice(start, start + PER_PAGE)
      .map(
        (entry, i) =>
          `**#${start + i + 1}** <@${entry.userId}> — Level **${levels.levelFromXp(entry.xp)}** · ${fmt(entry.xp)} XP`
      );

    const yourRank = levels.getRank(interaction.user.id);
    const footer = `Page ${page}/${pages}${yourRank ? ` · Your rank: #${yourRank}` : ''}`;

    await interaction.reply({
      content: `**Level Leaderboard**\n${lines.join('\n')}\n${footer}`,
      allowedMentions: noPings,
    });
  },
};
