const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

function text(content) { return new TextDisplayBuilder().setContent(String(content)); }
function separator() { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function button(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}
function row(components) { return new ActionRowBuilder().addComponents(components); }
function select(customId, placeholder, options, min=1, max=1) {
  const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(min).setMaxValues(max);
  menu.addOptions(options.map(o => {
    const option = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value);
    if (o.description) option.setDescription(o.description);
    if (o.emoji) option.setEmoji(o.emoji);
    if (o.default) option.setDefault(true);
    return option;
  }));
  return menu;
}
function roleSelect(customId, placeholder='Select a role') {
  return new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1);
}
function userSelect(customId, placeholder='Select a user') {
  return new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1);
}
function channelSelect(customId, placeholder='Select a channel', types=[]) {
  const menu = new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1);
  if (types.length) menu.setChannelTypes(...types);
  return menu;
}
function container(parts) {
  const c = new ContainerBuilder();
  for (const part of parts) {
    if (part.type === 'text') {
      const value = part.value instanceof TextDisplayBuilder ? part.value : text(part.value);
      c.addTextDisplayComponents(value);
    } else if (part.type === 'separator') {
      const value = part.value instanceof SeparatorBuilder ? part.value : separator();
      c.addSeparatorComponents(value);
    } else if (part.type === 'row') {
      c.addActionRowComponents(part.value);
    }
  }
  return c;
}

function v2Payload(parts, { ephemeral = false } = {}) {
  return {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [container(parts)]
  };
}

// Discord's newer component-based modal system supports select menus inside Labels.
function modalWithSelect({ customId, title, label, description, selectComponent }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const field = new LabelBuilder().setLabel(label);
  if (description) field.setDescription(description);
  field.setStringSelectMenuComponent(selectComponent);
  modal.addLabelComponents(field);
  return modal;
}
function modalWithText({ customId, title, label, description, inputId, placeholder, style=TextInputStyle.Short, required=true, maxLength=4000, minLength }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  const field = new LabelBuilder().setLabel(label);
  if (description) field.setDescription(description);
  const input = new TextInputBuilder().setCustomId(inputId).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  if (minLength != null) input.setMinLength(minLength);
  field.setTextInputComponent(input);
  modal.addLabelComponents(field);
  return modal;
}
module.exports = { text, separator, button, row, select, roleSelect, userSelect, channelSelect, container, v2Payload, modalWithSelect, modalWithText };
