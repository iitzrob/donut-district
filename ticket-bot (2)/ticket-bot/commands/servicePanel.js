const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const categories = require('../data/serviceCategories');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('service-panel')
    .setDescription('Post the DonutSMP services ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    // Same layout as the main ticket panel: emoji + bold name, then the
    // description as a quote. Built from data/serviceCategories.js so the
    // embed and the buttons can never get out of sync.
    const description = categories
      .map((c) => `${c.emoji} **${c.label}**\n\n> ${c.description}`)
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(config.servicePanelTitle)
      .setDescription(description);

    // Buttons use the same `ticket_open_<id>` ids as the main panel, so the
    // existing handler in handlers/ticketHandlers.js opens these tickets.
    const row = new ActionRowBuilder().addComponents(
      categories.map((c) =>
        new ButtonBuilder()
          .setCustomId(`ticket_open_${c.id}`)
          .setLabel(c.label)
          .setEmoji(c.emoji)
          .setStyle(ButtonStyle.Secondary)
      )
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row],
    });

    await interaction.reply({ content: 'Service panel posted.', ephemeral: true });
  },
};
