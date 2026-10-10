const { TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseUserId, parseDuration } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const command = makeModalCommand({
  name: 'timeout', description: 'Timeout a member', modalId: 'timeout:modal', title: 'Timeout Member',
  fields: [
    { id: 'user', label: 'User ID or mention', placeholder: '123456789012345678', maxLength: 32 },
    { id: 'duration', label: 'Duration', placeholder: 'Examples: 30m, 2h, 3d', maxLength: 16 },
    { id: 'reason', label: 'Reason', style: TextInputStyle.Paragraph, required: false, placeholder: 'Reason for the timeout', maxLength: 1000 }
  ],
  async executeModal(i) {
    const userId = parseUserId(input(i, 'user'));
    const duration = parseDuration(input(i, 'duration'));
    if (!userId) return i.reply({ content: 'Enter a valid Discord user ID or mention.', flags: 64 });
    if (!duration) return i.reply({ content: 'Enter a valid duration such as `30m`, `2h`, or `3d`.', flags: 64 });
    return core.performUserAction(i, { action: 'timeout', userId, durationSeconds: duration, reason: input(i, 'reason', false) || 'No reason provided' });
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
module.exports = command;
