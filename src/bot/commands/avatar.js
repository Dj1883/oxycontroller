const { SlashCommandBuilder } = require('discord.js');
const { text, v2Payload } = require('../../utils/components');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Show a user's avatar")
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(false)),
  async execute(i) {
    const u = i.options.getUser('user') || i.user;
    const url = u.displayAvatarURL({ size: 1024, extension: 'png' });
    return i.reply(v2Payload([{ type:'text', value:text(`## ${u.username}\n[Open avatar](${url})`) }], false));
  }
};
