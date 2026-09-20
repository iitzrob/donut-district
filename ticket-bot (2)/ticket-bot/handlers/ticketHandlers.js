const {
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');
const ticketStore = require('../utils/ticketStore');
// Both panels open tickets through this same handler, so look up the pressed
// button's category in both lists.
const categories = [
  ...require('../data/ticketCategories'),
  ...require('../data/serviceCategories'),
];
const { createPrivateChannel } = require('../utils/ticketCreation');
const { unclaimedRow } = require('../utils/ticketActions');

const MODAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to fill out the form

// Shows the intake form for categories that have `questions` and waits for
// the user to submit it. Returns { modalInteraction, answers } on success,
// or null if they closed the form / it timed out (nothing left to do then).
async function collectAnswers(interaction, categoryDef) {
  // A question is either a plain string, or an object:
  //   { label: 'What is your budget?', placeholder: "Don't low ball!!", short: true }
  // `placeholder` is the grey hint text inside the box; `short: true` makes it
  // a one-line box instead of a big paragraph box.
  const questions = (categoryDef.questions || []).map((q) =>
    typeof q === 'string' ? { label: q } : q
  );
  if (!questions.length) {
    return { modalInteraction: interaction, answers: [] };
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${categoryDef.id}`)
    .setTitle(categoryDef.label.slice(0, 45));

  questions.forEach((question, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setLabel(question.label.slice(0, 45))
      .setStyle(question.short ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);
    if (question.placeholder) input.setPlaceholder(question.placeholder.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });

  await interaction.showModal(modal);

  const modalInteraction = await interaction
    .awaitModalSubmit({
      filter: (i) => i.customId === `ticket_modal_${categoryDef.id}` && i.user.id === interaction.user.id,
      time: MODAL_TIMEOUT_MS,
    })
    .catch(() => null);

  if (!modalInteraction) return null;

  const answers = questions.map((question, i) => ({
    question: question.label,
    answer: modalInteraction.fields.getTextInputValue(`q${i}`),
  }));

  return { modalInteraction, answers };
}

async function handleTicketOpen(interaction) {
  const categoryId = interaction.customId.replace('ticket_open_', '');
  const categoryDef = categories.find((c) => c.id === categoryId);
  if (!categoryDef) {
    return interaction.reply({ content: 'Unknown ticket category.', ephemeral: true });
  }

  const existing = ticketStore.findOpenByUser(interaction.user.id, categoryId);
  if (existing) {
    return interaction.reply({
      content: `You already have an open ticket for this: <#${existing[0]}>`,
      ephemeral: true,
    });
  }

  const collected = await collectAnswers(interaction, categoryDef);
  if (!collected) return; // form closed / timed out — nothing more to do
  const { modalInteraction, answers } = collected;

  await modalInteraction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const catCfg = config.ticketCategories[categoryId] || {};
  const pingRoleId = catCfg.pingRoleId || config.staffRoleId;

  let channel, rolesWithAccess;
  try {
    ({ channel, rolesWithAccess } = await createPrivateChannel({
      guild,
      name: `${categoryDef.id.replace(/_/g, '-')}-${interaction.user.username}`,
      parentId: catCfg.categoryId,
      openerId: interaction.user.id,
      roleIds: [config.staffRoleId, pingRoleId, config.alwaysCanTypeRoleId],
    }));
  } catch (err) {
    console.error(
      `Failed to create ticket channel for "${categoryId}" (config.ticketCategories.${categoryId}.categoryId = "${catCfg.categoryId}"):`,
      err
    );
    return modalInteraction.editReply({
      content: `Something went wrong creating your ticket channel. Please tell staff.\n\`\`\`${err.message}\`\`\``,
    });
  }

  ticketStore.add(channel.id, {
    type: 'ticket',
    category: categoryId,
    openerId: interaction.user.id,
    openedAt: Date.now(),
    // Role ids that were granted SendMessages when this ticket was created —
    // claim/unclaim toggles SendMessages on exactly these roles.
    rolesWithAccess,
    claimedBy: null,
  });

  const answersBlock = answers.length
    ? '\n\n' + answers.map((a) => `**${a.question}**\n${a.answer}`).join('\n\n')
    : '';
  const notesBlock = categoryDef.notes ? `\n\n⚠️ ${categoryDef.notes}` : '';

  const embed = new EmbedBuilder()
    .setTitle(categoryDef.label)
    .setDescription(
      `${categoryDef.emoji} ${interaction.user}, thanks for opening a ticket.\n\n${categoryDef.description}${notesBlock}${answersBlock}\n\nStaff will be with you shortly.`
    )
    .setColor(0x2b2d31);

  const pings = [`${interaction.user}`];
  if (pingRoleId) pings.push(`<@&${pingRoleId}>`);

  try {
    await channel.send({
      content: pings.join(' '),
      embeds: [embed],
      components: [unclaimedRow()],
    });
  } catch (err) {
    console.error('Failed to send ticket embed:', err);
    ticketStore.remove(channel.id);
    await channel.delete().catch(() => {});
    return modalInteraction.editReply({
      content: `Something went wrong setting up your ticket. Please tell staff.\n\`\`\`${err.message}\`\`\``,
    });
  }

  await modalInteraction.editReply({ content: `Your ticket has been created: ${channel}` });
}

module.exports = { handleTicketOpen };
