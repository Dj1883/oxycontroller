const { SlashCommandBuilder } = require('discord.js');
const { text, v2Payload } = require('../../utils/components');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Open the Oxy settings panel'),

  async execute(interaction) {
    return interaction.reply(
      v2Payload([
        {
          type: 'text',
          value: text(
            '## ⚙️ Oxy Settings\n\nConfiguration has been moved into `/settings`.\n\nUse `/settings` to manage your Oxford API key, admin role, server API key, messages, feature settings and the rest of your Oxy configuration.'
          )
        }
      ], { ephemeral: true })
    );
  }
};
