const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../db/database');
const { getStaffLevel, settings: rawSettings } = require('../../utils/permissions');
const { text, separator, v2Payload } = require('../../utils/components');
const { duration } = require('../../utils/format');
const shifts = require('../../services/shifts');

const DEFAULT_STAFF = [
  { key: 'manager', name: 'Manager', level: 80, roleId: null },
  { key: 'administrator', name: 'Administrator', level: 60, roleId: null },
  { key: 'moderator', name: 'Moderator', level: 30, roleId: null },
  { key: 'support', name: 'Support', level: 10, roleId: null }
];

function config(guildId) {
  const raw = rawSettings(guildId);
  const hierarchy = Array.isArray(raw.staffHierarchy) && raw.staffHierarchy.length ? raw.staffHierarchy : DEFAULT_STAFF;
  return hierarchy.filter(x => x && x.roleId).sort((a, b) => Number(b.level || 0) - Number(a.level || 0));
}

function memberLevel(member, hierarchy) {
  let level = 0;
  let rank = null;
  for (const item of hierarchy) {
    if (member.roles.cache.has(item.roleId) && Number(item.level || 0) > level) {
      level = Number(item.level || 0);
      rank = item;
    }
  }
  return { level, rank };
}

function canManage(interaction, targetLevel = 0) {
  const actorLevel = getStaffLevel(interaction);
  const privileged = interaction.guild.ownerId === interaction.user.id || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
  return privileged || actorLevel > Number(targetLevel || 0);
}

function parseDuration(value) {
  if (!value) return null;
  const input = String(value).trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(input)) return Number(input) * 60;
  let total = 0;
  const matches = [...input.matchAll(/(\d+(?:\.\d+)?)(w|d|h|m|s)/g)];
  if (!matches.length || matches.map(m => m[0]).join('') !== input) return null;
  for (const [, n, unit] of matches) {
    const multipliers = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
    total += Number(n) * multipliers[unit];
  }
  return Math.round(total);
}

function formatSigned(seconds) {
  return `${seconds >= 0 ? '+' : '-'}${duration(Math.abs(seconds))}`;
}

function staffSummary(interaction, target, hierarchy) {
  const rank = memberLevel(target, hierarchy);
  const stats = db.getStaffShiftStats(interaction.guild.id, target.id);
  const active = db.getActiveShift(interaction.guild.id, target.id);
  const account = db.getAccount(target.id);
  const roleText = rank.rank ? `**${rank.rank.name}** (Level ${rank.rank.level})` : 'No configured staff rank';
  const activeText = active
    ? `Active · elapsed **${duration(Math.max(0, Math.floor((Date.now() - active.started_at) / 1000)))}** · verified **${duration(active.verified_seconds)}**`
    : 'No active shift';

  return [
    `## Staff management · ${target.user.username}`,
    '',
    `**Member:** [${target.user.username}](https://discord.com/users/${target.id})`,
    `**Staff rank:** ${roleText}`,
    `**Discord roles:** ${Math.max(0, target.roles.cache.size - 1)}`,
    `**Roblox:** ${account?.roblox_username ? account.roblox_username : 'Not linked'}`,
    '',
    `**Total verified time:** ${duration(stats.verifiedSeconds)}`,
    `**Manual adjustment:** ${formatSigned(stats.adjustmentSeconds)}`,
    `**Tracked staff time:** ${duration(stats.totalSeconds)}`,
    `**Completed shifts:** ${stats.completedShifts}`,
    `**Active shift:** ${activeText}`,
    `**Last shift:** ${stats.lastShiftAt ? `<t:${Math.floor(stats.lastShiftAt / 1000)}:R>` : 'None'}`
  ].join('\n');
}

async function sendLog(interaction, message) {
  let id = null;
  try {
    const settings = JSON.parse(db.getGuildConfig(interaction.guild.id).settings_json || '{}');
    id = settings?.promotions?.logChannelId || settings?.messages?.moderationLogChannelId || null;
  } catch {}
  const channel = id ? interaction.guild.channels.cache.get(id) : null;
  if (!channel?.isTextBased()) return;
  await channel.send(v2Payload([
    { type: 'text', value: text(message) },
    { type: 'separator', value: separator() }
  ])).catch(() => {});
}

async function run(interaction) {
  if (!interaction.guild) return interaction.reply(v2Payload([{ type: 'text', value: text('This command can only be used in a server.') }], { ephemeral: true }));

  const target = interaction.options.getMember('user');
  if (!target) return interaction.reply(v2Payload([{ type: 'text', value: text('I could not find that member in the server.') }], { ephemeral: true }));
  if (target.user.bot) return interaction.reply(v2Payload([{ type: 'text', value: text('Bots cannot be managed as staff.') }], { ephemeral: true }));

  const hierarchy = config(interaction.guild.id);
  const before = memberLevel(target, hierarchy);

  const action = interaction.options.getString('action');
  const requestedRole = interaction.options.getRole('role');
  const timeInput = interaction.options.getString('time');
  const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';

  if (action === 'view') {
    return interaction.reply(v2Payload([{ type: 'text', value: text(staffSummary(interaction, target, hierarchy)) }], { ephemeral: true }));
  }

  if (!canManage(interaction, before.level)) {
    return interaction.reply(v2Payload([{ type: 'text', value: text('You do not have enough authority to change this staff member.') }], { ephemeral: true }));
  }

  if (action === 'set-role') {
    if (!requestedRole) return interaction.reply(v2Payload([{ type: 'text', value: text('Select the staff role you want to assign.') }], { ephemeral: true }));
    const destination = hierarchy.find(x => x.roleId === requestedRole.id);
    if (!destination) return interaction.reply(v2Payload([{ type: 'text', value: text('That role is not configured as a staff rank in Oxy Settings.') }], { ephemeral: true }));
    if (!canManage(interaction, Number(destination.level))) return interaction.reply(v2Payload([{ type: 'text', value: text('You cannot assign a staff rank at or above your own authority.') }], { ephemeral: true }));

    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    if (me.roles.highest.position <= requestedRole.position) return interaction.reply(v2Payload([{ type: 'text', value: text('I cannot manage that Discord role because my highest role is not above it.') }], { ephemeral: true }));

    for (const item of hierarchy) {
      if (item.roleId !== requestedRole.id) {
        const role = interaction.guild.roles.cache.get(item.roleId);
        if (role && me.roles.highest.position > role.position) await target.roles.remove(role).catch(() => {});
      }
    }
    await target.roles.add(requestedRole).catch(() => {});
    await sendLog(interaction, `## Staff role changed\n\n**Member:** <@${target.id}>\n**Changed by:** <@${interaction.user.id}>\n**From:** ${before.rank ? `**${before.rank.name}** (Level ${before.rank.level})` : 'No staff rank'}\n**To:** **${destination.name}** (Level ${destination.level})\n**Reason:** ${reason}`);
    return interaction.reply(v2Payload([{ type: 'text', value: text(`✅ **${target.user.tag}** is now **${destination.name}** (Level ${destination.level}).`) }], { ephemeral: true }));
  }

  if (action === 'add-time' || action === 'remove-time' || action === 'set-time') {
    const seconds = parseDuration(timeInput);
    if (!seconds || seconds < 0) return interaction.reply(v2Payload([{ type: 'text', value: text('Enter a valid time such as `2h`, `30m`, `1h30m`, or `90s`.') }], { ephemeral: true }));
    const stats = db.getStaffShiftStats(interaction.guild.id, target.id);
    let adjustment;
    if (action === 'add-time') adjustment = seconds;
    else if (action === 'remove-time') adjustment = -seconds;
    else adjustment = seconds - stats.totalSeconds;
    db.adjustStaffTime(interaction.guild.id, target.id, adjustment, interaction.user.id, reason);
    const updated = db.getStaffShiftStats(interaction.guild.id, target.id);
    await sendLog(interaction, `## Staff time adjusted\n\n**Member:** <@${target.id}>\n**Changed by:** <@${interaction.user.id}>\n**Adjustment:** ${formatSigned(adjustment)}\n**Tracked staff time:** **${duration(updated.totalSeconds)}**\n**Reason:** ${reason}`);
    return interaction.reply(v2Payload([{ type: 'text', value: text(`✅ Staff time updated for **${target.user.tag}**.\n\n**Adjustment:** ${formatSigned(adjustment)}\n**Tracked staff time:** **${duration(updated.totalSeconds)}**`) }], { ephemeral: true }));
  }

  if (action === 'end-shift') {
    const active = db.getActiveShift(interaction.guild.id, target.id);
    if (!active) return interaction.reply(v2Payload([{ type: 'text', value: text('That member does not have an active shift.') }], { ephemeral: true }));
    const ended = shifts.end(interaction.guild.id, target.id, 'staff_management');
    await sendLog(interaction, `## Staff shift ended manually\n\n**Member:** <@${target.id}>\n**Ended by:** <@${interaction.user.id}>\n**Verified time:** ${duration(ended?.verified_seconds || 0)}\n**Reason:** ${reason}`);
    return interaction.reply(v2Payload([{ type: 'text', value: text(`✅ Ended **${target.user.tag}**'s active shift.\n\n**Verified time:** ${duration(ended?.verified_seconds || 0)}`) }], { ephemeral: true }));
  }

  return interaction.reply(v2Payload([{ type: 'text', value: text('That staff management action is not supported.') }], { ephemeral: true }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manage-staff')
    .setDescription('Manage a staff member, their rank and shift time')
    .addUserOption(o => o.setName('user').setDescription('Staff member to manage').setRequired(true))
    .addStringOption(o => o.setName('action').setDescription('Management action').setRequired(true).addChoices(
      { name: 'View staff profile', value: 'view' },
      { name: 'Set staff role', value: 'set-role' },
      { name: 'Add shift time', value: 'add-time' },
      { name: 'Remove shift time', value: 'remove-time' },
      { name: 'Set total staff time', value: 'set-time' },
      { name: 'End active shift', value: 'end-shift' }
    ))
    .addRoleOption(o => o.setName('role').setDescription('Configured staff role (used with Set staff role)').setRequired(false))
    .addStringOption(o => o.setName('time').setDescription('Time such as 2h, 30m, 1h30m or 90s').setRequired(false).setMaxLength(30))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the change').setRequired(false).setMaxLength(500)),
  async execute(i) { return run(i); }
};
