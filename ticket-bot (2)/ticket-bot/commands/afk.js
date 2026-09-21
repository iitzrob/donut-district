const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { setAfk } = require('../utils/afk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set yourself as AFK')
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Why you are AFK')
        .setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const reason = interaction.options.getString('reason') || 'AFK';

    setAfk(interaction.user.id, reason);

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(` Set your status to **AFK**: ${reason}`);

    return interaction.reply({ embeds: [embed] });
  },
};
