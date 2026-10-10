const {
  SlashCommandBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const db = require('../../db/database');
const { isGuildAdmin } = require('../../utils/permissions');
const {
  text,
  separator,
  row,
  button,
  select,
  roleSelect,
  channelSelect,
  v2Payload
} = require('../../utils/components');

const DEFAULTS = {
  enabled: true,
  title: 'Choose your roles',
  description: 'Select the roles that apply to you. Click a role again to remove it.',
  channelId: null,
  messageId: null,
  roles: []
};

const pendingAdds = new Map();

function get(guildId) {
  const cfg = db.getGuildConfig(guildId);
  let settings = {};
  try { settings = JSON.parse(cfg.settings_json || '{}'); } catch {}
  const reactionRoles = { ...DEFAULTS, ...(settings.reactionRoles || {}) };
  reactionRoles.roles = Array.isArray(reactionRoles.roles) ? reactionRoles.roles.slice(0, 25) : [];
  return { settings, reactionRoles };
}

function save(guildId, settings) {
  db.setGuildConfig(guildId, { settings_json: JSON.stringify(settings) });
}

function canManage(i) {
  return Boolean(i.guild && (i.guild.ownerId === i.user.id || isGuildAdmin(i)));
}

function managementPanel(i, notice = '') {
  const { reactionRoles } = get(i.guild.id);
  const channel = reactionRoles.channelId ? `<#${reactionRoles.channelId}>` : 'Not configured';
  const roles = reactionRoles.roles.length
    ? reactionRoles.roles.map((r, n) => `${n + 1}. ${r.emoji ? `${r.emoji} ` : ''}**${r.label}** → <@&${r.roleId}>`).join('\n')
    : 'No roles configured';

  return v2Payload([
    { type: 'text', value: `## 🎭 Reaction Roles\n\n${notice ? `${notice}\n\n` : ''}**Status:** ${reactionRoles.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n**Panel channel:** ${channel}\n**Roles:** ${reactionRoles.roles.length}/25\n\n### Configured Roles\n${roles}` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([
      button('reactionroles:add', 'Add Role', ButtonStyle.Primary, reactionRoles.roles.length >= 25),
      button('reactionroles:remove', 'Remove Role', ButtonStyle.Danger, !reactionRoles.roles.length),
      button('reactionroles:edit', 'Edit Panel', ButtonStyle.Secondary)
    ]) },
    { type: 'row', value: row([
      button('reactionroles:channel', 'Panel Channel', ButtonStyle.Secondary),
      button('reactionroles:publish', 'Publish Panel', ButtonStyle.Success),
      button('reactionroles:toggle', reactionRoles.enabled ? 'Disable' : 'Enable', reactionRoles.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    ]) },
    { type: 'row', value: row([button('reactionroles:refresh', 'Refresh', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

function panelEdit(i) {
  const { reactionRoles } = get(i.guild.id);
  return v2Payload([
    { type: 'text', value: `## 🎭 Reaction Role Panel\n\n**Title:** ${reactionRoles.title}\n**Description:** ${reactionRoles.description}` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([button('reactionroles:edit:title', 'Change Title'), button('reactionroles:edit:description', 'Change Description')]) },
    { type: 'row', value: row([button('reactionroles:back', 'Back')]) }
  ], { ephemeral: true });
}

function publicPanel(guildId) {
  const { reactionRoles } = get(guildId);
  const rows = [];
  for (let i = 0; i < reactionRoles.roles.length; i += 5) {
    rows.push({
      type: 'row',
      value: row(reactionRoles.roles.slice(i, i + 5).map(r =>
        button(`reactionroles:toggle:${r.roleId}`, `${r.emoji ? `${r.emoji} ` : ''}${r.label}`.slice(0, 80), ButtonStyle.Secondary)
      ))
    });
  }
  return v2Payload([
    { type: 'text', value: `## 🎭 ${reactionRoles.title}\n\n${reactionRoles.description}` },
    { type: 'separator', value: separator() },
    ...(rows.length ? rows : [{ type: 'text', value: 'No roles have been configured yet.' }])
  ]);
}

function addRoleModal(guildId, roleId) {
  const modal = new ModalBuilder().setCustomId('reactionroles:add:modal').setTitle('Add Reaction Role');
  const label = new TextInputBuilder().setCustomId('role_label').setLabel('Button label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  const emoji = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32);
  const description = new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
  modal.addLabelComponents(
    new LabelBuilder().setLabel('Role').setDescription(`Selected role: <@&${roleId}>`).setTextInputComponent(new TextInputBuilder().setCustomId('role_id_display').setLabel('Role').setValue(`<@&${roleId}>`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new LabelBuilder().setLabel('Button label').setDescription('What users will see on the role button.').setTextInputComponent(label),
    new LabelBuilder().setLabel('Emoji').setDescription('Optional emoji shown before the label.').setTextInputComponent(emoji),
    new LabelBuilder().setLabel('Description').setDescription('Optional description stored with the role.').setTextInputComponent(description)
  );
  return modal;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Configure a Components V2 reaction role panel'),

  async execute(i) {
    if (!i.guild) return i.reply(v2Payload([{ type: 'text', value: text('This command can only be used in a server.') }], { ephemeral: true }));
    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You need server management access to configure reaction roles.') }], { ephemeral: true }));
    return i.reply(managementPanel(i));
  },

  async handleButton(i) {
    if (!i.customId.startsWith('reactionroles:')) return false;

    const parts = i.customId.split(':');
    const action = parts[1];

    if (action === 'toggle' && parts[2]) {
      if (!i.guild) return i.reply(v2Payload([{ type: 'text', value: text('This can only be used in a server.') }], { ephemeral: true }));
      const { reactionRoles } = get(i.guild.id);
      if (!reactionRoles.enabled) return i.reply(v2Payload([{ type: 'text', value: text('Reaction roles are currently disabled.') }], { ephemeral: true }));
      const item = reactionRoles.roles.find(r => r.roleId === parts[2]);
      const role = i.guild.roles.cache.get(parts[2]);
      if (!item || !role) return i.reply(v2Payload([{ type: 'text', value: text('That reaction role is no longer available.') }], { ephemeral: true }));
      const me = i.guild.members.me;
      if (!me?.permissions.has('ManageRoles') || role.position >= me.roles.highest.position) {
        return i.reply(v2Payload([{ type: 'text', value: text(`I cannot manage **${role.name}**. Move the role below my highest role and give me Manage Roles.`) }], { ephemeral: true }));
      }
      const member = await i.guild.members.fetch(i.user.id);
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role, 'Oxy reaction role toggle');
        return i.reply(v2Payload([{ type: 'text', value: text(`Removed <@&${role.id}> from you.`) }], { ephemeral: true }));
      }
      await member.roles.add(role, 'Oxy reaction role toggle');
      return i.reply(v2Payload([{ type: 'text', value: text(`Added <@&${role.id}> to you.`) }], { ephemeral: true }));
    }

    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to configure reaction roles.') }], { ephemeral: true }));

    const { settings, reactionRoles } = get(i.guild.id);

    if (action === 'add') return i.reply(v2Payload([
      { type: 'text', value: text('Select the Discord role you want to add to the reaction role panel.') },
      { type: 'row', value: row([roleSelect('reactionroles:add:role', 'Select a role')]) }
    ], { ephemeral: true }));
    if (action === 'remove') {
      return i.reply(v2Payload([
        { type: 'text', value: text('Select the reaction role entry to remove.') },
        { type: 'row', value: row([select('reactionroles:remove:select', 'Select a role', reactionRoles.roles.map(r => ({ label: `${r.emoji ? `${r.emoji} ` : ''}${r.label}`.slice(0, 100), value: r.roleId })))]) },
        { type: 'row', value: row([button('reactionroles:back', 'Cancel')]) }
      ], { ephemeral: true }));
    }
    if (action === 'edit' && parts[2] === 'title') {
      const modal = new ModalBuilder().setCustomId('reactionroles:edit:title:modal').setTitle('Edit Panel Title');
      const input = new TextInputBuilder().setCustomId('title').setLabel('Panel title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(reactionRoles.title);
      modal.addLabelComponents(new LabelBuilder().setLabel('Title').setTextInputComponent(input));
      return i.showModal(modal);
    }
    if (action === 'edit' && parts[2] === 'description') {
      const modal = new ModalBuilder().setCustomId('reactionroles:edit:description:modal').setTitle('Edit Panel Description');
      const input = new TextInputBuilder().setCustomId('description').setLabel('Panel description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(reactionRoles.description);
      modal.addLabelComponents(new LabelBuilder().setLabel('Description').setTextInputComponent(input));
      return i.showModal(modal);
    }
    if (action === 'edit') return i.update(panelEdit(i));
    if (action === 'back') return i.update(managementPanel(i));
    if (action === 'refresh') return i.update(managementPanel(i));
    if (action === 'toggle') {
      reactionRoles.enabled = !reactionRoles.enabled;
      settings.reactionRoles = reactionRoles;
      save(i.guild.id, settings);
      return i.update(managementPanel(i, `✅ Reaction roles ${reactionRoles.enabled ? 'enabled' : 'disabled'}.`));
    }
    if (action === 'channel' || action === 'publish') {
      return i.reply(v2Payload([{ type: 'text', value: text(action === 'publish' ? 'Select the channel where the reaction role panel should be published.' : 'Select the channel for the reaction role panel.') }, { type: 'row', value: row([channelSelect(`reactionroles:${action}:channel`, 'Select panel channel', [ChannelType.GuildText, ChannelType.GuildAnnouncement])]) }], { ephemeral: true }));
    }
        return false;
  },

  async handleRole(i) {
    if (!i.customId.startsWith('reactionroles:add:role')) return false;
    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to configure reaction roles.') }], { ephemeral: true }));
    const roleId = i.values[0];
    const role = i.guild.roles.cache.get(roleId);
    if (!role || role.managed) return i.reply(v2Payload([{ type: 'text', value: text('Choose a normal server role, not a managed/integration role.') }], { ephemeral: true }));
    const { reactionRoles } = get(i.guild.id);
    if (reactionRoles.roles.some(r => r.roleId === roleId)) return i.reply(v2Payload([{ type: 'text', value: text('That role is already configured.') }], { ephemeral: true }));
    pendingAdds.set(i.user.id, { guildId: i.guild.id, roleId });
    return i.showModal(addRoleModal(i.guild.id, roleId));
  },

  async handleSelect(i) {
    if (!i.customId.startsWith('reactionroles:remove:select')) return false;
    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to configure reaction roles.') }], { ephemeral: true }));
    const roleId = i.values[0];
    const { settings, reactionRoles } = get(i.guild.id);
    reactionRoles.roles = reactionRoles.roles.filter(r => r.roleId !== roleId);
    settings.reactionRoles = reactionRoles;
    save(i.guild.id, settings);
    return i.update(managementPanel(i, `✅ Removed <@&${roleId}> from the reaction role panel.`));
  },

  async handleChannel(i) {
    if (!i.customId.startsWith('reactionroles:')) return false;
    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to configure reaction roles.') }], { ephemeral: true }));
    const parts = i.customId.split(':');
    const mode = parts[1];
    const channelId = i.values[0];
    const channel = i.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return i.reply(v2Payload([{ type: 'text', value: text('That is not a usable text channel.') }], { ephemeral: true }));
    const { settings, reactionRoles } = get(i.guild.id);
    reactionRoles.channelId = channelId;
    settings.reactionRoles = reactionRoles;
    save(i.guild.id, settings);
    if (mode === 'publish') {
      let message = null;
      if (reactionRoles.messageId && reactionRoles.channelId === channelId) {
        message = await channel.messages.fetch(reactionRoles.messageId).catch(() => null);
      }
      if (message) await message.edit(publicPanel(i.guild.id));
      else {
        message = await channel.send(publicPanel(i.guild.id));
        reactionRoles.messageId = message.id;
        save(i.guild.id, settings);
      }
      return i.update(managementPanel(i, `✅ Reaction role panel published in <#${channelId}>.`));
    }
    return i.update(managementPanel(i, `✅ Reaction role panel channel set to <#${channelId}>.`));
  },

  async handleModal(i) {
    if (!i.customId.startsWith('reactionroles:')) return false;
    if (!canManage(i)) return i.reply(v2Payload([{ type: 'text', value: text('You are not authorised to configure reaction roles.') }], { ephemeral: true }));
    const { settings, reactionRoles } = get(i.guild.id);

    if (i.customId === 'reactionroles:add:modal') {
      const pending = pendingAdds.get(i.user.id);
      pendingAdds.delete(i.user.id);
      if (!pending || pending.guildId !== i.guild.id) return i.reply(v2Payload([{ type: 'text', value: text('That role setup expired. Please start again.') }], { ephemeral: true }));
      const role = i.guild.roles.cache.get(pending.roleId);
      if (!role) return i.reply(v2Payload([{ type: 'text', value: text('That role no longer exists.') }], { ephemeral: true }));
      reactionRoles.roles.push({
        roleId: role.id,
        label: i.fields.getTextInputValue('role_label').trim(),
        emoji: i.fields.getTextInputValue('emoji').trim() || null,
        description: i.fields.getTextInputValue('description').trim() || null
      });
      settings.reactionRoles = reactionRoles;
      save(i.guild.id, settings);
      return i.reply(managementPanel(i, `✅ Added <@&${role.id}> to the reaction role panel.`));
    }

    if (i.customId === 'reactionroles:edit:title:modal') {
      reactionRoles.title = i.fields.getTextInputValue('title').trim();
      settings.reactionRoles = reactionRoles;
      save(i.guild.id, settings);
      return i.reply(managementPanel(i, '✅ Panel title updated.'));
    }

    if (i.customId === 'reactionroles:edit:description:modal') {
      reactionRoles.description = i.fields.getTextInputValue('description').trim();
      settings.reactionRoles = reactionRoles;
      save(i.guild.id, settings);
      return i.reply(managementPanel(i, '✅ Panel description updated.'));
    }

    return false;
  }
};
