const { SlashCommandBuilder } = require('discord.js');
const { buildModal } = require('./moderationForms');

function makeModalCommand({ name, description, modalId, title, fields, executeModal }) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(description),
    async execute(interaction) {
      await interaction.showModal(buildModal(modalId, title, fields));
    },
    async handleModal(interaction) {
      if (interaction.customId !== modalId) return false;
      await executeModal(interaction);
      return true;
    }
  };
}

module.exports = { makeModalCommand };
