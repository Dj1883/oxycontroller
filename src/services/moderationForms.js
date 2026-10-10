const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

function buildModal(customId, title, fields) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const field of fields) {
    const label = new LabelBuilder().setLabel(field.label);
    if (field.description) label.setDescription(field.description);
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setStyle(field.style || TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.maxLength || 4000);
    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.minLength != null) input.setMinLength(field.minLength);
    label.setTextInputComponent(input);
    modal.addLabelComponents(label);
  }
  return modal;
}

function input(interaction, id, required = true) {
  const value = interaction.fields.getTextInputValue(id);
  if (!required && !String(value || '').trim()) return '';
  return String(value || '').trim();
}

function parseUserId(value) {
  const match = String(value || '').trim().match(/^(?:<@!?(\d+)>|(\d{15,25}))$/);
  return match?.[1] || null;
}

function parseChannelId(value) {
  const match = String(value || '').trim().match(/^(?:<#(\d+)>|(\d{15,25}))$/);
  return match?.[1] || null;
}

function parseRoleId(value) {
  const match = String(value || '').trim().match(/^(?:<@&(\d+)>|(\d{15,25}))$/);
  return match?.[1] || null;
}

function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit];
  return Number.isFinite(amount) ? amount * multiplier : null;
}

function formatDuration(seconds) {
  const n = Number(seconds || 0);
  if (n % 604800 === 0) return `${n / 604800}w`;
  if (n % 86400 === 0) return `${n / 86400}d`;
  if (n % 3600 === 0) return `${n / 3600}h`;
  if (n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

module.exports = { buildModal, input, parseUserId, parseChannelId, parseRoleId, parseDuration, formatDuration };
