const { SlashCommandBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isBypassRole } = require('../utils/permissions');
const { resolveEmojiShortcodes } = require('../utils/parseEmoji');

// /embed — posts a custom embed anywhere. Restricted to config.alwaysCanTypeRoleId
// (see utils/permissions.js#isBypassRole) or anyone with Administrator.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Post a custom embed')
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Embed title').setMaxLength(256)
    )
    .addStringOption((opt) =>
      opt.setName('description').setDescription('Embed description').setMaxLength(4000)
    )
    .addStringOption((opt) =>
      opt.setName('color').setDescription('Hex color, e.g. #2b2d31')
    )
    .addStringOption((opt) =>
      opt.setName('image').setDescription('Large image URL')
    )
    .addStringOption((opt) =>
      opt.setName('thumbnail').setDescription('Small thumbnail image URL')
    )
    .addStringOption((opt) =>
      opt.setName('footer').setDescription('Footer text').setMaxLength(2048)
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to post in (defaults to this channel)')
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin && !isBypassRole(interaction.member)) {
      return interaction.reply({ content: 'You do not have permission to use this.', ephemeral: true });
    }

    const guild = interaction.guild;
    const title = resolveEmojiShortcodes(guild, interaction.options.getString('title'));
    const description = resolveEmojiShortcodes(guild, interaction.options.getString('description'));
    const colorInput = interaction.options.getString('color');
    const image = interaction.options.getString('image');
    const thumbnail = interaction.options.getString('thumbnail');
    const footer = resolveEmojiShortcodes(guild, interaction.options.getString('footer'));
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (!title && !description && !image && !thumbnail) {
      return interaction.reply({
        content: 'Give at least a title, description, image, or thumbnail — an empty embed cannot be sent.',
        ephemeral: true,
      });
    }

    let color = 0x2b2d31;
    if (colorInput) {
      const parsed = parseInt(colorInput.replace('#', ''), 16);
      if (Number.isNaN(parsed)) {
        return interaction.reply({
          content: `"${colorInput}" isn't a valid hex color — try something like #2b2d31.`,
          ephemeral: true,
        });
      }
      color = parsed;
    }

    const embed = new EmbedBuilder().setColor(color);
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (footer) embed.setFooter({ text: footer });

    try {
      await targetChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to send /embed:', err);
      return interaction.reply({
        content: `Something went wrong sending that embed — check the image/thumbnail URLs.\n\`\`\`${err.message}\`\`\``,
        ephemeral: true,
      });
    }

    await interaction.reply({ content: `Embed posted in ${targetChannel}.`, ephemeral: true });
  },
};
