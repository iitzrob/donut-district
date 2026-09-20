// Only the token / client id / guild id come from Railway (Variables tab).
// Everything else is set directly below — edit the values in this file.
try {
  require('dotenv').config();
} catch {
  // dotenv not installed - fine on Railway, where variables are injected directly.
}

module.exports = {
  // ---- These three come from Railway's Variables tab ----
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // ---- Everything below: edit these values directly ----

  // The text shown in the embed when /ticket-panel is run. Edit this
  // directly to change the wording — it's sent exactly as written below.
  // The buttons themselves (labels + emoji) still come from
  // data/ticketCategories.js, this is just the description text above them.
  ticketPanelDescription:
`<:Emojis_48x48_119:1551135078850101258> **Support**

> Open this if you want help or assistance with anything.

<:Emojis_48x48_69:1551134697818689626> **Staff Report**

> Open this if a staff / builder did something wrong.

 <:Emojis_48x48_56:1551134787018690641> **Buy/Sell Spawner**

> Open this if you want to buy/sell spawners.

<:Emojis_48x48_84:1551134551135359006> **Giveaway Claim**

> Open this to claim a giveaway you won.

<:Emojis_48x48_115:1551135209976762379> **Giveaway Sponsor**

> Open this if you want to sponsor a giveaway.`,

  staffRoleId: '1551080886689075230',

  // Role that always keeps SendMessages in a support ticket, even after
  // it's claimed and every other role gets locked out. This role is also
  // granted access to every new ticket when it's created.
  alwaysCanTypeRoleId: '1551079473049374744',

  // Channel where a copy of every ticket's transcript gets posted when it's
  // closed (in addition to DMing it to whoever opened the ticket).
  ticketLogChannelId: '1551123713292767252',

  // Per-ticket-type settings. Keys must match the `id` values in
  // data/ticketCategories.js. Each one can go to its own category channel
  // and ping its own role. Leave pingRoleId as '' to only ping staffRoleId.
  ticketCategories: {
    support: {
      categoryId: '1551135988309561434',
      pingRoleId: '1551080886689075230',
    },
    staff_report: {
      categoryId: '1551136069196718131',
      pingRoleId: '1551080886689075230',
    },
    buy_sell_spawner: {
      categoryId: '1551136194887426088',
      pingRoleId: '1551080886689075230',
    },
    giveaway_claim: {
      categoryId: '1551136268794990673',
      pingRoleId: '1551080886689075230',
    },
    giveaway_sponsor: {
      categoryId: '1551136370645278791',
      pingRoleId: '1551080886689075230',
    },

    // ---- Services panel (/service-panel) ----
    // Keys match the `id` values in data/serviceCategories.js.
    // - emoji: shown on the button AND next to the name in the panel embed.
    //   Normal emojis always show; custom server emojis only show in the
    //   embed text if the bot is in the server that owns them.
    // - categoryId: paste the Discord category for each service here. While
    //   it's '' the ticket channels are created with no category.
    // - pingRoleId: every service ticket pings this one role.
    build: {
      emoji: '🏗️',
      categoryId: '1551156453174411385',
      pingRoleId: '1551156628588601376',
    },
    dig: {
      emoji: '⛏️',
      categoryId: '1551156867609399307',
      pingRoleId: '1551156628588601376',
    },
    mapart: {
      emoji: '🗺️',
      categoryId: '1551157306614611988',
      pingRoleId: '1551156628588601376',
    },
    regears: {
      emoji: '🛡️',
      categoryId: '1551157453431771216',
      pingRoleId: '1551156628588601376',
    },
  },

  // Title of the embed posted by /service-panel.
  servicePanelTitle: "Donut District's DonutSMP Services",

  // Per-application-type settings. Keys must match the keys in
  // data/applicationQuestions.js (staff_helper, builder).
  // - reviewChannelId: an EXISTING channel (NOT a category) where finished
  //   applications get posted with Accept/Decline buttons. Make this
  //   staff-only — applicants never see it, they answer questions over DM
  //   with the bot instead.
  // - pingRoleId: role pinged in reviewChannelId when a submission lands,
  //   and also the role pinged in the ticket created by the "Open a Ticket"
  //   button on an application
  // - acceptedRoleId: role given to the applicant when Accepted (leave '' to skip)
  // - ticketCategoryId: category the "Open a Ticket" button creates its
  //   channel under (staff can open this from the application review message
  //   to pull the applicant into a channel before deciding)
  applicationCategories: {
    staff_helper: {
      reviewChannelId: '1551137479820836905',
      pingRoleId: '1551079473049374744',
      acceptedRoleId: '1551080887305642014',
      ticketCategoryId: '1551137757571584193',
    },
    builder: {
      reviewChannelId: '1551137479820836905',
      pingRoleId: '1551079638665535548',
      acceptedRoleId: '1551080887842770956',
      ticketCategoryId: '1551137842363895818',
    },
  },

  // Timezone for the weekly points reset (Monday 1:00 AM).
  timezone: 'Europe/Berlin',
};
