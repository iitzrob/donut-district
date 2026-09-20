const createStore = require('../utils/jsonStore');
const config = require('../config');

// Sticky roles: when someone leaves the server, their roles are saved to
// data/stickyRoles.json. If they join back, the bot gives those roles back.
// Settings are in config.js under `stickyRoles`.
const cfg = { enabled: true, ignoreRoleIds: [], ...(config.stickyRoles || {}) };

// Shape: { "<userId>": { roles: ["<roleId>", ...], leftAt: 1700000000000 } }
const store = createStore('stickyRoles.json', {});

// Roles worth remembering. @everyone is skipped, and so are "managed" roles
// (the ones Discord controls itself: bot roles, Server Booster, integrations),
// since a bot can't hand those out anyway.
function rememberableRoles(member) {
  return member.roles.cache
    .filter((role) => role.id !== member.guild.id && !role.managed && !cfg.ignoreRoleIds.includes(role.id))
    .map((role) => role.id);
}

// Someone left (or was kicked/banned): save what they had.
function handleMemberRemove(member) {
  if (!cfg.enabled || member.guild.id !== config.guildId) return;
  // A "partial" member is one Discord didn't send full details for, so their
  // roles are unknown. cacheAllMembers() below makes this rare.
  if (member.partial || member.user.bot) return;

  const roles = rememberableRoles(member);
  if (roles.length) store.set(member.id, { roles, leftAt: Date.now() });
  else store.delete(member.id);
}

// Someone joined: give back whatever they had when they left.
async function handleMemberAdd(member) {
  if (!cfg.enabled || member.guild.id !== config.guildId || member.user.bot) return;

  const saved = store.get(member.id);
  if (!saved || !saved.roles || !saved.roles.length) return;

  // Only hand back roles that still exist and that the bot is allowed to give
  // (roles above the bot's own role can't be assigned).
  const restorable = saved.roles
    .map((id) => member.guild.roles.cache.get(id))
    .filter((role) => role && !role.managed && !cfg.ignoreRoleIds.includes(role.id) && role.editable);
  const skipped = saved.roles.length - restorable.length;

  if (restorable.length) {
    // If this throws (e.g. missing permission) the saved roles are kept, so
    // it can be retried the next time they join.
    await member.roles.add(restorable.map((role) => role.id), 'Sticky roles: restoring the roles they had before leaving');
  }
  store.delete(member.id);

  console.log(
    `[sticky roles] ${member.user.tag} rejoined — restored ${restorable.length} role(s)` +
      (skipped ? `, skipped ${skipped} (deleted, ignored, or above the bot's role)` : '') +
      '.'
  );
}

// Discord only tells the bot about members it already knows, so without this
// a member who left before the bot ever "saw" them would have no roles to save.
// Loading everyone once at startup fixes that.
async function cacheAllMembers(client) {
  if (!cfg.enabled) return;
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;

  const members = await guild.members.fetch().catch((err) => {
    console.warn('[sticky roles] Could not load the member list:', err.message);
    return null;
  });
  if (members) console.log(`[sticky roles] Loaded ${members.size} members, roles will be saved when they leave.`);
}

module.exports = { handleMemberRemove, handleMemberAdd, cacheAllMembers };
