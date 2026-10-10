const { PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseUserId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const { v2Payload, text } = require('../../utils/components');
const db = require('../../db/database');
const command = makeModalCommand({
  name: 'notes', description: 'View staff notes for a user', modalId: 'notes:modal', title: 'View Staff Notes',
  fields: [{ id: 'user', label: 'User ID or mention', placeholder: '123456789012345678', maxLength: 32 }],
  async executeModal(i) {
    if (!core.requirePermission(i, 'notes')) return;
    const userId = parseUserId(input(i, 'user'));
    if (!userId) return i.reply({ content: 'Enter a valid Discord user ID or mention.', flags: 64 });
    const rows = db.getModerationCases(i.guild.id, userId, 100).filter(row => row.action === 'note').sort((a, b) => b.created_at - a.created_at);
    if (!rows.length) return i.reply(v2Payload([{ type: 'text', value: text(`<@${userId}> has no staff notes.`) }], { ephemeral: true }));
    const body = rows.slice(0, 15).map(row => `**#${row.id}** • <t:${Math.floor(row.created_at / 1000)}:F> • <@${row.moderator_id}>\n${row.details || 'No note content'}`).join('\n\n');
    return i.reply(v2Payload([{ type: 'text', value: text(`## Staff Notes\n\n**User:** <@${userId}>\n\n${body}`) }], { ephemeral: true }));
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
module.exports = command;
