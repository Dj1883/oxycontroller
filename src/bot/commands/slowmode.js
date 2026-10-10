const { TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { makeModalCommand } = require('../../services/moderationCommandFactory');
const { input, parseChannelId } = require('../../services/moderationForms');
const core = require('../../services/moderationCore');
const command = makeModalCommand({
  name: 'slowmode', description: 'Set channel slowmode', modalId: 'slowmode:modal', title: 'Configure Slowmode',
  fields: [
    { id: 'channel', label: 'Channel ID or mention', required: false, placeholder: 'Leave blank for the current channel', maxLength: 32 },
    { id: 'seconds', label: 'Seconds', placeholder: '0 to disable, maximum 21600', maxLength: 8 },
    { id: 'reason', label: 'Reason', style: TextInputStyle.Paragraph, required: false, placeholder: 'Reason for changing slowmode', maxLength: 1000 }
  ],
  async executeModal(i) {
    const raw = input(i, 'channel', false);
    const channelId = raw ? parseChannelId(raw) : i.channelId;
    if (!channelId) return i.reply({ content: 'Enter a valid channel ID or mention.', flags: 64 });
    const seconds = Number(input(i, 'seconds'));
    return core.setSlowmode(i, channelId, seconds, input(i, 'reason', false));
  }
});
command.data.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
module.exports = command;
