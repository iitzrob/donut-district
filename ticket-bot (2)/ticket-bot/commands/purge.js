const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// /purge <amount> — bulk deletes the last 1-100 messages in the current channel.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete a number of recent messages in this channel (max 100, admins only)')
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('How many messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You do not have permission to use this.', ephemeral: true });
    }

    const channel = interaction.channel;
    if (!channel || typeof channel.bulkDelete !== 'function') {
      return interaction.reply({ content: 'I can’t purge messages in this kind of channel.', ephemeral: true });
    }

    const botPerms = channel.permissionsFor(interaction.guild.members.me);
    if (!botPerms?.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
      return interaction.reply({
        content: 'I need **Manage Messages** and **Read Message History** in this channel to do that.',
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger('amount');
    await interaction.deferReply({ ephemeral: true });

    try {
      // `true` skips messages older than 14 days (Discord can't bulk delete those).
      const deleted = await channel.bulkDelete(amount, true);
      const skipped = amount - deleted.size;

      let content = `Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}.`;
      if (skipped > 0) {
        content += `\n-# ${skipped} couldn’t be deleted (messages older than 14 days can’t be bulk deleted).`;
      }
      return interaction.editReply({ content });
    } catch (err) {
      console.error('[purge] Failed to purge messages:', err.message);
      return interaction.editReply({ content: 'Something went wrong while deleting messages.' });
    }
  },
};
