const { TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseUserId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const command = makeModalCommand({
  name: 'note', description: 'Add a private staff note to a user', modalId: 'note:modal', title: 'Add Staff Note',
  fields: [
    { id: 'user', label: 'User ID or mention', placeholder: '123456789012345678', maxLength: 32 },
    { id: 'note', label: 'Note', style: TextInputStyle.Paragraph, placeholder: 'Internal staff note', maxLength: 4000 }
  ],
  async executeModal(i) {
    const userId = parseUserId(input(i, 'user'));
    if (!userId) return i.reply({ content: 'Enter a valid Discord user ID or mention.', flags: 64 });
    return core.addNote(i, userId, input(i, 'note'));
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
module.exports = command;
