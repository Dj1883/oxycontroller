const { PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseUserId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const { v2Payload, text } = require('../../utils/components');
const command = makeModalCommand({
  name: 'warnings', description: 'View a member\'s active warnings', modalId: 'warnings:modal', title: 'View Warnings',
  fields: [{ id: 'user', label: 'User ID or mention', placeholder: '123456789012345678', maxLength: 32 }],
  async executeModal(i) {
    if (!core.requirePermission(i, 'warnings')) return;
    const userId = parseUserId(input(i, 'user'));
    if (!userId) return i.reply({ content: 'Enter a valid Discord user ID or mention.', flags: 64 });
    const user = await i.client.users.fetch(userId).catch(() => null);
    if (!user) return i.reply({ content: 'I could not find that user.', flags: 64 });
    const rows = core.listWarnings(i.guild.id, userId);
    if (!rows.length) return i.reply(v2Payload([{ type: 'text', value: text(`<@${userId}> has no active warnings.`) }], { ephemeral: true }));
    const body = rows.map(row => `**#${row.id}** • <t:${Math.floor(row.created_at / 1000)}:F>\n${row.reason || 'No reason provided'}`).join('\n\n');
    return i.reply(v2Payload([{ type: 'text', value: text(`## Active Warnings\n\n**User:** <@${userId}>\n**Count:** ${rows.length}\n\n${body}`) }], { ephemeral: true }));
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
module.exports = command;
