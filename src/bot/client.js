const { Client, GatewayIntentBits, Events, MessageFlags, Routes } = require('discord.js');
const { loadCommands } = require('./commandLoader');
const music = require('../services/music');
const tickets = require('./commands/tickets');
const giveaways = require('../services/giveaways');
const audit = require('../services/audit');

const shifts = require('../services/shifts');

function installModalFallback(interaction) {
  if (interaction && typeof interaction.showModal !== 'function' && interaction.id && interaction.token && interaction.client?.rest) {
    interaction.showModal = async modal => {
      const data = modal?.toJSON ? modal.toJSON() : modal;
      return interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        { body: { type: 9, data } }
      );
    };
  }
}

function makeClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  client.commands = loadCommands();

  // Per-user help page state
  client.helpPage = new Map();
  client.refreshPresence = refreshPresence;
  setInterval(() => { if (client.helpPage.size > 5000) client.helpPage.clear(); }, 10 * 60 * 1000);

  client.once(Events.ClientReady, async c => {
    try { await music.init(c); } catch (e) { console.error('[Music] Initialisation failed:', e.message); }
    try { await giveaways.init(c); } catch (e) { console.error('[Giveaways] Initialisation failed:', e.message); }
    c.user.setPresence({
      status: 'online',
      activities: [
        {
          name: `Oxy Controller • ${c.guilds.cache.size} servers`,
          type: 3
        }
      ]
    });

    console.log(
      `Oxy Controller ready as ${c.user.tag} (${c.guilds.cache.size} guilds)`
    );
  });

  async function sendMemberMessage(member, type) {
    const cfg = require('../db/database').getGuildConfig(member.guild.id);
    let settings = {};
    try { settings = JSON.parse(cfg.settings_json || '{}'); } catch {}
    const item = settings.messages?.[type];
    if (!item?.enabled || !item.channelId) return;
    const channel = member.guild.channels.cache.get(item.channelId) || await member.guild.channels.fetch(item.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const raw = String(item.content || (type === 'welcome' ? 'Welcome to {server}, {user}!' : '{user} has left the server.'));
    const content = raw
      .replace(/\{server\}/g, member.guild.name)
      .replace(/\{user\}/g, `<@${member.id}>`)
      .replace(/\{username\}/g, member.user.username)
      .replace(/\{id\}/g, member.id);
    const { v2Payload, text } = require('../utils/components');
    const sent = await channel.send(v2Payload([{ type: 'text', value: text(content) }])).catch(() => null);
    if (sent) await audit.log(member.guild, { action: type === 'welcome' ? 'Welcome Message' : 'Leave Message', actorId: client.user?.id, actorTag: client.user?.tag, targetId: member.id, targetTag: member.user?.tag, details: `Sent ${type} message to <#${channel.id}>` });
  }

  client.on(Events.GuildMemberAdd, async member => {
    try { await sendMemberMessage(member, 'welcome'); } catch (e) { console.error('Welcome message error:', e.message); }
  });

  client.on(Events.GuildMemberRemove, async member => {
    try { await sendMemberMessage(member, 'leave'); } catch (e) { console.error('Leave message error:', e.message); }
  });

  client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (!message.guild) {
      try { await tickets.handleDirectMessage(message); } catch (e) { console.error('Modmail DM error:', e.message); }
      return;
    }

    try { await tickets.handleTicketMessage(message); } catch (e) { console.error('Ticket relay error:', e.message); }

    // Prefix suggestion command: !suggest new feature
    try {
      const prefix = process.env.PREFIX || '!';
      const content = String(message.content || '').trim();
      if (content.toLowerCase().startsWith(`${prefix}suggest`)) {
        const remainder = content.slice(`${prefix}suggest`.length).trim();
        const suggestions = client.commands.get('suggestions');
        if (suggestions?.handlePrefix) {
          const handled = await suggestions.handlePrefix(message, remainder ? remainder.split(/\s+/) : []);
          if (handled) return;
        }
      }
    } catch (e) { console.error('Prefix suggestion command error:', e.message); }

    try {
      const automod = require('../services/automod');
      const guildConfig = automod.loadGuildConfig(message.guild.id);
      const bypassAdmins = guildConfig.bypassAdmins !== false;
      const isGuildOwner = message.guild.ownerId === message.author.id;
      const isAdministrator = Boolean(message.member?.permissions?.has('Administrator'));
      if (bypassAdmins && (isGuildOwner || isAdministrator)) return;

      const matches = automod.inspect(message, guildConfig);
      if (!matches.length) return;

      if (guildConfig.deleteMessages && message.deletable) {
        await message.delete().catch(e => console.error('AutoMod delete failed:', e.message));
      }

      const key = `${message.guildId}:${message.author.id}`;
      client.__automodViolations = client.__automodViolations || new Map();
      const count = (client.__automodViolations.get(key) || 0) + 1;
      client.__automodViolations.set(key, count);

      if (guildConfig.escalation.enabled && count >= guildConfig.escalation.threshold && guildConfig.escalation.action === 'timeout' && message.member?.moderatable) {
        await message.member.timeout(guildConfig.escalation.duration * 1000, `Oxy AutoMod: ${matches.map(x => x.category).join(', ')}`).catch(e => console.error('AutoMod timeout failed:', e.message));
        client.__automodViolations.set(key, 0);
      }

      await audit.log(message.guild, {
        action: 'AutoMod',
        actorId: client.user?.id,
        actorTag: client.user?.tag,
        targetId: message.author.id,
        targetTag: message.author.tag,
        details: `Triggered ${matches.map(x => `${x.category}${x.word ? ` (${x.word})` : ''}`).join(', ')} in #${message.channel?.name || 'unknown'}${guildConfig.deleteMessages ? ' • message deleted when possible' : ''}`
      });

      if (guildConfig.logActions) {
        const logs = require('../services/modlogs');
        const unique = [...new Map(matches.map(x => [`${x.category}:${x.reason}:${x.word || ''}`, x])).values()];
        const logChannelId = guildConfig.logChannelId || (() => {
          try {
            const stored = require('../db/database').getGuildConfig(message.guild.id);
            const settings = JSON.parse(stored.settings_json || '{}');
            return settings.messages?.moderationLogChannelId || settings.moderation?.logChannelId || null;
          } catch { return null; }
        })();

        for (const match of unique) {
          const caseRow = logs.recordAction({
            guildId: message.guildId,
            action: 'automod',
            targetId: message.author.id,
            targetTag: message.author.tag,
            moderatorId: client.user.id,
            moderatorTag: client.user.tag,
            reason: `${match.category}: ${match.reason}${match.word ? ` (${match.word})` : ''}`,
            details: `Message in #${message.channel?.name || 'unknown'}${message.url ? ` • ${message.url}` : ''}`
          });
          const sent = await logs.sendLog(message.guild, caseRow, logChannelId).catch(e => {
            console.error('AutoMod log failed:', e.message);
            return false;
          });
          if (!sent) console.warn(`AutoMod trigger recorded as case #${caseRow.id}, but no log channel was available for guild ${message.guild.id}.`);
        }
      }
    } catch (e) { console.error('AutoMod error:', e); }
  });

  client.on(Events.InteractionCreate, async interaction => {
    installModalFallback(interaction);
    try {
      if (typeof interaction.update === 'function') {
        const rawUpdate = interaction.update.bind(interaction);
        interaction.update = options => {
          if (options && typeof options === 'object' && typeof options.flags === 'number') {
            options = { ...options, flags: options.flags & (MessageFlags.IsComponentsV2 | MessageFlags.SuppressEmbeds) };
          }
          return rawUpdate(options);
        };
      }
      /*
       * HELP BUTTONS
       */
      if (
        interaction.isButton() &&
        interaction.customId.startsWith('help:')
      ) {
        const command = client.commands.get('help');

        if (!command || typeof command.page !== 'function') {
          return interaction.reply({
            content: 'The help system is currently unavailable.',
            flags: 64
          });
        }

        const current =
          client.helpPage.get(interaction.user.id) ?? 0;

        const next =
          interaction.customId === 'help:next'
            ? current + 1
            : current - 1;

        const page = Math.max(0, Math.min(4, next));

        client.helpPage.set(
          interaction.user.id,
          page
        );

        const shardId =
          interaction.guild?.shardId ??
          interaction.client.shard?.ids?.[0] ??
          0;

        const shardCount =
          client.shard?.count ??
          client.ws.shards.size ??
          1;

        const result = await interaction.update(
          command.page(page, {
            id: shardId,
            count: shardCount
          })
        );
        await audit.logInteraction(interaction);
        return result;
      }

      /*
       * BUTTON INTERACTIONS
       */
      if (interaction.isButton()) {
        const root = interaction.customId.split(':')[0];

        const command = client.commands.get(root);

        if (
          command &&
          typeof command.handleButton === 'function'
        ) {
          const handled =
            await command.handleButton(interaction);

          if (handled !== false) {
            await audit.logInteraction(interaction);
            return handled;
          }
        }
      }

      /*
       * STRING SELECT MENUS
       */
      if (interaction.isStringSelectMenu()) {
        const root =
          interaction.customId.split(':')[0];

        const commandMap = {
          oxford: 'oxford',
          config: 'config',
          roblox: 'roblox',
          shift: 'shift',
          about: 'about',
          mod: 'mod',
          tickets: 'tickets',
          applications: 'applications',
          website: 'website',
        };

        const commandName =
          commandMap[root] ?? root;

        const command =
          client.commands.get(commandName);

        if (
          command &&
          typeof command.handleSelect === 'function'
        ) {
          const handled =
            await command.handleSelect(interaction);

          if (handled !== false) {
            await audit.logInteraction(interaction);
            return handled;
          }
        }
      }

      /*
       * CHANNEL SELECT MENUS
       */
      if (interaction.isChannelSelectMenu()) {
        const root = interaction.customId.split(':')[0];
        const command = client.commands.get(root);
        if (command && typeof command.handleChannel === 'function') {
          const handled = await command.handleChannel(interaction);
          if (handled !== false) { await audit.logInteraction(interaction); return handled; }
        }
      }

      /*
       * USER SELECT MENUS
       */
      if (interaction.isUserSelectMenu()) {
        const root = interaction.customId.split(':')[0];
        const command = client.commands.get(root);
        if (command && typeof command.handleUser === 'function') {
          const handled = await command.handleUser(interaction);
          if (handled !== false) { await audit.logInteraction(interaction); return handled; }
        }
      }

      /*
       * ROLE SELECT MENUS
       */
      if (interaction.isRoleSelectMenu()) {
        const root =
          interaction.customId.split(':')[0];

        const command =
          client.commands.get(root);

        if (
          command &&
          typeof command.handleRole === 'function'
        ) {
          const handled =
            await command.handleRole(interaction);

          if (handled !== false) {
            await audit.logInteraction(interaction);
            return handled;
          }
        }
      }

      /*
       * MODAL SUBMISSIONS
       */
      if (interaction.isModalSubmit()) {
        const root =
          interaction.customId.split(':')[0];

        const command =
          client.commands.get(root);

        if (
          command &&
          typeof command.handleModal === 'function'
        ) {
          const handled =
            await command.handleModal(interaction);

          if (handled !== false) {
            await audit.logInteraction(interaction);
            return handled;
          }
        }

        return;
      }

      /* AUTO MOD */
      if (interaction.isChatInputCommand() === false && interaction.isMessageContextMenuCommand() === false) {
        // Message AutoMod is handled by the messageCreate listener below.
      }

      /*
       * SLASH COMMANDS
       */
      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command =
        client.commands.get(interaction.commandName);

      if (!command) {
        return;
      }

      await command.execute(interaction);
      await audit.logInteraction(interaction);

    } catch (error) {
      console.error('Interaction failed', error);
      try {
        await audit.log(interaction.guild, {
          action: 'Interaction Error',
          actorId: interaction.user?.id,
          actorTag: interaction.user?.tag,
          details: `${interaction.isChatInputCommand?.() ? `/${interaction.commandName}` : interaction.customId ? interaction.customId : 'unknown interaction'} • ${error?.message || String(error)}`,
          status: 'Failed'
        });
      } catch (auditError) {
        console.error('Audit logging failed:', auditError.message);
      }

      try {
        const payload = {
          content:
            'Something went wrong while processing that action.',
          flags: 64
        };

        if (
          interaction.deferred ||
          interaction.replied
        ) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (replyError) {
        console.error(
          'Failed to send interaction error:',
          replyError
        );
      }
    }
  });

  return client;
}

async function refreshPresence(c) {
  if (!c?.user) {
    return;
  }

  const shardId = c.shardId ?? 0;

  const shardCount =
    c.shard?.count ??
    c.ws.shards.size ??
    1;

  c.user.setPresence({
    status: 'online',
    activities: [
      {
        name: `Shard ${shardId + 1}/${shardCount} • ${c.guilds.cache.size} servers`,
        type: 3
      }
    ]
  });
}

module.exports = {
  makeClient,
  refreshPresence
};
