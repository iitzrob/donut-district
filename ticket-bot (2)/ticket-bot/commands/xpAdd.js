const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const levels = require('../utils/levels');
const { syncRoleRewards } = require('../handlers/levelHandlers');

const fmt = (n) => n.toLocaleString('en-US');

// /xp-add <user> <amount> <type> — gives someone XP or whole levels (admins only).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp-add')
    .setDescription('Add XP or levels to a user (admins only)')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Who to give XP/levels to').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('amount').setDescription('How much to add').setRequired(true).setMinValue(1)
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Is the amount XP or levels?')
        .setRequired(true)
        .addChoices({ name: 'XP', value: 'xp' }, { name: 'Level(s)', value: 'levels' })
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You do not have permission to use this.', ephemeral: true });
    }

    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const type = interaction.options.getString('type');

    if (user.bot) {
      return interaction.reply({ content: 'Bots can’t have XP.', ephemeral: true });
    }

    await interaction.deferReply();

    const result = type === 'levels' ? levels.addLevels(user.id, amount) : levels.addXp(user.id, amount);
    const label = type === 'levels' ? `${fmt(amount)} level${amount === 1 ? '' : 's'}` : `${fmt(amount)} XP`;

    let note = '';
    try {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) await syncRoleRewards(member, result.afterLevel);
      else note = '\n-# They aren’t in the server, so no roles were changed.';
    } catch (err) {
      console.error(`[levels] Couldn't update reward roles for ${user.tag}:`, err.message);
      note = '\n-# XP was added, but I couldn’t update their reward roles (check my permissions / role position).';
    }

    return interaction.editReply({
      content:
        `Added **${label}** to <@${user.id}>\n` +
        `Level **${result.beforeLevel}** → **${result.afterLevel}** · ${fmt(result.afterXp)} total XP${note}`,
      allowedMentions: { parse: [] },
    });
  },
};
