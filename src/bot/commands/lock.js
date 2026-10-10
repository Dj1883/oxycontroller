const { TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseChannelId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const command = makeModalCommand({
  name: 'lock', description: 'Lock a text channel', modalId: 'lock:modal', title: 'Lock Channel',
  fields: [
    { id: 'channel', label: 'Channel ID or mention', required: false, placeholder: 'Leave blank for the current channel', maxLength: 32 },
    { id: 'reason', label: 'Reason', style: TextInputStyle.Paragraph, required: false, placeholder: 'Reason for locking the channel', maxLength: 1000 }
  ],
  async executeModal(i) {
    const raw = input(i, 'channel', false);
    const channelId = raw ? parseChannelId(raw) : i.channelId;
    if (!channelId) return i.reply({ content: 'Enter a valid channel ID or mention.', flags: 64 });
    return core.setChannelLocked(i, channelId, true, input(i, 'reason', false));
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
module.exports = command;
