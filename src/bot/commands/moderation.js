const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../db/database');
const { v2Payload, text } = require('../../utils/components');
const { buildModal, input, parseChannelId, parseRoleId } = require('../../services/moderationForms');

function isManager(interaction) {
  return interaction.guild?.ownerId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Configure Oxy moderation')
    .addSubcommand(s => s.setName('setlog').setDescription('Configure the moderation log channel'))
    .addSubcommand(s => s.setName('setrole').setDescription('Configure the required role for a moderation action'))
    .addSubcommand(s => s.setName('logstatus').setDescription('View moderation log settings'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(i) {
    const sub = i.options.getSubcommand();
    if (!isManager(i)) return i.reply(v2Payload([{ type: 'text', value: text('Only the server owner or a member with Manage Server can configure moderation.') }], { ephemeral: true }));

    if (sub === 'setlog') {
      return i.showModal(buildModal('moderation:setlog', 'Moderation Log', [
        { id: 'channel', label: 'Channel ID or mention', placeholder: '123456789012345678 or #mod-logs', maxLength: 32 }
      ]));
    }

    if (sub === 'setrole') {
      return i.showModal(buildModal('moderation:setrole', 'Moderation Role', [
        { id: 'action', label: 'Action', placeholder: 'warn, timeout, kick, ban, unban, softban', maxLength: 32 },
        { id: 'role', label: 'Role ID or mention', placeholder: '123456789012345678 or @Moderators', maxLength: 32 }
      ]));
    }

    const cfg = db.getGuildConfig(i.guild.id);
    const settings = JSON.parse(cfg.settings_json || '{}');
    const m = settings.moderation || {};
    return i.reply(v2Payload([{ type: 'text', value: text(
      `## Moderation Logs\n\n**Enabled:** ${m.logging !== false && !!m.logChannelId ? 'Yes' : 'No'}\n**Channel:** ${m.logChannelId ? `<#${m.logChannelId}>` : 'Not configured'}\n**Format:** Components V2`
    ) }], { ephemeral: true }));
  },

  async handleModal(i) {
    if (!i.customId.startsWith('moderation:')) return false;
    if (!isManager(i)) return i.reply(v2Payload([{ type: 'text', value: text('Only the server owner or a member with Manage Server can configure moderation.') }], { ephemeral: true }));

    const cfg = db.getGuildConfig(i.guild.id);
    const settings = JSON.parse(cfg.settings_json || '{}');
    settings.moderation = settings.moderation || {};
    settings.moderation.roles = settings.moderation.roles || {};

    if (i.customId === 'moderation:setlog') {
      const channelId = parseChannelId(input(i, 'channel'));
      const channel = channelId ? (i.guild.channels.cache.get(channelId) || await i.guild.channels.fetch(channelId).catch(() => null)) : null;
      if (!channel?.isTextBased?.()) return i.reply(v2Payload([{ type: 'text', value: text('Enter a valid text or announcement channel ID/mention.') }], { ephemeral: true }));
      settings.moderation.logChannelId = channel.id;
      settings.moderation.logging = true;
      db.setGuildConfig(i.guild.id, { settings_json: JSON.stringify(settings) });
      return i.reply(v2Payload([{ type: 'text', value: text(`Moderation logs will now be sent to <#${channel.id}>.`) }], { ephemeral: true }));
    }

    if (i.customId === 'moderation:setrole') {
      const action = input(i, 'action').toLowerCase();
      const roleId = parseRoleId(input(i, 'role'));
      if (!['warn', 'timeout', 'kick', 'ban', 'unban', 'softban'].includes(action)) return i.reply(v2Payload([{ type: 'text', value: text('Invalid action. Use warn, timeout, kick, ban, unban, or softban.') }], { ephemeral: true }));
      if (!roleId) return i.reply(v2Payload([{ type: 'text', value: text('Enter a valid role ID or role mention.') }], { ephemeral: true }));
      const role = i.guild.roles.cache.get(roleId);
      if (!role) return i.reply(v2Payload([{ type: 'text', value: text('That role could not be found in this server.') }], { ephemeral: true }));
      settings.moderation.roles[action] = role.id;
      db.setGuildConfig(i.guild.id, { settings_json: JSON.stringify(settings) });
      return i.reply(v2Payload([{ type: 'text', value: text(`**${action}** now requires <@&${role.id}>.`) }], { ephemeral: true }));
    }

    return false;
  }
};
