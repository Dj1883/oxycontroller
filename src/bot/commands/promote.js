const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../db/database');
const { getStaffLevel, settings: rawSettings } = require('../../utils/permissions');
const { text, separator, v2Payload } = require('../../utils/components');

function profile(user) { return `[${user.username}](${user.displayAvatarURL ? `https://discord.com/users/${user.id}` : `https://discord.com/users/${user.id}`})`; }

const DEFAULT_STAFF = [
  { key: 'manager', name: 'Manager', level: 80, roleId: null },
  { key: 'administrator', name: 'Administrator', level: 60, roleId: null },
  { key: 'moderator', name: 'Moderator', level: 30, roleId: null },
  { key: 'support', name: 'Support', level: 10, roleId: null }
];

function config(guildId) {
  const raw = rawSettings(guildId);
  const staffHierarchy = Array.isArray(raw.staffHierarchy) && raw.staffHierarchy.length ? raw.staffHierarchy : DEFAULT_STAFF;
  return {
    staffHierarchy: staffHierarchy.filter(x => x && x.roleId).sort((a,b) => Number(b.level||0) - Number(a.level||0)),
    promotions: { enabled: true, logChannelId: null, replaceStaffRoles: true, ...(raw.promotions || {}) }
  };
}

function memberLevel(member, hierarchy) {
  let level = 0;
  let current = null;
  for (const rank of hierarchy) {
    if (member.roles.cache.has(rank.roleId) && Number(rank.level) > level) {
      level = Number(rank.level);
      current = rank;
    }
  }
  return { level, rank: current };
}

function actorCanAssign(interaction, targetLevel) {
  const actorLevel = getStaffLevel(interaction);
  const privileged = interaction.guild.ownerId === interaction.user.id || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
  return privileged || actorLevel > targetLevel;
}

async function logPromotion(interaction, cfg, action, target, fromRank, toRank, reason) {
  const channelId = cfg.promotions.logChannelId || null;
  const fallback = (() => { try { return JSON.parse(db.getGuildConfig(interaction.guild.id).settings_json || '{}')?.messages?.moderationLogChannelId || null; } catch { return null; } })();
  const id = channelId || fallback;
  const channel = id ? interaction.guild.channels.cache.get(id) : null;
  if (!channel?.isTextBased()) return;
  const direction = action === 'promote' ? '📈 Promotion' : '📉 Demotion';
  await channel.send(v2Payload([
    { type:'text', value:text(`## ${direction}\n\n**Member:** <@${target.id}>\n**Changed by:** <@${interaction.user.id}>\n**From:** ${fromRank ? `**${fromRank.name}** (Level ${fromRank.level})` : 'No staff rank'}\n**To:** ${toRank ? `**${toRank.name}** (Level ${toRank.level})` : 'No staff rank'}\n**Reason:** ${reason || 'No reason provided'}`) },
    { type:'separator', value:separator() }
  ])).catch(() => {});
}

async function run(interaction, action) {
  if (!interaction.guild) return interaction.reply(v2Payload([{type:'text',value:text('This command can only be used in a server.')}],{ephemeral:true}));
  const cfg = config(interaction.guild.id);
  if (!cfg.promotions.enabled) return interaction.reply(v2Payload([{type:'text',value:text('The promotion system is disabled for this server.')}],{ephemeral:true}));

  const target = interaction.options.getMember('user');
  const requestedRole = interaction.options.getRole('role');
  const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
  if (!target) return interaction.reply(v2Payload([{type:'text',value:text('I could not find that member in the server.')}],{ephemeral:true}));
  if (target.user.bot) return interaction.reply(v2Payload([{type:'text',value:text('Bots cannot be promoted or demoted through the staff hierarchy.')}],{ephemeral:true}));
  if (target.id === interaction.user.id) return interaction.reply(v2Payload([{type:'text',value:text('You cannot promote or demote yourself.')}],{ephemeral:true}));

  const before = memberLevel(target, cfg.staffHierarchy);
  const orderedAsc = [...cfg.staffHierarchy].sort((a,b) => Number(a.level)-Number(b.level));
  let destination = null;
  if (requestedRole) destination = cfg.staffHierarchy.find(x => x.roleId === requestedRole.id) || null;
  if (requestedRole && !destination) return interaction.reply(v2Payload([{type:'text',value:text('That Discord role is not configured as a staff rank in Oxy Settings.')}],{ephemeral:true}));

  if (action === 'promote') {
    if (destination && Number(destination.level) <= before.level) return interaction.reply(v2Payload([{type:'text',value:text('The selected rank is not higher than the member\'s current rank.')}],{ephemeral:true}));
    destination ||= orderedAsc.find(x => Number(x.level) > before.level && actorCanAssign(interaction, Number(x.level))) || null;
    if (!destination) return interaction.reply(v2Payload([{type:'text',value:text('There is no higher staff rank you are allowed to assign.')}],{ephemeral:true}));
    if (!actorCanAssign(interaction, Number(destination.level))) return interaction.reply(v2Payload([{type:'text',value:text('You cannot promote someone to a rank at or above your own authority.')}],{ephemeral:true}));
  } else {
    if (destination && Number(destination.level) >= before.level) return interaction.reply(v2Payload([{type:'text',value:text('The selected rank is not lower than the member\'s current rank.')}],{ephemeral:true}));
    destination ||= [...orderedAsc].reverse().find(x => Number(x.level) < before.level) || null;
    if (destination && !actorCanAssign(interaction, Number(before.level))) return interaction.reply(v2Payload([{type:'text',value:text('You do not have enough authority to demote this member.')}],{ephemeral:true}));
  }

  if (destination) {
    const role = interaction.guild.roles.cache.get(destination.roleId);
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    if (!role) return interaction.reply(v2Payload([{type:'text',value:text('The configured staff role no longer exists. Update the Staff Hierarchy settings.')}],{ephemeral:true}));
    if (me.roles.highest.position <= role.position) return interaction.reply(v2Payload([{type:'text',value:text(`I cannot manage **${role.name}** because my highest Discord role is not above it.`)}],{ephemeral:true}));
  }

  const managedRoles = cfg.staffHierarchy.map(x => interaction.guild.roles.cache.get(x.roleId)).filter(Boolean).filter(r => target.roles.cache.has(r.id));
  if (cfg.promotions.replaceStaffRoles) {
    for (const role of managedRoles) {
      if (destination && role.id === destination.roleId) continue;
      if (role.position < (interaction.guild.members.me?.roles.highest.position || 0)) await target.roles.remove(role).catch(() => {});
    }
  }
  if (destination) await target.roles.add(destination.roleId);

  await logPromotion(interaction, cfg, action, target, before.rank, destination, reason);

  return interaction.reply(v2Payload([{type:'text',value:text(`✅ **${target.user.tag}** has been **${action === 'promote' ? 'promoted' : 'demoted'}**${destination ? ` to **${destination.name}** (Level ${destination.level})` : ' and no longer has a staff rank'}.`)}],{ephemeral:true}));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a member through the configured Oxy staff hierarchy')
    .addUserOption(o=>o.setName('user').setDescription('Member to promote').setRequired(true))
    .addRoleOption(o=>o.setName('role').setDescription('Optional specific staff rank to assign').setRequired(false))
    .addStringOption(o=>o.setName('reason').setDescription('Reason for the promotion').setRequired(false).setMaxLength(500)),
  async execute(i) { return run(i, 'promote'); }
};
