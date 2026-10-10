const { PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const { v2Payload, text, separator } = require('../utils/components');

function getSettings(guildId) {
  const row = db.getGuildConfig(guildId);
  try { return JSON.parse(row.settings_json || '{}'); } catch { return {}; }
}

function resolveChannelId(guildId, preferred = null) {
  const settings = getSettings(guildId);
  return preferred ||
    settings.auditLogChannelId ||
    settings.messages?.commandLogChannelId ||
    settings.messages?.moderationLogChannelId ||
    settings.moderation?.logChannelId || null;
}

function safeOptions(interaction) {
  if (!interaction.isChatInputCommand?.()) return null;
  try {
    return interaction.options?.data?.map(x => {
      const name = String(x.name || '').toLowerCase();
      if (/key|token|secret|password|passcode|credential/i.test(name)) return `${x.name}=<redacted>`;
      let value = x.value;
      if (typeof value === 'string' && value.length > 150) value = `${value.slice(0, 147)}...`;
      return `${x.name}=${String(value)}`;
    }).join(' • ') || null;
  } catch { return null; }
}

function escapeMarkdownLabel(value) {
  return String(value || 'Unknown user').replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\[/g, '\\[').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function userProfileLink(guild, userId, fallbackTag = null) {
  if (!userId) return 'System';
  const memberUser = guild?.members?.cache?.get(String(userId))?.user;
  const cachedUser = guild?.client?.users?.cache?.get(String(userId));
  const username = memberUser?.username || cachedUser?.username || String(fallbackTag || userId).split('#')[0];
  return `[${escapeMarkdownLabel(username)}](https://discord.com/users/${userId})`;
}

function replaceUserMentions(guild, value) {
  if (value == null) return value;
  return String(value).replace(/<@!?(\d+)>/g, (_, userId) => userProfileLink(guild, userId));
}

function describe(interaction) {
  if (interaction.isChatInputCommand?.()) {
    const options = safeOptions(interaction);
    return options ? `/${interaction.commandName} • ${options}` : `/${interaction.commandName}`;
  }
  if (interaction.isButton?.()) return `Button • ${interaction.customId}`;
  if (interaction.isStringSelectMenu?.()) return `Select • ${interaction.customId} • ${interaction.values?.join(', ') || ''}`;
  if (interaction.isChannelSelectMenu?.()) return `Channel Select • ${interaction.customId} • ${interaction.values?.join(', ') || ''}`;
  if (interaction.isUserSelectMenu?.()) return `User Select • ${interaction.customId} • ${interaction.values?.join(', ') || ''}`;
  if (interaction.isRoleSelectMenu?.()) return `Role Select • ${interaction.customId} • ${interaction.values?.join(', ') || ''}`;
  if (interaction.isModalSubmit?.()) return `Modal • ${interaction.customId}`;
  return `Interaction • ${interaction.type}`;
}

async function log(guild, data = {}) {
  if (!guild) return false;
  const channelId = resolveChannelId(guild.id, data.channelId);
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  if (!channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return false;

  const lines = [
    '## 🧾 Oxy Bot Action',
    `**Action:** ${data.action || 'unknown'}`,
    `**Actor:** ${data.actorId ? userProfileLink(guild, data.actorId, data.actorTag) : 'System'}`,
    `**Time:** <t:${Math.floor((data.createdAt || Date.now()) / 1000)}:F>`,
    `**Details:** ${replaceUserMentions(guild, data.details || 'No details provided')}`
  ];
  if (data.targetId) lines.splice(3, 0, `**Target:** ${userProfileLink(guild, data.targetId, data.targetTag)}`);
  if (data.status) lines.push(`**Status:** ${replaceUserMentions(guild, data.status)}`);
  await channel.send(v2Payload([{ type: 'text', value: text(lines.join('\n')) }, { type: 'separator', value: separator() }])).catch(() => {});
  return true;
}

async function logInteraction(interaction, status = 'Completed') {
  if (!interaction?.guild) return false;
  return log(interaction.guild, {
    action: interaction.isChatInputCommand?.() ? 'Command' : 'Component',
    actorId: interaction.user?.id,
    actorTag: interaction.user?.tag,
    details: describe(interaction),
    status
  });
}

module.exports = { log, logInteraction, resolveChannelId, userProfileLink, replaceUserMentions };
