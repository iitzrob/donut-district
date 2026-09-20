const { SlashCommandBuilder, EmbedBuilder, ChannelType, escapeMarkdown } = require('discord.js');

// Shown on the "Owner" line. Add or remove Discord user ids here.
const OWNER_IDS = ['1483443804769095744', '1480382650551111844'];

const fmt = (n) => n.toLocaleString('en-US');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information about the server')
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;

    const channels = guild.channels.cache;
    const countOf = (...types) => channels.filter((c) => types.includes(c.type)).size;

    const categories = countOf(ChannelType.GuildCategory);
    const text = countOf(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    const voice = countOf(ChannelType.GuildVoice, ChannelType.GuildStageVoice);

    // The @everyone role is left out of the role count.
    const roles = Math.max(0, guild.roles.cache.size - 1);

    const boosts = guild.premiumSubscriptionCount || 0;
    const created = Math.floor(guild.createdTimestamp / 1000);

    // The blank lines are the small separators between the groups.
    const description = [
      `## ${escapeMarkdown(guild.name)}`,
      '',
      `**Owner**: ${OWNER_IDS.map((id) => `<@${id}>`).join(', ')}`,
      `**Members**: ${fmt(guild.memberCount)}`,
      `**Roles**: ${fmt(roles)}`,
      '',
      `**Category Channels**: ${fmt(categories)}`,
      `**Text Channels**: ${fmt(text)}`,
      `**Voice Channels**: ${fmt(voice)}`,
      '',
      `**Boost Count**: ${fmt(boosts)} ${boosts === 1 ? 'Boost' : 'Boosts'} (Tier ${guild.premiumTier})`,
      '',
      `-# ID: ${guild.id}`,
      `-# Server Created: <t:${created}:f> (<t:${created}:R>)`,
    ].join('\n');

    const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription(description);

    // The server icon goes in the top right corner (skipped if there isn't one).
    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);

    return interaction.reply({ embeds: [embed] });
  },
};
