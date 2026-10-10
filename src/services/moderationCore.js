const { PermissionFlagsBits } = require('discord.js');
const db = require('../db/database');
const logs = require('./modlogs');
const { v2Payload, text, separator } = require('../utils/components');
const audit = require('./audit');

const permissionMap = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  softban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  note: PermissionFlagsBits.ModerateMembers,
  notes: PermissionFlagsBits.ModerateMembers,
  warnings: PermissionFlagsBits.ModerateMembers,
  'clear-warnings': PermissionFlagsBits.ModerateMembers,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  slowmode: PermissionFlagsBits.ManageChannels
};

function getSettings(guildId) {
  const cfg = db.getGuildConfig(guildId);
  try { return JSON.parse(cfg.settings_json || '{}'); } catch { return {}; }
}

function canManage(interaction, action) {
  if (!interaction.guild || !interaction.member) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const needed = permissionMap[action];
  if (!needed || !interaction.memberPermissions?.has(needed)) return false;
  const settings = getSettings(interaction.guild.id);
  const roleId = settings.moderation?.roles?.[action];
  if (roleId && !interaction.member.roles.cache.has(roleId)) return false;
  return true;
}

function requirePermission(interaction, action) {
  if (canManage(interaction, action)) return true;
  interaction.reply(v2Payload([{ type: 'text', value: text('You are not authorised to perform this action.') }], { ephemeral: true }));
  return false;
}

async function getMember(interaction, userId) {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

function protectedMember(interaction, member, requireBotHierarchy = true) {
  if (!member) return true;
  if (member.id === interaction.guild.ownerId || member.id === interaction.user.id) return true;
  const moderator = interaction.member;
  const bot = interaction.guild.members.me;
  if (moderator && member.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) return true;
  if (requireBotHierarchy && bot && member.roles.highest.comparePositionTo(bot.roles.highest) >= 0) return true;
  return false;
}

function actionResult(caseRow) {
  const duration = caseRow.duration_seconds ? `\n**Duration:** ${formatDuration(caseRow.duration_seconds)}` : '';
  return v2Payload([{ type: 'text', value: text(
    `## Moderation Case #${caseRow.id}\n\n` +
    `**Action:** ${caseRow.action}\n` +
    `**User:** <@${caseRow.target_id}>\n` +
    `**Reason:** ${caseRow.reason || 'No reason provided'}${duration}\n` +
    `**Staff actions:** ${db.getModerationActionCount(caseRow.guild_id, caseRow.moderator_id)}\n` +
    `**Recipient moderation actions:** ${db.getModerationRecipientCount(caseRow.guild_id, caseRow.target_id)}`
  ) }, { type: 'separator', value: separator() }]);
}

function formatDuration(seconds) {
  const n = Number(seconds || 0);
  if (n % 604800 === 0) return `${n / 604800}w`;
  if (n % 86400 === 0) return `${n / 86400}d`;
  if (n % 3600 === 0) return `${n / 3600}h`;
  if (n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

async function performUserAction(interaction, { action, userId, reason = 'No reason provided', durationSeconds = null, details = null }) {
  if (!requirePermission(interaction, action)) return;

  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) return interaction.reply(v2Payload([{ type: 'text', value: text('I could not find that Discord user.') }], { ephemeral: true }));

  const member = await getMember(interaction, userId);
  if (action !== 'unban' && action !== 'softban' && (!member || protectedMember(interaction, member, action !== 'warn' && action !== 'note' && action !== 'case'))) {
    return interaction.reply(v2Payload([{ type: 'text', value: text('That member cannot be moderated because of role hierarchy or because they are protected.') }], { ephemeral: true }));
  }

  if (action === 'timeout') {
    if (!durationSeconds || durationSeconds < 5 || durationSeconds > 2419200) {
      return interaction.reply(v2Payload([{ type: 'text', value: text('Timeout duration must be between 5 seconds and 28 days. Examples: `30m`, `2h`, `3d`.') }], { ephemeral: true }));
    }
  }

  try {
    if (action === 'warn') {
      // Warning is a moderation case only.
    } else if (action === 'timeout') {
      await member.timeout(durationSeconds * 1000, reason);
    } else if (action === 'untimeout') {
      if (!member) return interaction.reply(v2Payload([{ type: 'text', value: text('That user is not currently in this server.') }], { ephemeral: true }));
      await member.timeout(null, reason);
    } else if (action === 'kick') {
      await member.kick(reason);
    } else if (action === 'ban') {
      await member.ban({ reason, deleteMessageSeconds: 0 });
    } else if (action === 'softban') {
      await member.ban({ reason, deleteMessageSeconds: 86400 });
      await interaction.guild.bans.remove(user.id, reason);
    } else if (action === 'unban') {
      await interaction.guild.members.unban(user.id, reason);
    }

    const actionLabel = {
      warn: 'Warning', timeout: 'Timeout', untimeout: 'Timeout Removed', kick: 'Kick',
      ban: 'Ban', softban: 'Softban', unban: 'Unban'
    }[action] || action;

    if (!['warn', 'untimeout'].includes(action)) {
      const dm = [
        '## Oxy Controller • Moderation Notice',
        `A moderation action was taken against you in **${interaction.guild.name}**.`,
        `**Action:** ${actionLabel}`,
        `**Reason:** ${reason || 'No reason provided.'}`,
        durationSeconds ? `**Duration:** ${formatDuration(durationSeconds)}` : null,
        `**Moderator:** ${interaction.user.tag}`
      ].filter(Boolean).join('\n\n');
      await user.send(v2Payload([{ type: 'text', value: text(dm) }])).catch(() => {});
    }

    const caseRow = logs.recordAction({
      guildId: interaction.guild.id,
      action,
      targetId: user.id,
      targetTag: user.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason,
      durationSeconds,
      details
    });
    await logs.sendLog(interaction.guild, caseRow).catch(e => console.error('Moderation log failed:', e.message));
    return interaction.reply(actionResult(caseRow));
  } catch (error) {
    return interaction.reply(v2Payload([{ type: 'text', value: text(`Moderation action failed: ${error.message || error}`) }], { ephemeral: true }));
  }
}

function listWarnings(guildId, userId) {
  const rows = db.getModerationCases(guildId, userId, 100).sort((a, b) => a.created_at - b.created_at);
  let clearedAfter = 0;
  for (const row of rows) if (row.action === 'warning-clear') clearedAfter = Math.max(clearedAfter, row.created_at);
  return rows.filter(row => row.action === 'warn' && row.created_at > clearedAfter).sort((a, b) => b.created_at - a.created_at);
}

async function clearWarnings(interaction, userId, reason) {
  if (!requirePermission(interaction, 'clear-warnings')) return;
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) return interaction.reply(v2Payload([{ type: 'text', value: text('I could not find that Discord user.') }], { ephemeral: true }));
  const warnings = listWarnings(interaction.guild.id, userId);
  if (!warnings.length) return interaction.reply(v2Payload([{ type: 'text', value: text(`${user} has no active warnings to clear.`) }], { ephemeral: true }));
  const caseRow = logs.recordAction({
    guildId: interaction.guild.id,
    action: 'warning-clear',
    targetId: user.id,
    targetTag: user.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: reason || 'Warnings cleared',
    details: `Cleared ${warnings.length} active warning${warnings.length === 1 ? '' : 's'}`
  });
  await logs.sendLog(interaction.guild, caseRow).catch(e => console.error('Warning clear log failed:', e.message));
  return interaction.reply(v2Payload([{ type: 'text', value: text(`Cleared **${warnings.length}** active warning${warnings.length === 1 ? '' : 's'} from <@${user.id}>.\n\n**Case:** #${caseRow.id}`) }]));
}

async function addNote(interaction, userId, note) {
  if (!requirePermission(interaction, 'note')) return;
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (!user) return interaction.reply(v2Payload([{ type: 'text', value: text('I could not find that Discord user.') }], { ephemeral: true }));
  if (!note) return interaction.reply(v2Payload([{ type: 'text', value: text('The note cannot be empty.') }], { ephemeral: true }));
  const caseRow = logs.recordAction({
    guildId: interaction.guild.id,
    action: 'note',
    targetId: user.id,
    targetTag: user.tag,
    moderatorId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    reason: 'Staff note',
    details: note
  });
  await logs.sendLog(interaction.guild, caseRow).catch(e => console.error('Note log failed:', e.message));
  return interaction.reply(v2Payload([{ type: 'text', value: text(`Staff note added for <@${user.id}>.\n\n**Note:** ${audit.replaceUserMentions(interaction.guild, note)}\n**Case:** #${caseRow.id}`) }], { ephemeral: true }));
}

function showCase(interaction, id) {
  if (!requirePermission(interaction, 'case')) return;
  const row = db.getModerationCase(id);
  if (!row || row.guild_id !== interaction.guild.id) return interaction.reply(v2Payload([{ type: 'text', value: text('That case could not be found.') }], { ephemeral: true }));
  const lines = [
    `## Moderation Case #${row.id}`,
    `**Action:** ${row.action}`,
    `**Recipient:** <@${row.target_id}>`,
    `**Moderator:** <@${row.moderator_id}>`,
    `**When:** <t:${Math.floor(row.created_at / 1000)}:F>`,
    `**Reason:** ${row.reason || 'No reason provided'}`,
    row.duration_seconds ? `**Duration:** ${formatDuration(row.duration_seconds)}` : null,
    `**Staff actions:** ${row.action === 'automod' ? 'N/A (AutoMod)' : db.getModerationActionCount(row.guild_id, row.moderator_id)}`,
    `**Recipient moderation actions:** ${db.getModerationRecipientCount(row.guild_id, row.target_id)}`,
    row.details ? `**Details:** ${audit.replaceUserMentions(interaction.guild, row.details)}` : null
  ].filter(Boolean);
  return interaction.reply(v2Payload([{ type: 'text', value: text(lines.join('\n')) }], { ephemeral: true }));
}

function listCases(interaction, userId = null) {
  if (!requirePermission(interaction, 'cases')) return;
  const rows = db.getModerationCases(interaction.guild.id, userId, 25);
  if (!rows.length) return interaction.reply(v2Payload([{ type: 'text', value: text('No moderation cases found.') }], { ephemeral: true }));
  const body = rows.map(row => `**#${row.id}** • **${row.action}** • <@${row.target_id}> • <t:${Math.floor(row.created_at / 1000)}:R>\n${audit.replaceUserMentions(interaction.guild, row.reason || 'No reason provided')}`).join('\n\n');
  return interaction.reply(v2Payload([{ type: 'text', value: text(`## Moderation Cases\n\n${body}`) }], { ephemeral: true }));
}

async function setChannelLocked(interaction, channelId, locked, reason) {
  if (!requirePermission(interaction, locked ? 'lock' : 'unlock')) return;
  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.permissionOverwrites) return interaction.reply(v2Payload([{ type: 'text', value: text('That channel cannot be locked or unlocked by Oxy.') }], { ephemeral: true }));
  const everyoneId = interaction.guild.roles.everyone.id;
  try {
    if (locked) {
      const current = channel.permissionOverwrites.cache.get(everyoneId);
      const previous = current?.deny?.has(PermissionFlagsBits.SendMessages) ? 'deny' : current?.allow?.has(PermissionFlagsBits.SendMessages) ? 'allow' : 'neutral';
      db.setChannelLock(interaction.guild.id, channel.id, previous);
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason: reason || 'Channel locked by Oxy Controller' });
      await audit.log(interaction.guild, { action: 'Channel Lock', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Locked <#${channel.id}>${reason ? ` • ${reason}` : ''}` });
      return interaction.reply(v2Payload([{ type: 'text', value: text(`Locked <#${channel.id}>.`) }]));
    }

    const previous = db.getChannelLock(interaction.guild.id, channel.id)?.previous_send_messages || 'neutral';
    const value = previous === 'deny' ? false : previous === 'allow' ? true : null;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: value }, { reason: reason || 'Channel unlocked by Oxy Controller' });
    db.deleteChannelLock(interaction.guild.id, channel.id);
    await audit.log(interaction.guild, { action: 'Channel Unlock', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Unlocked <#${channel.id}>${reason ? ` • ${reason}` : ''}` });
    return interaction.reply(v2Payload([{ type: 'text', value: text(`Unlocked <#${channel.id}>.`) }]));
  } catch (error) {
    return interaction.reply(v2Payload([{ type: 'text', value: text(`I could not change the channel permissions. ${error.message || ''}`) }], { ephemeral: true }));
  }
}

async function setSlowmode(interaction, channelId, seconds, reason) {
  if (!requirePermission(interaction, 'slowmode')) return;
  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.setRateLimitPerUser !== 'function') return interaction.reply(v2Payload([{ type: 'text', value: text('That channel does not support slowmode.') }], { ephemeral: true }));
  const n = Number(seconds);
  if (!Number.isInteger(n) || n < 0 || n > 21600) return interaction.reply(v2Payload([{ type: 'text', value: text('Slowmode must be between `0` and `21600` seconds (6 hours).') }], { ephemeral: true }));
  try {
    await channel.setRateLimitPerUser(n, reason || `Slowmode changed by ${interaction.user.tag}`);
    await audit.log(interaction.guild, { action: 'Slowmode', actorId: interaction.user.id, actorTag: interaction.user.tag, details: `Set slowmode for <#${channel.id}> to ${n}s${reason ? ` • ${reason}` : ''}` });
    return interaction.reply(v2Payload([{ type: 'text', value: text(n === 0 ? `Disabled slowmode in <#${channel.id}>.` : `Set slowmode in <#${channel.id}> to **${n}s**.`) }]));
  } catch (error) {
    return interaction.reply(v2Payload([{ type: 'text', value: text(`I could not change slowmode. ${error.message || ''}`) }], { ephemeral: true }));
  }
}

module.exports = {
  getSettings, canManage, requirePermission, getMember, protectedMember,
  performUserAction, listWarnings, clearWarnings, addNote, showCase, listCases,
  setChannelLocked, setSlowmode, formatDuration
};
