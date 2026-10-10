const {
  SlashCommandBuilder,
  ButtonStyle,
  ChannelType,
  TextInputStyle,
  MessageFlags,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder
} = require('discord.js');
const db = require('../../db/database');
const { isGuildAdmin, hasStaffLevel } = require('../../utils/permissions');
const { websiteUrl, dashboardUrl, publicApiUrl, websiteMessage, dashboardMessage, rotationMs } = require('../../utils/branding');
const {
  text,
  separator,
  row,
  button,
  select,
  roleSelect,
  channelSelect,
  v2Payload,
  modalWithText
} = require('../../utils/components');

async function editSettings(interaction, payload) {
  const editPayload = { ...payload };
  delete editPayload.flags;

  // Update the existing component message directly whenever possible.
  // If Discord has already acknowledged the interaction, fall back to editReply.
  try {
    if (!interaction.deferred && !interaction.replied) {
      return await interaction.update(editPayload);
    }
    return await interaction.editReply(editPayload);
  } catch (error) {
    // A deferred component interaction cannot be updated twice; edit the reply instead.
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(editPayload);
    }
    throw error;
  }
}

function chunkRows(components, size = 5) {
  const rows = [];
  for (let n = 0; n < components.length; n += size) {
    rows.push({ type: 'row', value: row(components.slice(n, n + size)) });
  }
  return rows;
}

function channelPicker(i, customId, title, placeholder, notice = '') {
  return v2Payload([
    { type: 'text', value: `## ${title}${notice ? `\n\n${notice}` : ''}\n\nSelect a channel below.` },
    { type: 'row', value: row([channelSelect(customId, placeholder, [ChannelType.GuildText, ChannelType.GuildAnnouncement])]) },
    { type: 'row', value: row([button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

function rolePicker(customId, title, description) {
  return v2Payload([
    { type: 'text', value: `## ${title}\n\n${description}` },
    { type: 'row', value: row([roleSelect(customId)]) },
    { type: 'row', value: row([button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

const DEFAULT_STAFF = [
  { key: 'manager', name: 'Manager', level: 80, roleId: null },
  { key: 'administrator', name: 'Administrator', level: 60, roleId: null },
  { key: 'moderator', name: 'Moderator', level: 30, roleId: null },
  { key: 'support', name: 'Support', level: 10, roleId: null }
];

const DEFAULT_TICKETS = {
  enabled: false,
  mode: 'panel',
  categoryId: null,
  staffRoleId: null,
  logChannelId: null,
  panelChannelId: null,
  questions: [],
  anonymousModmail: false,
  maxOpenPerUser: 1
};

const DEFAULT_APPLICATIONS = {
  enabled: true,
  managerRoleId: null,
  reviewChannelId: null,
  questions: []
};

const DEFAULT_SUGGESTIONS = {
  enabled: true,
  channelId: null,
  reviewLevel: 30
};

const DEFAULT_REACTION_ROLES = {
  enabled: true,
  title: 'Choose your roles',
  description: 'Select the roles that apply to you. Click a role again to remove it.',
  channelId: null,
  messageId: null,
  roles: []
};

const DEFAULT_MESSAGES = {
  welcome: { enabled: false, channelId: null, content: 'Welcome to {server}, {user}!' },
  leave: { enabled: false, channelId: null, content: '{user} has left the server.' },
  moderationLogChannelId: null,
  commandLogChannelId: null,
  joinLogChannelId: null,
  killLogChannelId: null,
  shiftLogChannelId: null,
  ticketLogChannelId: null,
  applicationLogChannelId: null,
  suggestionLogChannelId: null,
  giveawayLogChannelId: null,
  modCallChannelId: null
};

const DEFAULT_AUTOMOD = {
  enabled: true,
  deleteMessages: true,
  logActions: true,
  logChannelId: null,
  bypassAdmins: true,
  modules: { words: true, spam: true, duplicate: true, mentions: true, links: true, invites: true, caps: true, emojis: true },
  thresholds: { spamMessages: 6, spamWindowMs: 8000, duplicate: 3, mentions: 8, capsRatio: 0.75, capsMinimum: 12, emojis: 15 },
  escalation: { enabled: true, threshold: 3, action: 'timeout', duration: 300 }
};

const DEFAULT_PROMOTIONS = {
  enabled: true,
  logChannelId: null,
  replaceStaffRoles: true
};

const STAFF_CORE_KEYS = new Set(['manager', 'administrator', 'moderator', 'support']);
const MAX_STAFF_RANKS = 20;

const SETTINGS_SCHEMA_VERSION = 4;

const SETTINGS_MENU = [
  ['quick', '✨', 'Recommended Setup', 'Apply sensible default settings for this server'],
  ['staff', '🧭', 'Staff Hierarchy', 'Configure staff ranks and add additional roles'],
  ['promotions', '📈', 'Promotions', 'Promote and demote members through the configured staff hierarchy'],
  ['general', '⚙️', 'General', 'Configure core Oxy server behaviour'],
  ['messages', '💬', 'Messages & Logs', 'Configure welcome, leave and logging channels'],
  ['tickets', '🎫', 'Tickets', 'Configure the ticket system and ticket questions'],
  ['applications', '📋', 'Applications', 'Configure applications and review settings'],
  ['suggestions', '💡', 'Suggestions', 'Configure suggestions and review settings'],
  ['automod', '🤖', 'AutoMod', 'Configure automatic moderation behaviour'],
  ['moderation', '🛡️', 'Moderation', 'Configure moderation logging and controls'],
  ['music', '🎵', 'Music', 'Configure music playback settings'],
  ['oxford', '🚓', 'Oxford Response', 'Configure Oxford Response integration and server key'],
  ['shifts', '🕐', 'Shifts', 'Configure shift tracking and movement checks'],
  ['roblox', '🎮', 'Roblox', 'Configure Roblox linking and verification'],
  ['api', '🌐', 'API & Dashboard', 'View Oxy API and dashboard configuration'],
  ['config', '🔐', 'Security & Keys', 'Manage administrator access and server API keys'],
  ['reactionroles', '🎭', 'Reaction Roles', 'Configure reaction role panels and role assignments']
];

function freshSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    staffHierarchy: DEFAULT_STAFF.map(x => ({ ...x })),
    tickets: JSON.parse(JSON.stringify(DEFAULT_TICKETS)),
    applications: JSON.parse(JSON.stringify(DEFAULT_APPLICATIONS)),
    suggestions: JSON.parse(JSON.stringify(DEFAULT_SUGGESTIONS)),
    reactionRoles: JSON.parse(JSON.stringify(DEFAULT_REACTION_ROLES)),
    messages: JSON.parse(JSON.stringify(DEFAULT_MESSAGES)),
    automod: JSON.parse(JSON.stringify(DEFAULT_AUTOMOD)),
    promotions: JSON.parse(JSON.stringify(DEFAULT_PROMOTIONS)),
    moderation: { logging: true, logChannelId: null, roles: {} },
    music: { enabled: process.env.MUSIC_ENABLED !== 'false' },
    oxford: { enabled: true },
    shifts: { enabled: true },
    roblox: { enabled: true },
    website: { enabled: true },
    auditLogChannelId: null
  };
}

function get(guildId) {
  const cfg = db.getGuildConfig(guildId);
  let settings = {};
  try { settings = JSON.parse(cfg.settings_json || '{}'); } catch {}

  // Settings v2 deliberately starts from a clean configuration. Existing
  // settings are not migrated into the new menu; secrets/API keys remain in
  // their dedicated database columns.
  if (settings.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return freshSettings();
  }

  const defaults = freshSettings();
  settings = {
    ...defaults,
    ...settings,
    staffHierarchy: Array.isArray(settings.staffHierarchy) && settings.staffHierarchy.length
      ? settings.staffHierarchy
      : defaults.staffHierarchy,
    tickets: { ...defaults.tickets, ...(settings.tickets || {}) },
    applications: { ...defaults.applications, ...(settings.applications || {}) },
    suggestions: { ...defaults.suggestions, ...(settings.suggestions || {}) },
    reactionRoles: { ...defaults.reactionRoles, ...(settings.reactionRoles || {}) },
    messages: { ...defaults.messages, ...(settings.messages || {}) },
    automod: { ...defaults.automod, ...(settings.automod || {}), modules: { ...defaults.automod.modules, ...((settings.automod || {}).modules || {}) }, thresholds: { ...defaults.automod.thresholds, ...((settings.automod || {}).thresholds || {}) }, escalation: { ...defaults.automod.escalation, ...((settings.automod || {}).escalation || {}) } },
    promotions: { ...defaults.promotions, ...(settings.promotions || {}) },
    moderation: { ...defaults.moderation, ...(settings.moderation || {}) },
    music: { ...defaults.music, ...(settings.music || {}) },
    oxford: { ...defaults.oxford, ...(settings.oxford || {}) },
    shifts: { ...defaults.shifts, ...(settings.shifts || {}) },
    roblox: { ...defaults.roblox, ...(settings.roblox || {}) },
    website: { ...defaults.website, ...(settings.website || {}) },
    auditLogChannelId: settings.auditLogChannelId || null
  };

  settings.staffHierarchy = Array.isArray(settings.staffHierarchy) ? settings.staffHierarchy.filter(x => x && x.key && x.name).slice(0, MAX_STAFF_RANKS) : defaults.staffHierarchy;
  settings.tickets.questions = Array.isArray(settings.tickets.questions) ? settings.tickets.questions : [];
  settings.applications.questions = Array.isArray(settings.applications.questions) ? settings.applications.questions : [];
  settings.reactionRoles.roles = Array.isArray(settings.reactionRoles.roles) ? settings.reactionRoles.roles.slice(0, 25) : [];

  return settings;
}

function resetSettings(guildId) {
  const settings = freshSettings();
  db.setGuildConfig(guildId, { settings_json: JSON.stringify(settings), admin_role_id: null });
  return settings;
}
function save(guildId, settings) {
  const administratorRoleId = settings.staffHierarchy?.find(x => x.key === 'administrator')?.roleId || null;
  db.setGuildConfig(guildId, {
    settings_json: JSON.stringify(settings),
    ...(administratorRoleId ? { admin_role_id: administratorRoleId } : {})
  });
  return settings;
}

function roleByNames(guild, names) {
  const wanted = names.map(String).map(x => x.toLowerCase());
  const candidates = [...guild.roles.cache.values()].filter(role => {
    const name = role.name.toLowerCase();
    return !role.managed && role.id !== guild.id &&
      !name.includes('bot') &&
      !name.includes('oxy controller') &&
      !name.includes('oxcontroller');
  });

  const exact = candidates.find(role => wanted.includes(role.name.toLowerCase()));
  if (exact) return exact;
  return candidates.find(role => wanted.some(name => role.name.toLowerCase().includes(name))) || null;
}

function featureButton(key, label, style = ButtonStyle.Secondary) {
  return button(`settings:feature:${key}`, label, style);
}

function settingsRundown(i) {
  const s = get(i.guild.id);
  const staff = s.staffHierarchy
    .map(x => `${x.name}: ${x.roleId ? `<@&${x.roleId}>` : 'Not set'}`)
    .join(' • ');

  const logChannels = [
    s.messages.moderationLogChannelId,
    s.messages.commandLogChannelId,
    s.messages.joinLogChannelId,
    s.messages.killLogChannelId,
    s.messages.shiftLogChannelId,
    s.messages.ticketLogChannelId,
    s.messages.applicationLogChannelId,
    s.messages.suggestionLogChannelId,
    s.messages.giveawayLogChannelId,
    s.messages.modCallChannelId
  ].filter(Boolean).length;

  return [
    '### Current Configuration',
    `**🧭 Staff:** ${staff} • ${s.staffHierarchy.length} ranks configured`,
    `**🎫 Tickets:** ${s.tickets.enabled ? 'Enabled' : 'Disabled'} • ${s.tickets.questions.length}/5 questions`,
    `**📋 Applications:** ${s.applications.enabled ? 'Enabled' : 'Disabled'} • ${s.applications.questions.length}/5 questions`,
    `**💡 Suggestions:** ${s.suggestions.enabled ? 'Enabled' : 'Disabled'}`,
    `**🤖 AutoMod:** ${s.automod.enabled ? 'Enabled' : 'Disabled'} • ${s.automod.logChannelId ? `<#${s.automod.logChannelId}>` : 'No dedicated log channel'} • ${Object.values(s.automod.modules).filter(Boolean).length}/8 modules`,
    `**📈 Promotions:** ${s.promotions.enabled ? 'Enabled' : 'Disabled'} • ${s.promotions.logChannelId ? `<#${s.promotions.logChannelId}>` : 'No dedicated log channel'}`,
    `**🛡️ Moderation:** ${s.moderation.logging !== false ? 'Logging enabled' : 'Logging disabled'}`,
    `**🎵 Music:** ${s.music.enabled ? 'Enabled' : 'Disabled'}`,
    `**🚓 Oxford Response:** ${s.oxford.enabled ? 'Enabled' : 'Disabled'} • ${db.getOxfordKey(i.guild.id) ? 'Server key configured' : 'Server key not configured'}`,
    `**🕐 Shifts:** ${s.shifts.enabled ? 'Enabled' : 'Disabled'}`,
    `**🎮 Roblox:** ${s.roblox.enabled ? 'Enabled' : 'Disabled'}`,
    `**🎭 Reaction Roles:** ${s.reactionRoles.enabled ? 'Enabled' : 'Disabled'} • ${s.reactionRoles.roles.length}/25 roles`,
    `**💬 Logs:** ${logChannels} channel${logChannels === 1 ? '' : 's'} configured • **Bot Actions:** ${s.auditLogChannelId ? `<#${s.auditLogChannelId}>` : 'Command/Moderation log fallback'}`,
    `**🌐 API:** ${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || 4000} • Server API key ${db.getGuildConfig(i.guild.id).api_key_hash ? 'active' : 'not configured'}`
  ].join('\n');
}

function settingsMenu() {
  return select(
    'settings:menu',
    'Choose a settings category...',
    SETTINGS_MENU.map(([value, emoji, label, description]) => ({ value, emoji, label, description }))
  );
}

function panel(i, notice = '') {
  return v2Payload([
    { type: 'text', value: `## ⚙️ Oxy Server Settings\n\n${notice ? `${notice}\n\n` : ''}Configure Oxy for this server. Select a category below.` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([settingsMenu()]) },
    { type: 'separator', value: separator() },
    { type: 'text', value: settingsRundown(i) },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([button('settings:close', 'Close', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}
function staffPanel(i) {
  const s = get(i.guild.id);
  const sorted = [...s.staffHierarchy].sort((a, b) => Number(b.level || 0) - Number(a.level || 0));
  const summary = sorted.map(x => {
    const core = STAFF_CORE_KEYS.has(x.key) ? ' • Core' : ' • Custom';
    return `**${x.name}** • Level ${x.level}${core}\n${x.roleId ? `<@&${x.roleId}>` : 'Not configured'}`;
  }).join('\n\n');
  const editOptions = sorted.slice(0, 25).map(x => ({ value: x.key, label: x.name.slice(0, 100), description: `Level ${x.level}${STAFF_CORE_KEYS.has(x.key) ? ' • Core rank' : ' • Custom rank'}` }));
  const removeOptions = sorted.filter(x => !STAFF_CORE_KEYS.has(x.key)).slice(0, 25).map(x => ({ value: x.key, label: x.name.slice(0, 100), description: `Remove custom rank • Level ${x.level}` }));
  return v2Payload([
    { type: 'text', value: `## 🧭 Staff Hierarchy\n\nHigher levels inherit lower-level access. Server owners and Discord Administrators retain full access.\n\n${summary || 'No staff ranks configured.'}` },
    { type: 'separator', value: separator() },
    { type: 'text', value: `**${s.staffHierarchy.length}/${MAX_STAFF_RANKS} staff ranks configured**\nAdd custom ranks for any Discord roles. Each rank has a numeric level used by permissions and the promotion system.` },
    { type: 'row', value: row([button('settings:staff:add', 'Add Staff Role', ButtonStyle.Success), button('settings:staff:edit', 'Edit Rank', ButtonStyle.Primary), button('settings:staff:remove', 'Remove Custom Role', ButtonStyle.Danger, removeOptions.length === 0), button('settings:staff:promotions', 'Promotion System', ButtonStyle.Secondary)]) },
    ...(editOptions.length ? [{ type: 'row', value: row([select('settings:staff:editselect', 'Select a staff rank to edit...', editOptions)]) }] : []),
    ...(removeOptions.length ? [{ type: 'row', value: row([select('settings:staff:removeselect', 'Select a custom staff rank to remove...', removeOptions)]) }] : []),
    { type: 'row', value: row([button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

function addStaffRolePicker(i) {
  return rolePicker('settings:staff:addrole', 'Add Staff Role', `Select a Discord role to add to the Oxy staff hierarchy. You can then choose its name and level.\n\nMaximum: **${MAX_STAFF_RANKS}** ranks.`);
}

function staffRankModal(key, currentName, currentLevel, title = 'Edit Staff Rank') {
  const modal = new ModalBuilder().setCustomId(`settings:staff:editmodal:${key}`).setTitle(title);
  const nameField = new LabelBuilder().setLabel('Rank name').setDescription('The name shown by Oxy.').setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50).setValue(currentName));
  const levelField = new LabelBuilder().setLabel('Rank level').setDescription('Higher numbers have more authority. Use 1–99.').setTextInputComponent(new TextInputBuilder().setCustomId('level').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setValue(String(currentLevel)));
  modal.addLabelComponents(nameField, levelField);
  return modal;
}

function promotionsPanel(i, notice = '') {
  const s = get(i.guild.id);
  const p = s.promotions;
  return v2Payload([
    { type: 'text', value: `## 📈 Promotion System${notice ? `\n\n${notice}` : ''}\n\n**Status:** ${p.enabled ? 'Enabled' : 'Disabled'}\n**Log channel:** ${p.logChannelId ? `<#${p.logChannelId}>` : 'Uses the server moderation log when available'}\n**Replace staff roles:** ${p.replaceStaffRoles ? 'Yes' : 'No'}\n\n**Commands**\n/promote — move a member up through the configured hierarchy\n/demote — move a member down through the configured hierarchy\n\nOnly ranks below the person making the promotion/demotion can be assigned.` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([
      button('settings:promotions:toggle', p.enabled ? 'Disable Promotions' : 'Enable Promotions', p.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:promotions:replace', p.replaceStaffRoles ? 'Keep One Staff Rank' : 'Allow Multiple Staff Ranks', ButtonStyle.Secondary),
      button('settings:promotions:logchannel', 'Set Log Channel', ButtonStyle.Primary)
    ]) },
    { type: 'row', value: row([button('settings:staff:manage', 'Manage Staff Ranks', ButtonStyle.Secondary), button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

function automodPanel(i, notice = '') {
  const s = get(i.guild.id);
  const am = s.automod;
  const labels = {
    words: ['Blocked words', '⚠️'],
    spam: ['Spam', '💨'],
    duplicate: ['Duplicate messages', '🔁'],
    mentions: ['Mention spam', '📣'],
    links: ['Links', '🔗'],
    invites: ['Discord invites', '📨'],
    caps: ['Excessive caps', '🔠'],
    emojis: ['Emoji spam', '😵']
  };
  const options = Object.entries(labels).map(([key, [label, emoji]]) => ({
    value: key,
    label,
    emoji,
    description: am.modules[key] ? 'Currently enabled — select to disable' : 'Currently disabled — select to enable'
  }));
  const moduleSummary = Object.entries(labels).map(([key, [label, emoji]]) => `${am.modules[key] ? '✅' : '❌'} ${emoji} ${label}`).join('\n');
  return v2Payload([
    { type: 'text', value: `## 🤖 Per-Server AutoMod${notice ? `\n\n${notice}` : ''}\n\n**Status:** ${am.enabled ? 'Enabled' : 'Disabled'}\n**Delete messages:** ${am.deleteMessages ? 'Enabled' : 'Disabled'}\n**Logging:** ${am.logActions ? 'Enabled' : 'Disabled'}\n**Log channel:** ${am.logChannelId ? `<#${am.logChannelId}>` : 'Uses the server moderation log as a fallback'}\n**Admin/owner bypass:** ${am.bypassAdmins ? 'Enabled' : 'Disabled'}\n**Escalation:** ${am.escalation.enabled ? `Enabled • ${am.escalation.threshold} violations → ${am.escalation.duration / 60} minute timeout` : 'Disabled'}\n\n### Detection Modules\n${moduleSummary}` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([select('settings:automod:module', 'Toggle an AutoMod module...', options)]) },
    { type: 'separator', value: separator() },
    ...chunkRows([
      button('settings:automod:toggle', am.enabled ? 'Disable AutoMod' : 'Enable AutoMod', am.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:automod:delete', am.deleteMessages ? 'Disable Deletion' : 'Enable Deletion', am.deleteMessages ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:automod:logging', am.logActions ? 'Disable Logging' : 'Enable Logging', am.logActions ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:automod:bypass', am.bypassAdmins ? 'Disable Admin Bypass' : 'Enable Admin Bypass', am.bypassAdmins ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:automod:escalation', am.escalation.enabled ? 'Disable Escalation' : 'Enable Escalation', am.escalation.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:automod:logchannel', 'Set Log Channel', ButtonStyle.Primary),
      button('settings:automod:defaults', 'Reset AutoMod Defaults', ButtonStyle.Secondary)
    ]),
    { type: 'row', value: row([button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

function featurePanel(i, feature, notice = '') {
  const s = get(i.guild.id);

  // Build only the selected page. The previous implementation eagerly evaluated
  // every category template, so one malformed/missing field could break every
  // feature page at once.
  const pages = {
    tickets: () => [
      `## 🎫 Ticket Settings`,
      `**Status:** ${s.tickets?.enabled ? 'Enabled' : 'Disabled'}`,
      `**Mode:** ${s.tickets?.mode || 'panel'}`,
      `**Category:** ${s.tickets?.categoryId ? `<#${s.tickets.categoryId}>` : 'Not set'}`,
      `**Staff role:** ${s.tickets?.staffRoleId ? `<@&${s.tickets.staffRoleId}>` : 'Not set'}`,
      `**Log channel:** ${s.tickets?.logChannelId ? `<#${s.tickets.logChannelId}>` : 'Not set'}`,
      `**Panel channel:** ${s.tickets?.panelChannelId ? `<#${s.tickets.panelChannelId}>` : 'Not set'}`,
      `**Questions:** ${Array.isArray(s.tickets?.questions) ? s.tickets.questions.length : 0}/5`,
      `**Anonymous Modmail:** ${s.tickets?.anonymousModmail ? 'Enabled' : 'Disabled'}`
    ].join('\n\n'),
    applications: () => [
      `## 📋 Application Settings`,
      `**Status:** ${s.applications?.enabled ? 'Enabled' : 'Disabled'}`,
      `**Manager:** ${s.applications?.managerRoleId ? `<@&${s.applications.managerRoleId}>` : 'Uses Staff Hierarchy Manager'}`,
      `**Review channel:** ${s.applications?.reviewChannelId ? `<#${s.applications.reviewChannelId}>` : 'Not set'}`,
      `**Questions:** ${Array.isArray(s.applications?.questions) ? s.applications.questions.length : 0}/5`
    ].join('\n\n'),
    suggestions: () => [
      `## 💡 Suggestion Settings`,
      `**Status:** ${s.suggestions?.enabled ? 'Enabled' : 'Disabled'}`,
      `**Channel:** ${s.suggestions?.channelId ? `<#${s.suggestions.channelId}>` : 'Command channel'}`,
      `**Approve review level:** ${Number.isFinite(Number(s.suggestions?.reviewLevel)) ? s.suggestions.reviewLevel : 30}\n**Rejection access:** Manager or higher`
    ].join('\n\n'),
    moderation: () => [
      `## 🛡️ Moderation Settings`,
      `**Log channel:** ${s.moderation?.logChannelId ? `<#${s.moderation.logChannelId}>` : 'Not set'}`,
      `**Logging:** ${s.moderation?.logging !== false ? 'Enabled' : 'Disabled'}`,
      `**Configured action roles:** ${Object.keys(s.moderation?.roles || {}).length}`
    ].join('\n\n'),
    music: () => [
      `## 🎵 Music Settings`,
      `**Enabled:** ${s.music?.enabled ? 'Yes' : 'No'}`,
      `**DJ role:** ${process.env.MUSIC_DJ_ROLE_ID ? `<@&${process.env.MUSIC_DJ_ROLE_ID}>` : 'Not required'}`,
      `**Leave when empty:** ${process.env.MUSIC_LEAVE_ON_EMPTY !== 'false' ? 'Yes' : 'No'}`,
      `**Default volume:** ${process.env.MUSIC_DEFAULT_VOLUME || 75}%`,
      `**Queue limit:** ${process.env.MUSIC_MAX_QUEUE || 100}`
    ].join('\n\n'),
    oxford: () => [
      `## 🚓 Oxford Response Settings`,
      `**Enabled:** ${s.oxford?.enabled ? 'Yes' : 'No'}`,
      `**API:** ${publicApiUrl() ? `${publicApiUrl().replace(/\/$/, '')}/v1` : 'Not configured'}`,
      `**Server key:** ${db.getOxfordKey(i.guild.id) ? 'Configured' : 'Not configured'}`,
      `\nUse the Oxford panel for server controls and live data.`
    ].join('\n\n'),
    shifts: () => [
      `## 🕐 Shift Settings`,
      `**Enabled:** ${s.shifts?.enabled ? 'Yes' : 'No'}`,
      `**Check interval:** ${Number(process.env.SHIFT_CHECK_INTERVAL_MS || 180000) / 60000} minutes`,
      `**Require movement:** ${process.env.SHIFT_REQUIRE_MOVEMENT !== 'false' ? 'Yes' : 'No'}`,
      `**Minimum movement:** ${process.env.SHIFT_MIN_MOVEMENT || 5}`
    ].join('\n\n'),
    roblox: () => [
      `## 🎮 Roblox Settings`,
      `**Enabled:** ${s.roblox?.enabled ? 'Yes' : 'No'}`,
      `**Verification prefix:** ${process.env.ROBLOX_LINK_PREFIX || 'OXCTRL-'}`,
      `**API timeout:** ${process.env.ROBLOX_API_TIMEOUT_MS || 10000}ms`
    ].join('\n\n'),
    api: () => [
      `## 🌐 API / Dashboard Settings`,
      `**API:** ${publicApiUrl() || 'Not configured'}`,
      `**Dashboard:** ${dashboardUrl() || 'Not configured'}`,
      `**Website message:** ${websiteMessage()}`,
      `**Dashboard message:** ${dashboardMessage()}`
    ].join('\n\n'),
    reactionroles: () => [
      `## 🎭 Reaction Roles`,
      `**Status:** ${s.reactionRoles?.enabled ? 'Enabled' : 'Disabled'}`,
      `**Panel channel:** ${s.reactionRoles?.channelId ? `<#${s.reactionRoles.channelId}>` : 'Not set'}`,
      `**Configured roles:** ${Array.isArray(s.reactionRoles?.roles) ? s.reactionRoles.roles.length : 0}/25`,
      `\nUse \`/reactionroles\` for the full Components V2 role panel builder.`
    ].join('\n\n'),
    messages: () => [
      `## 💬 Message Settings`,
      `**Welcome:** ${s.messages?.welcome?.enabled ? 'Enabled' : 'Disabled'} • ${s.messages?.welcome?.channelId ? `<#${s.messages.welcome.channelId}>` : 'No channel'}`,
      `**Leave:** ${s.messages?.leave?.enabled ? 'Enabled' : 'Disabled'} • ${s.messages?.leave?.channelId ? `<#${s.messages.leave.channelId}>` : 'No channel'}`,
      `**Moderation logs:** ${s.messages?.moderationLogChannelId ? `<#${s.messages.moderationLogChannelId}>` : 'Not set'}`,
      `**Command logs:** ${s.messages?.commandLogChannelId ? `<#${s.messages.commandLogChannelId}>` : 'Not set'}`,
      `**Join logs:** ${s.messages?.joinLogChannelId ? `<#${s.messages.joinLogChannelId}>` : 'Not set'}`,
      `**Kill logs:** ${s.messages?.killLogChannelId ? `<#${s.messages.killLogChannelId}>` : 'Not set'}`,
      `**Shift logs:** ${s.messages?.shiftLogChannelId ? `<#${s.messages.shiftLogChannelId}>` : 'Not set'}`,
      `**Ticket logs:** ${s.messages?.ticketLogChannelId ? `<#${s.messages.ticketLogChannelId}>` : 'Not set'}`,
      `**Application logs:** ${s.messages?.applicationLogChannelId ? `<#${s.messages.applicationLogChannelId}>` : 'Not set'}`,
      `**Suggestion logs:** ${s.messages?.suggestionLogChannelId ? `<#${s.messages.suggestionLogChannelId}>` : 'Not set'}`,
      `**Giveaway logs:** ${s.messages?.giveawayLogChannelId ? `<#${s.messages.giveawayLogChannelId}>` : 'Not set'}`,
      `**Mod calls:** ${s.messages?.modCallChannelId ? `<#${s.messages.modCallChannelId}>` : 'Not set'}`,
      `**Bot action logs:** ${s.auditLogChannelId ? `<#${s.auditLogChannelId}>` : 'Command/Moderation fallback'}`
    ].join('\n\n'),
    config: () => [
      `## 🔐 Oxy Configuration`,
      `**Oxford API:** ${db.getOxfordKey(i.guild.id) ? 'Configured' : 'Not configured'}`,
      `**Admin role:** ${db.getAdminRoleId(i.guild.id) ? `<@&${db.getAdminRoleId(i.guild.id)}>` : 'Not configured'}`,
      `**Server API key:** ${db.getGuildConfig(i.guild.id).api_key_hash ? 'Active' : 'Not configured'}`
    ].join('\n\n'),
    general: () => [
      `## ⚙️ General Settings`,
      `**Website:** ${s.website?.enabled ? 'Enabled' : 'Disabled'} • ${websiteUrl() || 'Not configured'} • ${websiteMessage()}`
    ].join('\n\n'),
    website: () => [
      `## 🌐 Website Integration`,
      `**Status:** ${websiteMessage()}`,
      `**Website:** ${websiteUrl() || 'Not configured'}`,
      `**Dashboard:** ${dashboardUrl() || 'Not configured'}`,
      `**Dashboard status:** ${dashboardMessage()}`,
      `**Rotation:** ${rotationMs('WEBSITE_MESSAGE_ROTATION_MS')}ms`
    ].join('\n\n')
  };

  const renderer = pages[feature];
  const content = renderer ? renderer() : 'Settings unavailable.';
  const controls = {
    messages: [
      button('settings:feature:messages:welcome', s.messages?.welcome?.enabled ? 'Disable Welcome' : 'Enable Welcome', s.messages?.welcome?.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:feature:messages:welcomeChannel', 'Welcome Channel', ButtonStyle.Primary),
      button('settings:feature:messages:leave', s.messages?.leave?.enabled ? 'Disable Leave' : 'Enable Leave', s.messages?.leave?.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      button('settings:feature:messages:leaveChannel', 'Leave Channel', ButtonStyle.Primary),
      button('settings:feature:messages:moderationLog', 'Mod Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:commandLog', 'Command Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:joinLog', 'Join Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:killLog', 'Kill Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:shiftLog', 'Shift Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:ticketLog', 'Ticket Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:applicationLog', 'Application Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:suggestionLog', 'Suggestion Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:giveawayLog', 'Giveaway Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:modCallLog', 'Mod Call Logs', ButtonStyle.Secondary),
      button('settings:feature:messages:auditLog', 'Bot Action Logs', ButtonStyle.Primary)
    ],
    config: [
      button('settings:feature:config:adminRole', 'Admin Role', ButtonStyle.Primary),
      button('settings:feature:config:apiKey', 'Oxford API Key', ButtonStyle.Secondary),
      button('settings:feature:config:clearApiKey', 'Clear Oxford Key', ButtonStyle.Danger),
      button('settings:feature:config:serverApiKey', 'Generate API Key', ButtonStyle.Success),
      button('settings:feature:config:revokeServerApiKey', 'Revoke API Key', ButtonStyle.Danger)
    ],
    tickets: [button('settings:feature:tickets:open', 'Open Ticket Setup', ButtonStyle.Primary), button('settings:feature:tickets:toggle', s.tickets?.enabled ? 'Disable' : 'Enable', s.tickets?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    applications: [button('settings:feature:applications:open', 'Open Application Setup', ButtonStyle.Primary), button('settings:feature:applications:toggle', s.applications?.enabled ? 'Disable' : 'Enable', s.applications?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    suggestions: [button('settings:feature:suggestions:toggle', s.suggestions?.enabled ? 'Disable' : 'Enable', s.suggestions?.enabled ? ButtonStyle.Danger : ButtonStyle.Success), button('settings:feature:suggestions:channel', 'Set Channel', ButtonStyle.Primary)],
    moderation: [button('settings:feature:moderation:log', 'Set Log Channel', ButtonStyle.Primary)],
    reactionroles: [button('settings:feature:reactionroles:open', 'Open Reaction Role Builder', ButtonStyle.Primary), button('settings:feature:reactionroles:toggle', s.reactionRoles?.enabled ? 'Disable' : 'Enable', s.reactionRoles?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    music: [button('settings:feature:music:toggle', s.music?.enabled ? 'Disable' : 'Enable', s.music?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    oxford: [button('settings:feature:oxford:open', 'Open Oxford Panel', ButtonStyle.Primary), button('settings:feature:oxford:key', 'Set Server Key', ButtonStyle.Secondary)],
    shifts: [button('settings:feature:shifts:toggle', s.shifts?.enabled ? 'Disable' : 'Enable', s.shifts?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    roblox: [button('settings:feature:roblox:toggle', s.roblox?.enabled ? 'Disable' : 'Enable', s.roblox?.enabled ? ButtonStyle.Danger : ButtonStyle.Success)],
    api: [button('settings:feature:api:info', 'View API Information', ButtonStyle.Secondary)],
    general: [button('settings:feature:general:refresh', 'Refresh', ButtonStyle.Secondary)]
  }[feature] || [];

  return v2Payload([
    { type: 'text', value: `${content}${notice ? `\n\n${notice}` : ''}` },
    { type: 'separator', value: separator() },
    ...chunkRows(controls),
    { type: 'row', value: row([button('settings:back', 'Back', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}
function selectedFeature(i) {
  return i.customId.split(':')[2];
}

async function quickSetup(i) {
  const s = get(i.guild.id);
  const matches = {
    manager: roleByNames(i.guild, ['manager', 'management']),
    administrator: roleByNames(i.guild, ['administrator', 'admin']),
    moderator: roleByNames(i.guild, ['moderator', 'mod']),
    support: roleByNames(i.guild, ['support', 'helper'])
  };

  s.staffHierarchy = s.staffHierarchy.map(x => ({
    ...x,
    roleId: matches[x.key]?.id || x.roleId || null
  }));

  const manager = s.staffHierarchy.find(x => x.key === 'manager')?.roleId || null;
  if (!s.applications.managerRoleId) s.applications.managerRoleId = manager;
  if (!s.suggestions.channelId) s.suggestions.channelId = null;
  s.defaultsAppliedAt = Date.now();
  save(i.guild.id, s);

  const assigned = Object.values(matches).filter(Boolean).length;
  return panel(i, assigned
    ? `✅ Recommended defaults applied. Matched ${assigned} staff role${assigned === 1 ? '' : 's'}. Bot and managed roles were ignored.`
    : '✅ Recommended defaults applied. No suitable staff roles were found, so no roles were assigned.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure Oxy for this server'),

  async execute(i) {
    if (!i.guild) return i.reply(v2Payload([{ type: 'text', value: text('This command can only be used in a server.') }], { ephemeral: true }));
    if (!isGuildAdmin(i)) return i.reply(v2Payload([{ type: 'text', value: text('You need server management access to use /settings.') }], { ephemeral: true }));
    const cfg = db.getGuildConfig(i.guild.id);
    let stored = {};
    try { stored = JSON.parse(cfg.settings_json || '{}'); } catch {}
    if (stored.schemaVersion !== SETTINGS_SCHEMA_VERSION) resetSettings(i.guild.id);
    return i.reply(panel(i));
  },

  async handleSelect(i) {
    if (!i.customId.startsWith('settings:')) return false;
    if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to change these settings.') }], { ephemeral: true }));

    if (i.customId === 'settings:menu') {
      const value = i.values[0];
      if (value === 'quick') return editSettings(i, await quickSetup(i));
      if (value === 'staff') return editSettings(i, staffPanel(i));
      if (value === 'automod') return editSettings(i, automodPanel(i));
      if (value === 'promotions') return editSettings(i, promotionsPanel(i));
      return editSettings(i, featurePanel(i, value));
    }

    if (i.customId === 'settings:staff:editselect') {
      const key = i.values[0];
      const item = get(i.guild.id).staffHierarchy.find(x => x.key === key);
      if (!item) return editSettings(i, staffPanel(i));
      return i.showModal(staffRankModal(item.key, item.name, item.level));
    }

    if (i.customId === 'settings:staff:removeselect') {
      const key = i.values[0];
      const s = get(i.guild.id);
      const item = s.staffHierarchy.find(x => x.key === key);
      if (!item || STAFF_CORE_KEYS.has(key)) return editSettings(i, staffPanel(i));
      s.staffHierarchy = s.staffHierarchy.filter(x => x.key !== key);
      save(i.guild.id, s);
      return editSettings(i, staffPanel(i));
    }

    if (i.customId === 'settings:automod:module') {
      const key = i.values[0];
      const s = get(i.guild.id);
      if (!(key in s.automod.modules)) return editSettings(i, automodPanel(i));
      s.automod.modules[key] = !s.automod.modules[key];
      save(i.guild.id, s);
      return editSettings(i, automodPanel(i, `✅ ${key} detection ${s.automod.modules[key] ? 'enabled' : 'disabled'}.`));
    }

    return false;
  },

  async handleButton(i) {
    if (!i.customId.startsWith('settings:')) return false;
    if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to change these settings.') }], { ephemeral: true }));

    const parts = i.customId.split(':');
    const area = parts[1];

    if (area === 'quick') return editSettings(i, await quickSetup(i));
    if (area === 'close') return editSettings(i, v2Payload([{ type: 'text', value: text('Settings closed.') }], { ephemeral: true }));
    if (area === 'back') return editSettings(i, panel(i));
    if (area === 'staff') {
      const action = parts[2];
      if (action === 'add') return editSettings(i, addStaffRolePicker(i));
      if (action === 'edit') {
        const s = get(i.guild.id);
        const options = s.staffHierarchy.slice(0, 25).map(x => ({ value: x.key, label: x.name.slice(0,100), description: `Level ${x.level}` }));
        return editSettings(i, v2Payload([{type:'text',value:text('Select the staff rank you want to edit.')} ,{type:'row',value:row([select('settings:staff:editselect','Select a staff rank...',options)])},{type:'row',value:row([button('settings:back','Back',ButtonStyle.Secondary)])}],{ephemeral:true}));
      }
      if (action === 'remove') {
        const s = get(i.guild.id);
        const options = s.staffHierarchy.filter(x => !STAFF_CORE_KEYS.has(x.key)).slice(0,25).map(x => ({ value:x.key, label:x.name.slice(0,100), description:`Level ${x.level}` }));
        if (!options.length) return editSettings(i, staffPanel(i));
        return editSettings(i, v2Payload([{type:'text',value:text('Select a custom staff rank to remove. Core ranks cannot be removed.')} ,{type:'row',value:row([select('settings:staff:removeselect','Select a custom rank...',options)])},{type:'row',value:row([button('settings:back','Back',ButtonStyle.Secondary)])}],{ephemeral:true}));
      }
      if (action === 'promotions' || action === 'manage') return editSettings(i, promotionsPanel(i));
      return editSettings(i, staffPanel(i));
    }
    if (area === 'promotions') {
      const action = parts[2];
      const s = get(i.guild.id);
      if (action === 'toggle') s.promotions.enabled = !s.promotions.enabled;
      else if (action === 'replace') s.promotions.replaceStaffRoles = !s.promotions.replaceStaffRoles;
      else if (action === 'logchannel') return editSettings(i, channelPicker(i, 'settings:promotions:logChannelSelect', 'Promotion Log Channel', 'Select promotion log channel'));
      else return editSettings(i, promotionsPanel(i));
      save(i.guild.id, s);
      return editSettings(i, promotionsPanel(i, '✅ Promotion settings updated.'));
    }
    if (area === 'general') return editSettings(i, featurePanel(i, 'general'));
    if (area === 'automod') {
      const action = parts[2];
      const s = get(i.guild.id);
      if (action === 'open') return editSettings(i, automodPanel(i));
      if (action === 'toggle') s.automod.enabled = !s.automod.enabled;
      else if (action === 'delete') s.automod.deleteMessages = !s.automod.deleteMessages;
      else if (action === 'logging') s.automod.logActions = !s.automod.logActions;
      else if (action === 'bypass') s.automod.bypassAdmins = !s.automod.bypassAdmins;
      else if (action === 'escalation') s.automod.escalation.enabled = !s.automod.escalation.enabled;
      else if (action === 'defaults') s.automod = JSON.parse(JSON.stringify(DEFAULT_AUTOMOD));
      else if (action === 'logchannel') return editSettings(i, channelPicker(i, 'settings:automod:logChannelSelect', 'AutoMod Log Channel', 'Select the AutoMod log channel'));
      else return editSettings(i, automodPanel(i));
      save(i.guild.id, s);
      return editSettings(i, automodPanel(i, '✅ AutoMod settings updated.'));
    }
    if (area === 'feature') {
      const feature = selectedFeature(i);
      const action = parts[3];
      const s = get(i.guild.id);

      if (!action) return editSettings(i, featurePanel(i, feature));

      if (feature === 'messages') {
        if (action === 'welcome') {
          s.messages.welcome.enabled = !s.messages.welcome.enabled;
          save(i.guild.id, s);
          return editSettings(i, featurePanel(i, 'messages'));
        }
        if (action === 'leave') {
          s.messages.leave.enabled = !s.messages.leave.enabled;
          save(i.guild.id, s);
          return editSettings(i, featurePanel(i, 'messages'));
        }
        if (action === 'welcomeChannel') {
          return editSettings(i, channelPicker(i, 'settings:feature:messages:welcomeChannelSelect', 'Welcome Message Channel', 'Select welcome channel'));
        }
        if (action === 'leaveChannel') {
          return editSettings(i, channelPicker(i, 'settings:feature:messages:leaveChannelSelect', 'Leave Message Channel', 'Select leave channel'));
        }
        if (action === 'auditLog') {
          return editSettings(i, channelPicker(i, 'settings:feature:messages:auditLogChannelId:select', 'Bot Action Log Channel', 'Select bot action log channel'));
        }
        if (action === 'moderationLog') {
          return editSettings(i, channelPicker(i, 'settings:feature:messages:moderationLogSelect', 'Moderation Log Channel', 'Select moderation log channel'));
        }
        const messageLogPickers = {
          commandLog: ['Command Log Channel', 'Select command log channel', 'commandLogChannelId'],
          joinLog: ['Join Log Channel', 'Select join log channel', 'joinLogChannelId'],
          killLog: ['Kill Log Channel', 'Select kill log channel', 'killLogChannelId'],
          shiftLog: ['Shift Log Channel', 'Select shift log channel', 'shiftLogChannelId'],
          ticketLog: ['Ticket Log Channel', 'Select ticket log channel', 'ticketLogChannelId'],
          applicationLog: ['Application Log Channel', 'Select application log channel', 'applicationLogChannelId'],
          suggestionLog: ['Suggestion Log Channel', 'Select suggestion log channel', 'suggestionLogChannelId'],
          giveawayLog: ['Giveaway Log Channel', 'Select giveaway log channel', 'giveawayLogChannelId'],
          modCallLog: ['Mod Call Log Channel', 'Select mod call log channel', 'modCallChannelId'],
          auditLog: ['Bot Action Log Channel', 'Select bot action log channel', 'auditLogChannelId']
        };
        if (messageLogPickers[action]) {
          const [title, placeholder, key] = messageLogPickers[action];
          return editSettings(i, channelPicker(i, `settings:feature:messages:${key}:select`, title, placeholder));
        }
      }

      if (feature === 'config') {
        if (action === 'adminRole') {
          return editSettings(i, rolePicker('settings:feature:config:adminRoleSelect', 'Oxy Admin Role', 'Select the Discord role used for Oxy administration.'));
        }
        if (action === 'apiKey') {
          return i.reply(v2Payload([
            { type: 'text', value: text('Enter the Oxford Response API key for this server.') },
            { type: 'row', value: row([button('settings:feature:config:apiKeyModal', 'Enter API Key', ButtonStyle.Primary)]) }
          ], { ephemeral: true }));
        }
        if (action === 'apiKeyModal') {
          return i.showModal(modalWithText({
            customId: 'settings:feature:config:apiKey',
            title: 'Oxford Response API Key',
            label: 'API key',
            description: 'The key is encrypted before being stored.',
            inputId: 'api-key',
            maxLength: 500
          }));
        }
        if (action === 'clearApiKey') {
          db.setGuildConfig(i.guild.id, { oxford_api_key: null });
          return editSettings(i, featurePanel(i, 'config', '✅ Oxford Response API key cleared.'));
        }
        if (action === 'serverApiKey') {
          if (i.guild.ownerId !== i.user.id) return i.reply(v2Payload([{ type: 'text', value: text('Only the Discord server owner can generate its Oxy API key.') }], { ephemeral: true }));
          const crypto = require('node:crypto');
          const apiKey = 'oxc_' + crypto.randomBytes(32).toString('hex');
          const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
          db.setGuildApiKey(i.guild.id, hash);
          return i.reply(v2Payload([{ type: 'text', value: text(`## Server API Key\n\n\`\`\`\n${apiKey}\n\`\`\`\n\nThis key is shown once. Store it securely.`) }], { ephemeral: true }));
        }
        if (action === 'revokeServerApiKey') {
          if (i.guild.ownerId !== i.user.id) return i.reply(v2Payload([{ type: 'text', value: text('Only the Discord server owner can revoke its Oxy API key.') }], { ephemeral: true }));
          db.revokeGuildApiKey(i.guild.id);
          return editSettings(i, featurePanel(i, 'config', '✅ Server API key revoked.'));
        }
      }

      if (feature === 'tickets') {
        if (action === 'toggle') { s.tickets.enabled = !s.tickets.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'tickets')); }
        if (action === 'open') return editSettings(i, featurePanel(i, 'tickets', 'Use `/tickets` for the full ticket setup panel, including questions, panel publishing and anonymous Modmail.'));
      }

      if (feature === 'applications') {
        if (action === 'toggle') { s.applications.enabled = !s.applications.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'applications')); }
        if (action === 'open') return editSettings(i, featurePanel(i, 'applications', 'Use `/applications` for the full form and review configuration.')); 
      }

      if (feature === 'suggestions') {
        if (action === 'toggle') { s.suggestions.enabled = !s.suggestions.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'suggestions')); }
        if (action === 'channel') return editSettings(i, channelPicker(i, 'settings:feature:suggestions:channelSelect', 'Suggestion Channel', 'Select suggestion channel'));
      }

      if (feature === 'automod') return editSettings(i, automodPanel(i));

      if (feature === 'reactionroles') {
        if (action === 'toggle') { s.reactionRoles.enabled = !s.reactionRoles.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'reactionroles')); }
        if (action === 'open') return editSettings(i, featurePanel(i, 'reactionroles', 'Use `/reactionroles` for the full role panel builder.'));
      }

      if (feature === 'moderation' && action === 'log') {
        return editSettings(i, channelPicker(i, 'settings:feature:moderation:logSelect', 'Moderation Log Channel', 'Select moderation log channel'));
      }

      if (feature === 'music' && action === 'toggle') { s.music.enabled = !s.music.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'music')); }
      if (feature === 'shifts' && action === 'toggle') { s.shifts.enabled = !s.shifts.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'shifts')); }
      if (feature === 'roblox' && action === 'toggle') { s.roblox.enabled = !s.roblox.enabled; save(i.guild.id, s); return editSettings(i, featurePanel(i, 'roblox')); }
      if (feature === 'api' && action === 'info') return editSettings(i, featurePanel(i, 'api'));
      if (feature === 'general' && action === 'refresh') return editSettings(i, featurePanel(i, 'general'));
      if (feature === 'oxford' && action === 'open') return editSettings(i, featurePanel(i, 'oxford', 'Use `/oxford` for Oxford Response controls.'));
      if (feature === 'oxford' && action === 'key') return editSettings(i, featurePanel(i, 'oxford', 'Use the server Oxford configuration flow to store the encrypted key.'));

      return editSettings(i, featurePanel(i, feature));
    }

    if (area === 'role') {
      const key = parts[2];
      const item = get(i.guild.id).staffHierarchy.find(x => x.key === key);
      if (!item) return i.reply(v2Payload([{ type: 'text', value: text('Staff level not found.') }], { ephemeral: true }));
      return editSettings(i, rolePicker(`settings:role:${key}`, `Set ${item.name} Role`, `Select the Discord role for **${item.name}**.`));
    }

    return false;
  },

  async handleModal(i) {
    if (i.customId.startsWith('settings:staff:editmodal:')) {
      if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{type:'text',value:text('You are not authorised to change these settings.')}],{ephemeral:true}));
      const keyPart = i.customId.slice('settings:staff:editmodal:'.length);
      const pieces = keyPart.split(':');
      const key = pieces[0];
      const roleIdFromAdd = pieces[1] || null;
      const name = i.fields.getTextInputValue('name').trim();
      const level = Number(i.fields.getTextInputValue('level').trim());
      if (!name || name.length > 50) return i.reply(v2Payload([{type:'text',value:text('Rank name must be between 1 and 50 characters.')}],{ephemeral:true}));
      if (!Number.isInteger(level) || level < 1 || level > 99) return i.reply(v2Payload([{type:'text',value:text('Rank level must be a whole number from 1 to 99.')}],{ephemeral:true}));
      const s = get(i.guild.id);
      if (roleIdFromAdd) {
        if (s.staffHierarchy.length >= MAX_STAFF_RANKS) return i.reply(v2Payload([{type:'text',value:text(`You can have up to ${MAX_STAFF_RANKS} staff ranks.`)}],{ephemeral:true}));
        if (s.staffHierarchy.some(x => x.roleId === roleIdFromAdd)) return i.reply(v2Payload([{type:'text',value:text('That role is already part of the staff hierarchy.')}],{ephemeral:true}));
        s.staffHierarchy.push({ key, name, level, roleId: roleIdFromAdd });
      } else {
        const item = s.staffHierarchy.find(x => x.key === key);
        if (!item) return i.reply(v2Payload([{type:'text',value:text('Staff rank not found.')}],{ephemeral:true}));
        item.name = name;
        item.level = level;
      }
      save(i.guild.id, s);
      return i.reply(v2Payload([{type:'text',value:text(`✅ Staff rank **${name}** saved at level **${level}**.`)}],{ephemeral:true}));
    }
    if (i.customId !== 'settings:feature:config:apiKey') return false;
    if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{ type:'text', value:text('You are not authorised to change these settings.') }], { ephemeral:true }));
    const apiKey = i.fields.getTextInputValue('api-key').trim();
    if (!apiKey) return i.reply(v2Payload([{ type:'text', value:text('The Oxford Response API key cannot be empty.') }], { ephemeral:true }));
    db.setGuildConfig(i.guild.id, { oxford_api_key: apiKey });
    return i.reply(v2Payload([{ type:'text', value:text('✅ The Oxford Response API key has been saved securely for this server.') }], { ephemeral:true }));
  },

  async handleRole(i) {
    if (!i.customId.startsWith('settings:')) return false;
    if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to change these settings.') }], { ephemeral: true }));
    const parts = i.customId.split(':');
    const s = get(i.guild.id);

    if (i.customId === 'settings:staff:addrole') {
      const roleId = i.values[0];
      const s = get(i.guild.id);
      if (s.staffHierarchy.length >= MAX_STAFF_RANKS) return i.reply(v2Payload([{type:'text',value:text(`You can have up to ${MAX_STAFF_RANKS} staff ranks.`)}],{ephemeral:true}));
      if (s.staffHierarchy.some(x => x.roleId === roleId)) return i.reply(v2Payload([{type:'text',value:text('That role is already part of the staff hierarchy.')}],{ephemeral:true}));
      const role = i.guild.roles.cache.get(roleId);
      if (!role || role.managed || role.id === i.guild.id) return i.reply(v2Payload([{type:'text',value:text('That role cannot be used as a staff rank.')}],{ephemeral:true}));
      const key = `custom_${Date.now().toString(36)}`;
      return i.showModal(staffRankModal(`${key}:${roleId}`, role.name, Math.max(1, Math.min(99, (Math.max(...s.staffHierarchy.map(x => Number(x.level)||0), 0) - 5)))));
    }

    if (parts[1] === 'role') {
      const key = parts[2];
      s.staffHierarchy = s.staffHierarchy.map(x => x.key === key ? { ...x, roleId: i.values[0] } : x);
      if (key === 'manager') s.applications.managerRoleId = i.values[0];
      save(i.guild.id, s);
      return editSettings(i, staffPanel(i));
    }

    if (i.customId === 'settings:feature:config:adminRoleSelect') {
      const roleId = i.values[0];
      s.staffHierarchy = s.staffHierarchy.map(x => x.key === 'administrator' ? { ...x, roleId } : x);
      save(i.guild.id, s);
      return editSettings(i, featurePanel(i, 'config', `✅ Oxy admin role set to <@&${roleId}>.`));
    }

    return false;
  },

  async handleChannel(i) {
    if (!i.customId.startsWith('settings:')) return false;
    if (!i.guild || !isGuildAdmin(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to change these settings.') }], { ephemeral: true }));

    const parts = i.customId.split(':');
    const s = get(i.guild.id);
    const channelId = i.values[0];

    if (i.customId === 'settings:promotions:logChannelSelect') {
      s.promotions.logChannelId = channelId;
      save(i.guild.id, s);
      return editSettings(i, promotionsPanel(i, `✅ Promotion logs will now use <#${channelId}>.`));
    }

    if (i.customId === 'settings:automod:logChannelSelect') {
      s.automod.logChannelId = channelId;
      s.automod.logActions = true;
      save(i.guild.id, s);
      return editSettings(i, automodPanel(i, `✅ AutoMod logs will now use <#${channelId}>.`));
    }

    if (i.customId === 'settings:feature:suggestions:channelSelect') {
      s.suggestions.channelId = channelId;
      s.messages.suggestionLogChannelId = channelId;
      save(i.guild.id, s);
      return editSettings(i, featurePanel(i, 'suggestions', `✅ Suggestions will now use <#${channelId}>.`));
    }

    if (i.customId === 'settings:feature:moderation:logSelect' || i.customId === 'settings:feature:messages:moderationLogSelect') {
      s.moderation.logChannelId = channelId;
      s.messages.moderationLogChannelId = channelId;
      s.moderation.logging = true;
      save(i.guild.id, s);
      return editSettings(i, featurePanel(i, i.customId.includes('messages:') ? 'messages' : 'moderation', `✅ Moderation logs will now use <#${channelId}>.`));
    }

    if (i.customId === 'settings:feature:messages:welcomeChannelSelect') {
      s.messages.welcome.channelId = channelId;
      save(i.guild.id, s);
      return editSettings(i, featurePanel(i, 'messages', `✅ Welcome messages will now use <#${channelId}>.`));
    }

    if (i.customId === 'settings:feature:messages:leaveChannelSelect') {
      s.messages.leave.channelId = channelId;
      save(i.guild.id, s);
      return editSettings(i, featurePanel(i, 'messages', `✅ Leave messages will now use <#${channelId}>.`));
    }

    const logSelectMap = {
      commandLogChannelId: 'commandLogChannelId',
      joinLogChannelId: 'joinLogChannelId',
      killLogChannelId: 'killLogChannelId',
      shiftLogChannelId: 'shiftLogChannelId',
      ticketLogChannelId: 'ticketLogChannelId',
      applicationLogChannelId: 'applicationLogChannelId',
      suggestionLogChannelId: 'suggestionLogChannelId',
      giveawayLogChannelId: 'giveawayLogChannelId',
      modCallChannelId: 'modCallChannelId'
    };
    for (const key of Object.keys(logSelectMap)) {
      if (i.customId === `settings:feature:messages:${key}:select`) {
        s.messages[logSelectMap[key]] = channelId;
        save(i.guild.id, s);
        return editSettings(i, featurePanel(i, 'messages', `✅ ${key.replace(/ChannelId$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} will now use <#${channelId}>.`));
      }
    }

    return false;
  }
};
