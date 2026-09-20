// The ticket categories for the services panel (/service-panel). Same shape as
// data/ticketCategories.js, but kept separate so they only show up on that
// panel and not on the main /ticket-panel.
//
// Emojis, category ids and the ping role live in config.js under
// `ticketCategories` (build / dig / mapart / regears).
//
// A question is either a plain string, or:
//   { label, placeholder, short }
// - placeholder: grey hint text inside the box
// - short: true = one-line box (good for IGN / budget), otherwise a big box
// Labels are cut off at 45 characters by Discord, so keep them short.
const config = require('../config');

const emojiOf = (id) => config.ticketCategories[id].emoji;

module.exports = [
  {
    id: 'build',
    emoji: emojiOf('build'),
    label: 'Build',
    description: 'We build bases, farms, stashes, shulker loaders and more.',
    questions: [
      {
        label: 'What build are you looking for?',
        placeholder: 'Farm, Base, Stash, Other',
      },
      {
        label: 'What is your budget?',
        placeholder: "Don't low ball!!",
        short: true,
      },
      { label: 'Do you have a schematic?', short: true },
    ],
  },
  {
    id: 'dig',
    emoji: emojiOf('dig'),
    label: 'Dig',
    description: 'We clear and dig areas quickly and efficiently for your projects.',
    questions: [
      { label: 'What are the dimensions you want us to dig?' },
      { label: "What's your IGN?", short: true },
      { label: 'What is your budget?', short: true },
    ],
  },
  {
    id: 'mapart',
    emoji: emojiOf('mapart'),
    label: 'Mapart',
    description: 'We create custom mapart and pixel art with clean, high-quality designs.',
    questions: [
      { label: 'What custom map art do you want?' },
      { label: 'What is your budget?', short: true },
      { label: "What's your IGN?", short: true },
    ],
  },
  {
    id: 'regears',
    emoji: emojiOf('regears'),
    label: 'Regears',
    description: 'We prepare organized regear kits with tools, totems, and supplies.',
    questions: [
      { label: 'What type of regear are you looking for?' },
      { label: 'What is your budget?', short: true },
      { label: "What's your IGN?", short: true },
    ],
  },
];
