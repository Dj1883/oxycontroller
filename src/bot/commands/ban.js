const { TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseUserId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const command = makeModalCommand({
  name: 'ban', description: 'Ban a member', modalId: 'ban:modal', title: 'Ban Member',
  fields: [
    { id: 'user', label: 'User ID or mention', placeholder: '123456789012345678', maxLength: 32 },
    { id: 'reason', label: 'Reason', style: TextInputStyle.Paragraph, required: false, placeholder: 'Reason for the ban', maxLength: 1000 }
  ],
  async executeModal(i) {
    const userId = parseUserId(input(i, 'user'));
    if (!userId) return i.reply({ content: 'Enter a valid Discord user ID or mention.', flags: 64 });
    return core.performUserAction(i, { action: 'ban', userId, reason: input(i, 'reason', false) || 'No reason provided' });
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
module.exports = command;
