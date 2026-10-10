const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../db/database');
const { getStaffLevel, settings: rawSettings } = require('../../utils/permissions');
const { text, separator, v2Payload } = require('../../utils/components');

function profile(user) { return `[${user.username}](https://discord.com/users/${user.id})`; }

const DEFAULT_STAFF = [
  { key: 'manager', name: 'Manager', level: 80, roleId: null },
  { key: 'administrator', name: 'Administrator', level: 60, roleId: null },
  { key: 'moderator', name: 'Moderator', level: 30, roleId: null },
  { key: 'support', name: 'Support', level: 10, roleId: null }
];

function cfg(guildId) {
  const raw = rawSettings(guildId);
  const staff = Array.isArray(raw.staffHierarchy) && raw.staffHierarchy.length ? raw.staffHierarchy : DEFAULT_STAFF;
  return {
    staffHierarchy: staff.filter(x => x && x.roleId).sort((a,b) => Number(b.level || 0) - Number(a.level || 0)),
    promotions: { enabled: true, logChannelId: null, replaceStaffRoles: true, ...(raw.promotions || {}) }
  };
}

function level(member, hierarchy) {
  let level = 0;
  let rank = null;
  for (const x of hierarchy) {
    if (member.roles.cache.has(x.roleId) && Number(x.level) > level) {
      level = Number(x.level);
      rank = x;
    }
  }
  return { level, rank };
}

function can(i, targetLevel) {
  const actor = getStaffLevel(i);
  const privileged = i.guild.ownerId === i.user.id || Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
  return privileged || actor > targetLevel;
}

async function log(i, cfgx, target, from, to, reason) {
  let id = cfgx.promotions.logChannelId || null;
  if (!id) {
    try { id = JSON.parse(db.getGuildConfig(i.guild.id).settings_json || '{}')?.messages?.moderationLogChannelId || null; } catch {}
  }
  const ch = id ? i.guild.channels.cache.get(id) : null;
  if (!ch?.isTextBased()) return;
  await ch.send(v2Payload([
    { type:'text', value:text(`## 📉 Demotion\n\n**Member:** <@${target.id}>\n**Changed by:** <@${i.user.id}>\n**From:** ${from ? `**${from.name}** (Level ${from.level})` : 'No staff rank'}\n**To:** ${to ? `**${to.name}** (Level ${to.level})` : 'No staff rank'}\n**Reason:** ${reason}`) },
    { type:'separator', value:separator() }
  ])).catch(() => {});
}

async function run(i) {
  if (!i.guild) return i.reply(v2Payload([{type:'text',value:text('This command can only be used in a server.')}],{ephemeral:true}));
  const c = cfg(i.guild.id);
  if (!c.promotions.enabled) return i.reply(v2Payload([{type:'text',value:text('The promotion system is disabled for this server.')}],{ephemeral:true}));
  const t = i.options.getMember('user');
  if (!t) return i.reply(v2Payload([{type:'text',value:text('I could not find that member in the server.')}],{ephemeral:true}));
  if (t.user.bot || t.id === i.user.id) return i.reply(v2Payload([{type:'text',value:text('That member cannot be demoted by this command.')}],{ephemeral:true}));

  const reason = i.options.getString('reason')?.trim() || 'No reason provided';
  const before = level(t, c.staffHierarchy);
  if (!before.rank) return i.reply(v2Payload([{type:'text',value:text('That member does not currently have a configured staff rank.')}],{ephemeral:true}));
  if (!can(i, before.level)) return i.reply(v2Payload([{type:'text',value:text('You cannot demote someone at or above your own authority.')}],{ephemeral:true}));

  const targetRole = i.options.getRole('role');
  let dest = targetRole ? c.staffHierarchy.find(x => x.roleId === targetRole.id) : null;
  if (targetRole && !dest) return i.reply(v2Payload([{type:'text',value:text('That Discord role is not configured as a staff rank in Oxy Settings.')}],{ephemeral:true}));

  const asc = [...c.staffHierarchy].sort((a,b) => Number(a.level) - Number(b.level));
  if (!dest) dest = [...asc].reverse().find(x => Number(x.level) < before.level) || null;
  if (dest && !can(i, Number(dest.level))) return i.reply(v2Payload([{type:'text',value:text('You cannot assign that lower rank because of your own hierarchy position.')}],{ephemeral:true}));

  const me = i.guild.members.me || await i.guild.members.fetchMe();
  if (dest) {
    const role = i.guild.roles.cache.get(dest.roleId);
    if (!role || me.roles.highest.position <= role.position) return i.reply(v2Payload([{type:'text',value:text('I cannot manage the selected staff role because my highest Discord role is not above it.')}],{ephemeral:true}));
  }

  if (c.promotions.replaceStaffRoles) {
    for (const x of c.staffHierarchy.map(r => i.guild.roles.cache.get(r.roleId)).filter(Boolean)) {
      if (dest && x.id === dest.roleId) continue;
      if (me.roles.highest.position > x.position) await t.roles.remove(x).catch(() => {});
    }
  }
  if (dest) await t.roles.add(dest.roleId);

  await log(i, c, t, before.rank, dest, reason);
  return i.reply(v2Payload([{type:'text',value:text(`✅ **${t.user.tag}** has been **demoted**${dest ? ` to **${dest.name}** (Level ${dest.level})` : ' and no longer has a staff rank'}.`)}],{ephemeral:true}));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a member through the configured Oxy staff hierarchy')
    .addUserOption(o=>o.setName('user').setDescription('Member to demote').setRequired(true))
    .addRoleOption(o=>o.setName('role').setDescription('Optional specific lower staff rank').setRequired(false))
    .addStringOption(o=>o.setName('reason').setDescription('Reason for the demotion').setRequired(false).setMaxLength(500)),
  async execute(i){ return run(i); }
};
