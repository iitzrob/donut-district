const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const fmt = (n) => n.toLocaleString('en-US');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('Show the member count and boost level of the server')
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;

    // memberCount counts everyone in the server, bots included.
    const description = [
      '## Members',
      '',
      `* ***${fmt(guild.memberCount)}***`,
      '',
      '## Boosts',
      '',
      `* ***Level ${guild.premiumTier}***`,
      `* ***${fmt(guild.premiumSubscriptionCount || 0)} Boosts***`,
    ].join('\n');

    const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription(description);

    return interaction.reply({ embeds: [embed] });
  },
};
