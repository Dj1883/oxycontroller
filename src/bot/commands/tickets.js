const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const db = require('../../db/database');
const { isGuildAdmin } = require('../../utils/permissions');
const {
  text,
  separator,
  row,
  button,
  select,
  roleSelect,
  userSelect,
  v2Payload
} = require('../../utils/components');

const DEFAULT_TICKETS = {
  enabled: false,
  mode: 'panel',
  categoryId: null,
  staffRoleId: null,
  logChannelId: null,
  panelChannelId: null,
  panelMessageId: null,
  questions: [],
  maxOpenPerUser: 1,
  autoCloseOnDelete: false,
  anonymousModmail: false
};

function settingsFor(guildId) {
  const cfg = db.getGuildConfig(guildId);
  let settings = {};
  try { settings = JSON.parse(cfg.settings_json || '{}'); } catch {}
  return { cfg, settings, tickets: { ...DEFAULT_TICKETS, ...(settings.tickets || {}) } };
}

function saveTickets(guildId, patch) {
  const { settings, tickets } = settingsFor(guildId);
  const nextTickets = { ...tickets, ...patch };
  settings.tickets = nextTickets;
  db.setGuildConfig(guildId, { settings_json: JSON.stringify(settings) });
  return nextTickets;
}

function isOwner(i) {
  return Boolean(i.guild && i.guild.ownerId === i.user.id);
}

function canStaff(i, tickets = null) {
  if (!i.guild || !i.member) return false;
  if (i.guild.ownerId === i.user.id) return true;
  if (isGuildAdmin(i)) return true;
  const cfg = tickets || settingsFor(i.guild.id).tickets;
  return Boolean(cfg.staffRoleId && i.member.roles?.cache?.has(cfg.staffRoleId));
}

function modeLabel(mode) {
  return ({ panel: 'Ticket Panel', modmail: 'Modmail', both: 'Panel + Modmail' })[mode] || 'Ticket Panel';
}

function modeEnabled(cfg, mode) {
  return cfg.enabled && (cfg.mode === mode || cfg.mode === 'both');
}

function qSummary(questions) {
  if (!questions.length) return 'None configured';
  return questions.map((q, n) => `${n + 1}. ${q.question}${q.required === false ? ' (optional)' : ''}`).join('\n');
}

function setupPanel(i, notice = '') {
  const { tickets } = settingsFor(i.guild.id);
  const category = tickets.categoryId ? `<#${tickets.categoryId}>` : 'Not configured';
  const staff = tickets.staffRoleId ? `<@&${tickets.staffRoleId}>` : 'Not configured';
  const logs = tickets.logChannelId ? `<#${tickets.logChannelId}>` : 'Disabled';
  const panel = tickets.panelChannelId ? `<#${tickets.panelChannelId}>` : 'Not configured';
  const anonymous = tickets.anonymousModmail ? '🟢 Enabled' : '🔴 Disabled';

  return v2Payload([
    { type: 'text', value: `## 🎫 Oxy Ticket System\n\n${notice ? `${notice}\n\n` : ''}**Status:** ${tickets.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n**Mode:** ${modeLabel(tickets.mode)}\n**Ticket category:** ${category}\n**Staff role:** ${staff}\n**Log channel:** ${logs}\n**Public panel:** ${panel}\n**Anonymous modmail:** ${anonymous}\n**Questions:** ${tickets.questions.length}/5 configured` },
    { type: 'separator', value: separator() },
    { type: 'text', value: `### Questions\n${qSummary(tickets.questions)}\n\n### Anonymous Modmail\nWhen enabled, users can DM Oxy to create an anonymous support case. The ticket channel never displays their username; Oxy retains only the Discord user ID for internal review and DM routing.` },
    { type: 'row', value: row([
      button('tickets:setup:mode', 'Mode', ButtonStyle.Primary),
      button('tickets:setup:category', 'Category'),
      button('tickets:setup:staff', 'Staff Role'),
      button('tickets:setup:logs', 'Log Channel')
    ]) },
    { type: 'row', value: row([
      button('tickets:setup:questions', 'Questions'),
      button('tickets:setup:anonymous', 'Anonymous Modmail', tickets.anonymousModmail ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('tickets:setup:panel', 'Panel Channel'),
      button('tickets:setup:publish', 'Publish Panel', ButtonStyle.Success),
      button('tickets:setup:toggle', tickets.enabled ? 'Disable' : 'Enable', tickets.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    ]) }
  ], { ephemeral: true });
}

function publicPanel(guildId) {
  const { tickets } = settingsFor(guildId);
  let description = 'Open a private support ticket with the server team.';
  if (tickets.mode === 'modmail') description = tickets.anonymousModmail ? 'Message Oxy in DMs to open an anonymous support conversation with the server team.' : 'Message Oxy in DMs to open a private support conversation with the server team.';
  if (tickets.mode === 'both') description = tickets.anonymousModmail ? 'Open a private ticket here, or message Oxy directly for anonymous modmail.' : 'Open a private ticket here, or message Oxy directly for modmail.';
  return v2Payload([
    { type: 'text', value: `## 🎫 Support Centre\n\n${description}${tickets.questions.length ? `\n\n**Questions:** ${tickets.questions.length} short questions will be asked before your ticket is opened.` : ''}` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([
      button(`tickets:create:${guildId}`, 'Create Ticket', ButtonStyle.Primary, tickets.mode === 'modmail'),
      button('tickets:info', 'How it works')
    ]) }
  ]);
}

function setupModeMenu() {
  return select('tickets:setup:mode', 'Choose ticket mode', [
    { label: 'Ticket Panel', value: 'panel', description: 'Users open tickets from a posted panel.' },
    { label: 'Modmail', value: 'modmail', description: 'Users DM Oxy to start a support conversation.' },
    { label: 'Panel + Modmail', value: 'both', description: 'Enable both ways of opening tickets.' }
  ]);
}

function questionsPanel(i) {
  const { tickets } = settingsFor(i.guild.id);
  const parts = [
    { type: 'text', value: `## 🎫 Ticket Questions\n\nAdd up to **5** questions. They are asked in a modal before the ticket channel is created.\n\n${qSummary(tickets.questions)}` },
    { type: 'separator', value: separator() }
  ];
  if (tickets.questions.length) {
    parts.push({ type: 'row', value: row([
      select('tickets:questions:edit', 'Select a question to edit', tickets.questions.map((q, idx) => ({ label: `${idx + 1}. ${q.question}`.slice(0, 100), value: String(idx) })))
    ]) });
    parts.push({ type: 'row', value: row([
      select('tickets:questions:remove', 'Select a question to remove', tickets.questions.map((q, idx) => ({ label: `${idx + 1}. ${q.question}`.slice(0, 100), value: String(idx) })))
    ]) });
  }
  parts.push({ type: 'row', value: row([
    button('tickets:questions:add', 'Add Question', ButtonStyle.Primary, tickets.questions.length >= 5),
    button('tickets:setup:back', 'Back')
  ]) });
  return v2Payload(parts, { ephemeral: true });
}

function questionModal(index = null, guildId) {
  const editing = index !== null;
  const title = editing ? 'Edit Ticket Question' : 'Add Ticket Question';
  const modal = new ModalBuilder().setCustomId(editing ? `tickets:question:edit:${index}` : 'tickets:question:add').setTitle(title);
  const { tickets } = settingsFor(guildId);
  const existing = editing ? tickets.questions[index] : null;

  const input = new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300);
  if (existing?.question) input.setValue(existing.question);
  const label = new LabelBuilder().setLabel('Question').setDescription('Keep it short and clear.').setTextInputComponent(input);
  modal.addLabelComponents(label);
  const required = new StringSelectMenuBuilder().setCustomId('required').setPlaceholder('Required?').setMinValues(1).setMaxValues(1).addOptions(
    { label: 'Required', value: 'true', description: 'The user must answer it.' },
    { label: 'Optional', value: 'false', description: 'The user may skip it.' }
  );
  const reqLabel = new LabelBuilder().setLabel('Answer requirement').setStringSelectMenuComponent(required);
  modal.addLabelComponents(reqLabel);
  return modal;
}

function ticketControls(ticket, tickets) {
  const claimLabel = ticket.claimed_by ? 'Unclaim' : 'Claim';
  const claimStyle = ticket.claimed_by ? ButtonStyle.Secondary : ButtonStyle.Success;
  if (ticket.status === 'open') {
    return [
      button(`tickets:claim:${ticket.id}`, claimLabel, claimStyle),
      button(`tickets:add:${ticket.id}`, 'Add User'),
      button(`tickets:remove:${ticket.id}`, 'Remove User'),
      button(`tickets:${ticket.locked ? 'unlock' : 'lock'}:${ticket.id}`, ticket.locked ? 'Unlock' : 'Lock'),
      button(`tickets:rename:${ticket.id}`, 'Rename'),
      button(`tickets:transcript:${ticket.id}`, 'Transcript'),
      button(`tickets:notify:${ticket.id}`, 'Notify Staff'),
      button(`tickets:close:${ticket.id}`, 'Close', ButtonStyle.Danger),
      button(`tickets:delete:${ticket.id}`, 'Delete', ButtonStyle.Danger)
    ];
  }
  return [
    button(`tickets:reopen:${ticket.id}`, 'Reopen', ButtonStyle.Success),
    button(`tickets:transcript:${ticket.id}`, 'Transcript'),
    button(`tickets:delete:${ticket.id}`, 'Delete', ButtonStyle.Danger)
  ];
}

function ticketPanel(ticket, guild) {
  const { tickets } = settingsFor(guild.id);
  const claimed = ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Unclaimed';
  const status = ticket.status === 'open' ? '🟢 Open' : '🔴 Closed';
  const answered = (() => { try { return Object.keys(JSON.parse(ticket.answers_json || '{}')).length; } catch { return 0; } })();
  const identity = ticket.anonymous
    ? `**Opened by:** Anonymous User\n**Internal Oxy User ID:** ${ticket.user_id}`
    : `**Opened by:** <@${ticket.user_id}>`;
  return v2Payload([
    { type: 'text', value: `## 🎫 Ticket #${ticket.id}\n\n**Status:** ${status}\n${identity}\n**Claimed by:** ${claimed}\n**Priority:** ${(ticket.priority || 'normal').toUpperCase()}\n**Mode:** ${ticket.mode || 'panel'}${ticket.anonymous ? ' • Anonymous' : ''}\n**Questions answered:** ${answered}/${tickets.questions.length}\n**Opened:** <t:${Math.floor(ticket.created_at / 1000)}:F>${ticket.closed_at ? `\n**Closed:** <t:${Math.floor(ticket.closed_at / 1000)}:F>${ticket.closed_reason ? `\n**Close reason:** ${ticket.closed_reason}` : ''}` : ''}` },
    { type: 'separator', value: separator() },
    { type: 'text', value: ticket.status === 'open' ? 'Use the controls below to manage this ticket. Staff can claim, lock, rename, add participants, create a transcript or close it.' : 'This ticket is archived. Staff can reopen it, create a transcript, or delete the channel.' },
    { type: 'row', value: row(ticketControls(ticket, tickets).slice(0, 5)) },
    { type: 'row', value: row(ticketControls(ticket, tickets).slice(5)) }
  ]);
}

async function saveTicketLog(guild, ticket, action, actorId, details = '') {
  const { tickets } = settingsFor(guild.id);
  if (!tickets.logChannelId) return;
  const channel = guild.channels.cache.get(tickets.logChannelId);
  if (!channel || !channel.isTextBased()) return;
  const audit = require('../../services/audit');
  const requester = ticket.anonymous
    ? `**User:** Anonymous User\n**Internal Oxy User ID:** ${ticket.user_id}`
    : `**User:** ${audit.userProfileLink(guild, ticket.user_id)}`;
  const actor = audit.userProfileLink(guild, actorId);
  const payload = v2Payload([
    { type: 'text', value: `## 🎫 Ticket Log • #${ticket.id}\n\n**Action:** ${action}\n**Actor:** ${actor}\n${requester}\n**When:** <t:${Math.floor(Date.now() / 1000)}:F>${details ? `\n**Details:** ${details}` : ''}` }
  ]);
  await channel.send(payload).catch(() => {});
}

async function createTicket(i, { guild, user, mode = 'panel', answers = {}, anonymous = null } = {}) {
  const { tickets } = settingsFor(guild.id);
  const isAnonymous = anonymous === null ? (mode === 'modmail' && tickets.anonymousModmail) : Boolean(anonymous);
  if (!tickets.enabled) throw new Error('The ticket system is not enabled.');
  if (mode === 'panel' && !modeEnabled(tickets, 'panel')) throw new Error('The ticket panel is disabled.');
  if (mode === 'modmail' && !modeEnabled(tickets, 'modmail')) throw new Error('Modmail is disabled.');

  const existing = db.getOpenTicketForUser(guild.id, user.id);
  if (existing) return { existing, created: false };

  let category = tickets.categoryId ? guild.channels.cache.get(tickets.categoryId) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'Oxy Controller ticket system' });
    saveTickets(guild.id, { categoryId: category.id });
  }

  const safe = isAnonymous ? `anonymous-${Date.now().toString().slice(-6)}` : (String(user.username || user.id).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 22) || 'user');
  const channel = await guild.channels.create({
    name: `${mode === 'modmail' ? (isAnonymous ? 'anonymous-modmail' : 'modmail') : 'ticket'}-${safe}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: isAnonymous ? `Oxy Anonymous Modmail • Case pending` : `Oxy ${mode === 'modmail' ? 'Modmail' : 'Ticket'} • ${user.tag}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...(!isAnonymous ? [{ id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }] : []),
      { id: i.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      ...(tickets.staffRoleId ? [{ id: tickets.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }] : [])
    ],
    reason: `Oxy ${mode === 'modmail' ? (isAnonymous ? 'anonymous modmail' : 'modmail') : 'ticket'} opened${isAnonymous ? ` for user ID ${user.id}` : ` by ${user.tag}`}`
  });

  const ticket = db.createTicket(guild.id, user.id, channel.id, { mode, anonymous: isAnonymous, answers });
  await channel.setName(`${mode === 'modmail' ? (isAnonymous ? 'anonymous-modmail' : 'modmail') : 'ticket'}-${ticket.id}-${safe}`.slice(0, 95)).catch(() => {});
  await channel.setTopic(isAnonymous ? `Oxy Anonymous Modmail #${ticket.id} • Internal User ID ${user.id}` : `Oxy Ticket #${ticket.id} • ${user.tag} • ${mode === 'modmail' ? 'Modmail' : 'Panel'}`).catch(() => {});
  await channel.send(ticketPanel(ticket, guild));
  await channel.send(v2Payload([{ type: 'text', value: `### ${isAnonymous ? '🕵️ Anonymous Modmail connected' : (mode === 'modmail' ? '💬 Modmail connected' : '👋 Welcome')}\n${isAnonymous ? 'This is an anonymous support case. The requester is represented internally by their Discord user ID only. Messages sent to Oxy in DMs will be relayed here, and staff replies will be sent back to their DMs.' : `<@${user.id}>, your conversation is now open. ${mode === 'modmail' ? 'Messages you send to Oxy in DMs will be relayed here, and staff replies will be sent back to your DMs.' : 'Please describe what you need help with and a staff member will respond.'}`}` }], { ephemeral: false }));

  await saveTicketLog(guild, ticket, 'Created', user.id, mode === 'modmail' ? 'Opened through modmail.' : 'Opened from the ticket panel.');
  return { ticket, created: true };
}

function questionAnswersFromModal(i, tickets) {
  const answers = {};
  tickets.questions.forEach((q, idx) => {
    let value = '';
    try { value = i.fields.getTextInputValue(`question_${idx}`)?.trim() || ''; } catch {}
    answers[q.id] = value;
  });
  return answers;
}

function questionModalForOpen(guildId, mode) {
  const { tickets } = settingsFor(guildId);
  const modal = new ModalBuilder().setCustomId(`tickets:open:${mode}:${guildId}`).setTitle(mode === 'modmail' ? 'Start Modmail' : 'Open Ticket');
  for (let idx = 0; idx < tickets.questions.length; idx++) {
    const q = tickets.questions[idx];
    const input = new TextInputBuilder().setCustomId(`question_${idx}`).setLabel(q.question.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(q.required !== false).setMaxLength(1000);
    const label = new LabelBuilder().setLabel(q.question.slice(0, 45)).setDescription(q.required === false ? 'Optional' : 'Required').setTextInputComponent(input);
    modal.addLabelComponents(label);
  }
  return modal;
}

async function handleSetupButton(i, action) {
  if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can configure the ticket system.' }], { ephemeral: true }));
  if (action === 'mode') return i.reply(v2Payload([{ type: 'text', value: '### Choose ticket mode' }, { type: 'row', value: row([setupModeMenu()]) }], { ephemeral: true }));
  if (action === 'category') {
    const menu = new ChannelSelectMenuBuilder().setCustomId('tickets:setup:category').setPlaceholder('Select the ticket category').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildCategory);
    return i.reply(v2Payload([{ type: 'text', value: '### Ticket category\nChoose where new ticket channels should be created.' }, { type: 'row', value: row([menu]) }], { ephemeral: true }));
  }
  if (action === 'staff') return i.reply(v2Payload([{ type: 'text', value: '### Staff role\nChoose the role that can manage tickets.' }, { type: 'row', value: row([roleSelect('tickets:setup:staff', 'Select the ticket staff role')]) }], { ephemeral: true }));
  if (action === 'logs') {
    const menu = new ChannelSelectMenuBuilder().setCustomId('tickets:setup:logs').setPlaceholder('Select the ticket log channel').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    return i.reply(v2Payload([{ type: 'text', value: '### Ticket logs\nChoose where ticket activity should be logged.' }, { type: 'row', value: row([menu]) }], { ephemeral: true }));
  }
  if (action === 'questions') return i.reply(questionsPanel(i));
  if (action === 'anonymous') {
    const { tickets } = settingsFor(i.guild.id);
    if (!(tickets.mode === 'modmail' || tickets.mode === 'both')) {
      return i.reply(v2Payload([{ type: 'text', value: 'Anonymous Modmail requires Modmail or Panel + Modmail mode.' }], { ephemeral: true }));
    }
    saveTickets(i.guild.id, { anonymousModmail: !tickets.anonymousModmail });
    return i.update(setupPanel(i, `Anonymous Modmail ${!tickets.anonymousModmail ? 'enabled' : 'disabled'}.`));
  }
  if (action === 'panel') {
    const menu = new ChannelSelectMenuBuilder().setCustomId('tickets:setup:panel').setPlaceholder('Select where the public panel should be posted').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    return i.reply(v2Payload([{ type: 'text', value: '### Public panel channel\nChoose where Oxy should publish the ticket panel.' }, { type: 'row', value: row([menu]) }], { ephemeral: true }));
  }
  if (action === 'publish') {
    const { tickets } = settingsFor(i.guild.id);
    if (!tickets.panelChannelId && (tickets.mode === 'panel' || tickets.mode === 'both')) return i.reply(v2Payload([{ type: 'text', value: 'Choose a public panel channel first.' }], { ephemeral: true }));
    if (!tickets.staffRoleId) return i.reply(v2Payload([{ type: 'text', value: 'Choose a staff role first.' }], { ephemeral: true }));
    if (tickets.mode === 'panel' || tickets.mode === 'both') {
      const channel = i.guild.channels.cache.get(tickets.panelChannelId);
      if (!channel?.isTextBased()) return i.reply(v2Payload([{ type: 'text', value: 'The selected panel channel is unavailable.' }], { ephemeral: true }));
      let msg = null;
      if (tickets.panelMessageId) {
        msg = await channel.messages.fetch(tickets.panelMessageId).catch(() => null);
        if (msg) await msg.edit(publicPanel(i.guild.id)).catch(() => {});
      }
      if (!msg) msg = await channel.send(publicPanel(i.guild.id));
      saveTickets(i.guild.id, { panelMessageId: msg.id, enabled: true });
      return i.reply(v2Payload([{ type: 'text', value: `✅ Ticket panel ${tickets.panelMessageId === msg.id ? 'updated' : 'published'} in ${channel}.` }], { ephemeral: true }));
    }
    saveTickets(i.guild.id, { enabled: true });
    return i.reply(v2Payload([{ type: 'text', value: '✅ Modmail is now enabled. Users can DM Oxy to open support.' }], { ephemeral: true }));
  }
  if (action === 'toggle') {
    const { tickets } = settingsFor(i.guild.id);
    saveTickets(i.guild.id, { enabled: !tickets.enabled });
    return i.update(setupPanel(i, `Ticket system ${!tickets.enabled ? 'enabled' : 'disabled'}.`));
  }
  if (action === 'back') return i.update(setupPanel(i));
  return false;
}

function modmailServerPicker(guilds) {
  return v2Payload([
    { type: 'text', value: '## 🕵️ Anonymous Support\n\nChoose the server you want to contact. Your ticket will only retain your Discord user ID for internal routing and review.' },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([select('tickets:modmail-server', 'Choose a server', guilds.slice(0, 25).map(g => ({ label: g.name.slice(0, 100), value: g.id, description: 'Start an anonymous support case' })))]) }
  ]);
}

async function handleTicketButton(i) {
  const parts = i.customId.split(':');
  const action = parts[1];

  if (action === 'create') {
    const guildId = parts[2] || i.guildId;
    const guild = i.client.guilds.cache.get(guildId);
    if (!guild) return i.reply(v2Payload([{ type: 'text', value: 'This ticket system is unavailable.' }], { ephemeral: true }));
    const { tickets } = settingsFor(guild.id);
    if (!modeEnabled(tickets, 'panel')) return i.reply(v2Payload([{ type: 'text', value: 'Ticket creation is disabled.' }], { ephemeral: true }));
    if (tickets.questions.length) return i.showModal(questionModalForOpen(guild.id, 'panel'));
    const result = await createTicket(i, { guild, user: i.user, mode: 'panel' });
    return i.reply(v2Payload([{ type: 'text', value: result.created ? `✅ Your ticket is ready: <#${result.ticket.channel_id}>` : `You already have an open ticket: <#${result.existing.channel_id}>` }], { ephemeral: true }));
  }

  if (!i.guild) {
    if (action === 'modmail-start') {
      const guild = i.client.guilds.cache.get(parts[2]);
      if (!guild) return i.reply(v2Payload([{ type: 'text', value: 'That modmail server is no longer available.' }], { ephemeral: true }));
      const { tickets } = settingsFor(guild.id);
      if (!modeEnabled(tickets, 'modmail')) return i.reply(v2Payload([{ type: 'text', value: 'Modmail is currently disabled.' }], { ephemeral: true }));
      if (tickets.questions.length) return i.showModal(questionModalForOpen(guild.id, 'modmail'));
      const result = await createTicket(i, { guild, user: i.user, mode: 'modmail' });
      return i.reply(v2Payload([{ type: 'text', value: result.created ? `✅ ${tickets.anonymousModmail ? 'Anonymous modmail' : 'Modmail'} opened for **${guild.name}**. A private support channel has been created.` : `You already have an open modmail conversation with **${guild.name}**.` }]));
    }
    return false;
  }

  const ticket = parts[2] ? db.getTicket(Number(parts[2])) : db.getTicketByChannel(i.channelId);
  if (!ticket || ticket.guild_id !== i.guild.id) return false;
  const { tickets } = settingsFor(i.guild.id);

  if (action === 'close') {
    if (!canStaff(i, tickets) && ticket.user_id !== i.user.id) return i.reply(v2Payload([{ type: 'text', value: 'You are not allowed to close this ticket.' }], { ephemeral: true }));
    const modal = new ModalBuilder().setCustomId(`tickets:close:${ticket.id}`).setTitle(`Close Ticket #${ticket.id}`);
    const input = new TextInputBuilder().setCustomId('reason').setLabel('Close reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder('Optional reason for closing this ticket.');
    modal.addLabelComponents(new LabelBuilder().setLabel('Reason').setDescription('This will be saved in the ticket case/log.').setTextInputComponent(input));
    return i.showModal(modal);
  }

  if (!canStaff(i, tickets)) return i.reply(v2Payload([{ type: 'text', value: 'You need the configured ticket staff role or administrator access for that action.' }], { ephemeral: true }));

  if (action === 'claim') {
    const next = ticket.claimed_by ? null : i.user.id;
    db.claimTicket(ticket.id, next);
    const updated = db.getTicket(ticket.id);
    await i.reply(ticketPanel(updated, i.guild));
    await saveTicketLog(i.guild, updated, next ? 'Claimed' : 'Unclaimed', i.user.id);
    return;
  }
  if (action === 'lock' || action === 'unlock') {
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    if (!channel) return i.reply(v2Payload([{ type: 'text', value: 'Ticket channel not found.' }], { ephemeral: true }));
    const locked = action === 'lock';
    db.setTicketLocked(ticket.id, locked);
    await channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: !locked }).catch(() => {});
    await channel.send(v2Payload([{ type: 'text', value: `${locked ? '🔒' : '🔓'} Ticket ${locked ? 'locked' : 'unlocked'} by <@${i.user.id}>.` }])).catch(() => {});
    await saveTicketLog(i.guild, db.getTicket(ticket.id), locked ? 'Locked' : 'Unlocked', i.user.id);
    return i.reply(v2Payload([{ type: 'text', value: `Ticket ${locked ? 'locked' : 'unlocked'}.` }], { ephemeral: true }));
  }
  if (action === 'rename') return i.showModal(new ModalBuilder().setCustomId(`tickets:rename:${ticket.id}`).setTitle('Rename Ticket').addLabelComponents(new LabelBuilder().setLabel('Channel name').setDescription('Use letters, numbers and hyphens.').setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(70))));
  if (action === 'add') {
    return i.reply(v2Payload([{ type: 'text', value: '### Add participant\nSelect a user to add to this ticket.' }, { type: 'row', value: row([userSelect(`tickets:adduser:${ticket.id}`, 'Select a user')]) }], { ephemeral: true }));
  }
  if (action === 'remove') {
    return i.reply(v2Payload([{ type: 'text', value: '### Remove participant\nSelect a user to remove from this ticket. The ticket owner cannot be removed.' }, { type: 'row', value: row([userSelect(`tickets:removeuser:${ticket.id}`, 'Select a user')]) }], { ephemeral: true }));
  }
  if (action === 'transcript') {
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    if (!channel?.isTextBased()) return i.reply(v2Payload([{ type: 'text', value: 'Ticket channel not found.' }], { ephemeral: true }));
    await i.deferReply({ ephemeral: true });
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const lines = messages ? [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(m => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.cleanContent || '[attachment/embed/component]'}`) : [];
    const buffer = Buffer.from(`# Oxy Ticket #${ticket.id}\nGuild: ${i.guild.name}\nUser: ${ticket.user_id}\n\n${lines.join('\n')}`, 'utf8');
    return i.editReply({ ...v2Payload([{ type: 'text', value: `## 📄 Ticket #${ticket.id} Transcript\n\nThe transcript is attached below.` }]), files: [{ attachment: buffer, name: `ticket-${ticket.id}-transcript.txt` }] });
  }
  if (action === 'notify') {
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    if (!channel) return i.reply(v2Payload([{ type: 'text', value: 'Ticket channel not found.' }], { ephemeral: true }));
    const mention = tickets.staffRoleId ? `<@&${tickets.staffRoleId}>` : '@staff';
    await channel.send({ ...v2Payload([{ type: 'text', value: `🔔 ${mention} **${i.user.tag}** requested staff attention on Ticket #${ticket.id}.` }]), allowedMentions: tickets.staffRoleId ? { roles: [tickets.staffRoleId] } : undefined }).catch(() => {});
    return i.reply(v2Payload([{ type: 'text', value: 'Staff have been notified.' }], { ephemeral: true }));
  }
  if (action === 'delete') {
    return i.reply(v2Payload([{ type: 'text', value: `## Delete Ticket #${ticket.id}\n\nThis permanently deletes the ticket channel. Create a transcript first if you need the conversation saved.` }, { type: 'row', value: row([button(`tickets:delete-confirm:${ticket.id}`, 'Delete Permanently', ButtonStyle.Danger), button(`tickets:info:${ticket.id}`, 'Cancel')]) }], { ephemeral: true }));
  }
  if (action === 'delete-confirm') {
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    await saveTicketLog(i.guild, ticket, 'Deleted', i.user.id);
    if (channel) await channel.delete(`Oxy ticket #${ticket.id} deleted by ${i.user.tag}`).catch(() => {});
    return i.reply(v2Payload([{ type: 'text', value: `Ticket #${ticket.id} deleted.` }], { ephemeral: true }));
  }
  if (action === 'reopen') {
    db.reopenTicket(ticket.id);
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    if (channel) {
      if (!ticket.anonymous) {
        await channel.permissionOverwrites.edit(ticket.user_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => {});
      }
      if (ticket.anonymous) {
        await channel.setName(`anonymous-modmail-${ticket.id}`.slice(0, 95)).catch(() => {});
        await channel.setTopic(`Oxy Anonymous Modmail #${ticket.id} • Internal User ID ${ticket.user_id}`).catch(() => {});
      } else {
        await channel.setName(`ticket-${ticket.id}-${String(i.guild.members.cache.get(ticket.user_id)?.user?.username || 'user').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 22)}`.slice(0, 95)).catch(() => {});
      }
      const updated = db.getTicket(ticket.id);
      await channel.send(ticketPanel(updated, i.guild)).catch(() => {});
    }
    await saveTicketLog(i.guild, db.getTicket(ticket.id), 'Reopened', i.user.id);
    return i.reply(v2Payload([{ type: 'text', value: `✅ Ticket #${ticket.id} reopened.` }], { ephemeral: true }));
  }
  if (action === 'info') return i.reply(ticketPanel(ticket, i.guild));
  return false;
}

module.exports = {
  data: new SlashCommandBuilder().setName('tickets').setDescription('Open or configure the Oxy ticket system'),

  async execute(i) {
    if (!i.guild) return i.reply(v2Payload([{ type: 'text', value: 'Use this command inside a Discord server.' }], { ephemeral: true }));
    const { tickets } = settingsFor(i.guild.id);
    if (isOwner(i)) return i.reply(setupPanel(i));
    if (!tickets.enabled) return i.reply(v2Payload([{ type: 'text', value: '🎫 The ticket system has not been configured by the server owner yet.' }], { ephemeral: true }));
    if (tickets.mode === 'modmail') return i.reply(v2Payload([{ type: 'text', value: '💬 Modmail is enabled for this server. Send Oxy a DM to start a private support conversation.' }], { ephemeral: true }));
    return i.reply({ ...publicPanel(i.guild.id), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  },

  async handleButton(i) {
    if (!i.customId.startsWith('tickets:')) return false;
    const parts = i.customId.split(':');
    if (parts[1] === 'setup') return handleSetupButton(i, parts[2]);
    if (parts[1] === 'questions') {
      if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can edit ticket questions.' }], { ephemeral: true }));
      if (parts[2] === 'add') {
        if (settingsFor(i.guild.id).tickets.questions.length >= 5) return i.reply(v2Payload([{ type: 'text', value: 'You can have a maximum of 5 ticket questions.' }], { ephemeral: true }));
        return i.showModal(questionModal(null, i.guild.id));
      }
    }
    if (parts[1] === 'modmail-start' || parts[1] === 'create' || ['close','claim','lock','unlock','rename','add','remove','transcript','notify','delete','delete-confirm','reopen','info'].includes(parts[1])) return handleTicketButton(i);
    return false;
  },

  async handleSelect(i) {
    if (!i.customId.startsWith('tickets:')) return false;
    if (i.customId === 'tickets:modmail-server') {
      if (i.guild) return false;
      const guild = i.client.guilds.cache.get(i.values[0]);
      if (!guild) return i.reply(v2Payload([{ type: 'text', value: 'That server is no longer available for anonymous support.' }]));
      const { tickets } = settingsFor(guild.id);
      if (!modeEnabled(tickets, 'modmail')) return i.reply(v2Payload([{ type: 'text', value: 'Anonymous modmail is no longer enabled for that server.' }]));
      return i.reply(v2Payload([
        { type: 'text', value: `## 🕵️ Anonymous Support\n\nReady to start an anonymous support case for **${guild.name}**.${tickets.questions.length ? ` You will be asked ${tickets.questions.length} question${tickets.questions.length === 1 ? '' : 's'} first.` : ''}` },
        { type: 'row', value: row([button(`tickets:modmail-start:${guild.id}`, 'Start Anonymous Ticket', ButtonStyle.Primary)]) }
      ]));
    }
    if (i.customId === 'tickets:setup:mode') {
      if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can configure tickets.' }], { ephemeral: true }));
      saveTickets(i.guild.id, { mode: i.values[0] });
      return i.update(setupPanel(i, `Mode set to **${modeLabel(i.values[0])}**.`));
    }
    if (i.customId === 'tickets:questions:remove' || i.customId === 'tickets:questions:edit') {
      if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can manage ticket questions.' }], { ephemeral: true }));
      const index = Number(i.values[0]);
      const { tickets } = settingsFor(i.guild.id);
      if (!tickets.questions[index]) return i.reply(v2Payload([{ type: 'text', value: 'Question not found.' }], { ephemeral: true }));
      if (i.customId === 'tickets:questions:remove') {
        const questions = tickets.questions.filter((_, idx) => idx !== index);
        saveTickets(i.guild.id, { questions });
        return i.update(questionsPanel(i));
      }
      return i.showModal(questionModal(index, i.guild.id));
    }
    return false;
  },

  async handleChannel(i) {
    if (!i.customId.startsWith('tickets:setup:')) return false;
    if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can configure tickets.' }], { ephemeral: true }));
    const target = i.values[0];
    const map = { 'tickets:setup:category': 'categoryId', 'tickets:setup:logs': 'logChannelId', 'tickets:setup:panel': 'panelChannelId' };
    const key = map[i.customId];
    if (!key) return false;
    saveTickets(i.guild.id, { [key]: target });
    const label = key === 'categoryId' ? 'ticket category' : key === 'logChannelId' ? 'log channel' : 'public panel channel';
    return i.update(setupPanel(i, `✅ ${label} updated.`));
  },

  async handleRole(i) {
    if (i.customId !== 'tickets:setup:staff') return false;
    if (!isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can configure tickets.' }], { ephemeral: true }));
    saveTickets(i.guild.id, { staffRoleId: i.values[0] });
    return i.update(setupPanel(i, '✅ Ticket staff role updated.'));
  },

  async handleUser(i) {
    const parts = i.customId.split(':');
    if (!i.customId.startsWith('tickets:adduser:') && !i.customId.startsWith('tickets:removeuser:')) return false;
    const ticket = db.getTicket(Number(parts[2]));
    if (!ticket || ticket.guild_id !== i.guild.id) return false;
    const { tickets } = settingsFor(i.guild.id);
    if (!canStaff(i, tickets)) return i.reply(v2Payload([{ type: 'text', value: 'Staff access required.' }], { ephemeral: true }));
    const userId = i.values[0];
    if (userId === ticket.user_id && i.customId.startsWith('tickets:removeuser:')) return i.reply(v2Payload([{ type: 'text', value: 'The ticket owner cannot be removed.' }], { ephemeral: true }));
    const channel = i.guild.channels.cache.get(ticket.channel_id);
    if (!channel) return i.reply(v2Payload([{ type: 'text', value: 'Ticket channel not found.' }], { ephemeral: true }));
    if (i.customId.startsWith('tickets:adduser:')) {
      await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }).catch(() => {});
      await channel.send(v2Payload([{ type: 'text', value: `➕ <@${userId}> was added to Ticket #${ticket.id} by <@${i.user.id}>.` }])).catch(() => {});
      await saveTicketLog(i.guild, ticket, 'Participant added', i.user.id, `${require('../../services/audit').userProfileLink(i.guild, userId)} added.`);
      return i.reply(v2Payload([{ type: 'text', value: `<@${userId}> has been added to the ticket.` }], { ephemeral: true }));
    }
    await channel.permissionOverwrites.delete(userId).catch(() => {});
    await channel.send(v2Payload([{ type: 'text', value: `➖ <@${userId}> was removed from Ticket #${ticket.id} by <@${i.user.id}>.` }])).catch(() => {});
    await saveTicketLog(i.guild, ticket, 'Participant removed', i.user.id, `${require('../../services/audit').userProfileLink(i.guild, userId)} removed.`);
    return i.reply(v2Payload([{ type: 'text', value: `<@${userId}> has been removed from the ticket.` }], { ephemeral: true }));
  },

  async handleModal(i) {
    if (!i.customId.startsWith('tickets:')) return false;
    if (i.customId === 'tickets:question:add' || i.customId.startsWith('tickets:question:edit:')) {
      if (!i.guild || !isOwner(i)) return i.reply(v2Payload([{ type: 'text', value: 'Only the server owner can edit ticket questions.' }], { ephemeral: true }));
      const editing = i.customId.startsWith('tickets:question:edit:');
      const index = editing ? Number(i.customId.split(':')[3]) : null;
      const { tickets } = settingsFor(i.guild.id);
      const question = i.fields.getTextInputValue('question').trim();
      const required = i.fields.getStringSelectValues('required')[0] !== 'false';
      if (editing) {
        if (!tickets.questions[index]) return i.reply(v2Payload([{ type: 'text', value: 'Question not found.' }], { ephemeral: true }));
        const questions = [...tickets.questions];
        questions[index] = { ...questions[index], question, required };
        saveTickets(i.guild.id, { questions });
      } else {
        const questions = [...tickets.questions, { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, question, required }];
        saveTickets(i.guild.id, { questions });
      }
      return i.reply(questionsPanel(i));
    }
    if (i.customId.startsWith('tickets:open:')) {
      const parts = i.customId.split(':');
      const mode = parts[2];
      const guildId = parts[3];
      const guild = i.client.guilds.cache.get(guildId);
      if (!guild) return i.reply(v2Payload([{ type: 'text', value: 'This ticket system is unavailable.' }], { ephemeral: true }));
      const { tickets } = settingsFor(guild.id);
      const answers = questionAnswersFromModal(i, tickets);
      const result = await createTicket(i, { guild, user: i.user, mode, answers });
      if (result.created) {
        return i.reply(v2Payload([{ type: 'text', value: mode === 'modmail' ? `✅ Modmail opened for **${guild.name}**.` : `✅ Your ticket is ready: <#${result.ticket.channel_id}>` }], { ephemeral: true }));
      }
      return i.reply(v2Payload([{ type: 'text', value: `You already have an open ticket: <#${result.existing.channel_id}>` }], { ephemeral: true }));
    }
    if (i.customId.startsWith('tickets:close:')) {
      const ticket = db.getTicket(Number(i.customId.split(':')[2]));
      if (!ticket || ticket.guild_id !== i.guild.id) return i.reply(v2Payload([{ type: 'text', value: 'Ticket not found.' }], { ephemeral: true }));
      const { tickets } = settingsFor(i.guild.id);
      if (!canStaff(i, tickets) && ticket.user_id !== i.user.id) return i.reply(v2Payload([{ type: 'text', value: 'You are not allowed to close this ticket.' }], { ephemeral: true }));
      let reason = '';
      try { reason = i.fields.getTextInputValue('reason').trim(); } catch {}
      db.closeTicket(ticket.id, i.user.id, reason || 'Closed from ticket controls');
      const channel = i.guild.channels.cache.get(ticket.channel_id);
      if (channel) {
        await channel.permissionOverwrites.edit(ticket.user_id, { ViewChannel: false, SendMessages: false }).catch(() => {});
        await channel.setName(`closed-ticket-${ticket.id}`.slice(0, 95)).catch(() => {});
        const updated = db.getTicket(ticket.id);
        await channel.send(ticketPanel(updated, i.guild)).catch(() => {});
      }
      const updated = db.getTicket(ticket.id);
      await saveTicketLog(i.guild, updated, 'Closed', i.user.id, reason || 'No reason provided.');
      return i.reply(v2Payload([{ type: 'text', value: `🔒 Ticket #${ticket.id} has been closed.` }], { ephemeral: true }));
    }
    if (i.customId.startsWith('tickets:rename:')) {
      const ticket = db.getTicket(Number(i.customId.split(':')[2]));
      if (!ticket || ticket.guild_id !== i.guild.id) return i.reply(v2Payload([{ type: 'text', value: 'Ticket not found.' }], { ephemeral: true }));
      const { tickets } = settingsFor(i.guild.id);
      if (!canStaff(i, tickets)) return i.reply(v2Payload([{ type: 'text', value: 'Staff access required.' }], { ephemeral: true }));
      const name = i.fields.getTextInputValue('name').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || `ticket-${ticket.id}`;
      const channel = i.guild.channels.cache.get(ticket.channel_id);
      if (channel) await channel.setName(name).catch(() => {});
      await saveTicketLog(i.guild, ticket, 'Renamed', i.user.id, `New name: ${name}`);
      return i.reply(v2Payload([{ type: 'text', value: `Ticket renamed to **${name}**.` }], { ephemeral: true }));
    }
    return false;
  },

  async handleDirectMessage(message) {
    const candidates = [...message.client.guilds.cache.values()].filter(g => {
      const { tickets } = settingsFor(g.id);
      return modeEnabled(tickets, 'modmail') && g.members.cache.has(message.author.id);
    });
    if (!candidates.length) return;

    const openCandidates = candidates.filter(g => db.getOpenTicketForUser(g.id, message.author.id));
    if (openCandidates.length === 1) {
      const guild = openCandidates[0];
      const existing = db.getOpenTicketForUser(guild.id, message.author.id);
      const channel = guild.channels.cache.get(existing.channel_id);
      if (!channel?.isTextBased()) return;
      const content = message.content?.trim() || '';
      const attachmentText = message.attachments.size ? `\n\nAttachments:\n${[...message.attachments.values()].map(a => a.url).join('\n')}` : '';
      if (!content && !attachmentText) return;
      await channel.send(v2Payload([{ type: 'text', value: `## ${existing.anonymous ? '🕵️ Anonymous Modmail Message' : '💬 Modmail Message'}\n\n**From:** ${existing.anonymous ? 'Anonymous User' : message.author.tag}${existing.anonymous ? `\n**Internal Oxy User ID:** ${message.author.id}` : ''}\n**When:** <t:${Math.floor(message.createdTimestamp / 1000)}:F>\n\n${content || '*No text content*'}${attachmentText}` }])).catch(() => {});
      await message.author.send(v2Payload([{ type: 'text', value: '✅ Your message has been delivered to the support team.' }])).catch(() => {});
      return;
    }

    if (openCandidates.length > 1) {
      await message.author.send(v2Payload([{ type: 'text', value: 'You have multiple open support conversations. Please choose which server your message is for.' }, { type: 'row', value: row([select('tickets:modmail-server', 'Choose a server', openCandidates.slice(0, 25).map(g => ({ label: g.name.slice(0, 100), value: g.id, description: 'Continue this support conversation' })))]) }])).catch(() => {});
      return;
    }

    const available = candidates.slice(0, 25);
    if (available.length > 1) {
      const anyAnonymous = available.some(g => settingsFor(g.id).tickets.anonymousModmail);
      if (anyAnonymous) {
        await message.author.send(modmailServerPicker(available)).catch(() => {});
      }
      return;
    }

    const guild = available[0];
    const { tickets } = settingsFor(guild.id);
    const anonymous = Boolean(tickets.anonymousModmail);
    const start = button(`tickets:modmail-start:${guild.id}`, anonymous ? 'Start Anonymous Ticket' : 'Start Modmail', ButtonStyle.Primary);
    await message.author.send(v2Payload([{ type: 'text', value: `## ${anonymous ? '🕵️ Anonymous Support' : '💬 Oxy Modmail'}\n\nYou can start a private support conversation with **${guild.name}**. ${anonymous ? 'Only your Discord user ID is retained internally for staff review; your username is not displayed in the ticket.' : ''} ${tickets.questions.length ? `${tickets.questions.length} questions will be asked first.` : 'A private staff channel will be created immediately.'}` }, { type: 'row', value: row([start]) }] )).catch(() => {});
  },

  async handleTicketMessage(message) {
    if (!message.guild || message.author.bot) return false;
    const ticket = db.getTicketByChannel(message.channelId);
    if (!ticket || ticket.status !== 'open' || ticket.mode !== 'modmail') return false;
    if (message.author.id === ticket.user_id) return false;
    const { tickets } = settingsFor(message.guild.id);
    if (!canStaff({ guild: message.guild, member: message.member, user: message.author }, tickets)) return false;
    const user = await message.client.users.fetch(ticket.user_id).catch(() => null);
    if (!user) return false;
    const content = message.content?.trim() || '*Staff sent a message without text content.*';
    const attachmentText = message.attachments.size ? `\n\nAttachments:\n${[...message.attachments.values()].map(a => a.url).join('\n')}` : '';
    await user.send(v2Payload([{ type: 'text', value: `## 💬 Staff Reply\n\n**${message.author.tag}** • <t:${Math.floor(message.createdTimestamp / 1000)}:F>\n\n${content}${attachmentText}` }])).catch(() => {});
    return true;
  }
};
