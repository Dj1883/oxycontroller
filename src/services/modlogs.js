const { PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const { v2Payload, text, separator, row, button } = require('../utils/components');
const audit = require('./audit');

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

function recordAction(data) {
  return db.createModerationCase(data);
}

function actionCounts(guildId, discordId) {
  return db.getModerationActionCount(guildId, discordId);
}

function recipientCounts(guildId, discordId) {
  return db.getModerationRecipientCount(guildId, discordId);
}

function logPayload(entry, guild = null) {
  const staffCount = entry.action === 'automod' ? null : actionCounts(entry.guildId, entry.moderatorId);
  const recipientCount = recipientCounts(entry.guildId, entry.targetId);
  const target = userProfileLink(guild, entry.targetId, entry.targetTag);
  const moderator = userProfileLink(guild, entry.moderatorId, entry.moderatorTag);
  const lines = [
    `## 🛡️ Moderation Case #${entry.caseId}`,
    `**Action:** ${entry.action}`,
    `**Recipient:** ${target}`,
    `**Moderator:** ${moderator}`,
    `**When:** <t:${Math.floor(entry.createdAt / 1000)}:F> (<t:${Math.floor(entry.createdAt / 1000)}:R>)`,
    `**Reason:** ${audit.replaceUserMentions(guild, entry.reason || 'No reason provided')}`,
    `**Staff actions:** ${staffCount == null ? 'N/A (AutoMod)' : staffCount}`,
    `**Server:** ${entry.guildId}`,
    `**Recipient moderation history:** ${recipientCount}`
  ];
  if (entry.durationSeconds) lines.push(`**Duration:** ${entry.durationSeconds >= 3600 ? `${Math.round(entry.durationSeconds / 3600 * 10) / 10}h` : `${Math.round(entry.durationSeconds / 60)}m`}`);
  if (entry.details) lines.push(`**Details:** ${audit.replaceUserMentions(guild, entry.details)}`);
  return v2Payload([
    { type:'text', value:text(lines.join('\n')) },
    { type:'separator', value:separator() },
    { type:'row', value:row([button(`moderation:case:${entry.caseId}`, 'View Case')]) }
  ]);
}

async function sendLog(guild, entry, preferredChannelId = null) {
  const cfg = db.getGuildConfig(guild.id);
  const settings = JSON.parse(cfg.settings_json || '{}');
  const channelId = preferredChannelId || settings.messages?.moderationLogChannelId || settings.moderation?.logChannelId;
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  if (!channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return false;
  await channel.send(logPayload(entry, guild));
  return true;
}

module.exports = { recordAction, actionCounts, recipientCounts, logPayload, sendLog };
