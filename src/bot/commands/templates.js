const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const { text, separator, button, row, select, v2Payload } = require('../../utils/components');
const db = require('../../db/database');
const { PermissionFlagsBits } = require('discord.js');

function publishedTemplates() {
  return db.listTemplates('published', 25);
}

function panel() {
  const templates = publishedTemplates();
  const body = templates.length
    ? `Browse server templates published by Oxy staff.\n\nTo submit a Discord template, use \`/templates submit\` and paste a \`discord.new\` link.\n\n**Published templates:** ${templates.length}\n\nSelect a template below to view its contents.`
    : 'There are currently no published templates available.';

  const parts = [
    { type: 'text', value: text(`## 🧩 Oxy Server Templates\n\n${body}`) },
    { type: 'separator', value: separator() }
  ];

  if (templates.length) {
    parts.push({
      type: 'row',
      value: row([select(
        'templates:view',
        'Select a template',
        templates.map(t => ({
          label: `#${t.id} • ${t.name}`.slice(0, 100),
          value: String(t.id),
          description: `${t.category || 'community'} • ${t.source || 'community'}`.slice(0, 100)
        }))
      )])
    });
  }

  parts.push({
    type: 'row',
    value: row([button('templates:refresh', 'Refresh', ButtonStyle.Secondary)])
  });

  return v2Payload(parts, { ephemeral: true });
}

function templateView(template) {
  let settings = {};
  try { settings = JSON.parse(template.definition_json || '{}'); } catch {}

  const definition = settings.settings || {};
  const enabled = Object.entries(definition)
    .filter(([, value]) => value && typeof value === 'object' && value.enabled !== false)
    .map(([key]) => key)
    .join(', ') || 'None listed';

  const roles = Array.isArray(settings.roles) ? settings.roles : [];
  const rolePlan = roles.length ? roles.map(r => `• **${r.name}**${r.color && r.color !== '#000000' ? ` — ${r.color}` : ''}${r.hoist ? ' • Hoisted' : ''}${r.mentionable ? ' • Mentionable' : ''}`).join('\n') : 'No generated roles were included.';

  const channels = Array.isArray(settings.channels) ? settings.channels : [];
  const channelPlan = channels.length
    ? channels.map(c => `• **${c.name}** — ${c.type}${c.category ? ` → ${c.category}` : ''}`).join('\n')
    : 'No channel structure was included.';

  let discordLink = '';
  try {
    const d = JSON.parse(template.definition_json || '{}')?.discordTemplate;
    if (d?.url) discordLink = `\n\n**Discord template:** ${d.url}`;
  } catch {}

  return v2Payload([
    { type: 'text', value: text(`## 🧩 ${template.name}\n\n${template.description || 'No description provided.'}\n\n**Category:** ${template.category || 'Community'}\n**Source:** ${template.source === 'community' ? 'Discord community submission' : (template.source || 'community')}\n**Version:** ${template.version || 1}${discordLink}\n**Template link:** https://oxcontroller.app/template/${template.creator_slug || `creator-${String(template.created_by).slice(-6)}`}/${template.id}\n\n**Included systems:** ${enabled}\n\n**Roles:**\n${rolePlan}\n\n**Channel structure:**\n${channelPlan}\n\nUse the template through your server setup workflow when supported.`) },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([button('templates:back', 'Back', ButtonStyle.Secondary), button('templates:refresh', 'Refresh', ButtonStyle.Secondary)]) }
  ], { ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('templates')
    .setDescription('Browse and submit Oxy server templates')
    .addSubcommand(s=>s.setName('browse').setDescription('Browse published Oxy templates'))
    .addSubcommand(s=>s.setName('submit').setDescription('Submit a Discord template link for review').addStringOption(o=>o.setName('link').setDescription('Your Discord template link').setRequired(true)))
    .addSubcommand(s=>s.setName('copy').setDescription('Create a private copy of a published template').addIntegerOption(o=>o.setName('id').setDescription('Template ID').setRequired(true)))
    .addSubcommand(s=>s.setName('mine').setDescription('View your private templates'))
    .addSubcommand(s=>s.setName('versions').setDescription('View a template changelog').addIntegerOption(o=>o.setName('id').setDescription('Template ID').setRequired(true)))
    .addSubcommand(s=>s.setName('download').setDescription('Download a server layout').addIntegerOption(o=>o.setName('id').setDescription('Template ID').setRequired(true))),

  async execute(i) {
    const sub=i.options.getSubcommand(false);
    if(sub==='copy') {
      const id=i.options.getInteger('id',true);
      try {
        const service=require('../../services/templates');
        const source=db.getTemplate(id);
        if(!source || source.status!=='published') return i.reply({content:'That template is not available to copy.',ephemeral:true});
        const t=service.createPrivateCopy({sourceId:id,createdBy:i.user.id,creatorName:i.user.username});
        const link=`https://oxcontroller.app${service.hostedPath(t,i.user.username)}`;
        return i.reply({content:`**Private template created**\n\n**${t.name}**\n${link}\n\nYou can create up to **10 private templates**.`,ephemeral:true});
      } catch(e) { return i.reply({content:`**Could not create private template**\n\n${e.message}`,ephemeral:true}); }
    }
    if(sub==='download') {
      const id=i.options.getInteger('id',true);
      const t=db.getTemplate(id);
      if(!t) return i.reply({content:'That template was not found.',ephemeral:true});
      const service=require('../../services/templates');
      const isOwner=String(t.created_by)===String(i.user.id);
      if(t.status==='private') {
        if(!isOwner) return i.reply({content:'That private template is only available to its owner.',ephemeral:true});
        const body=Buffer.from(service.serverLayoutText(t),'utf8');
        try {
          await i.user.send({content:`**Your server layout is ready.**\n\n**${t.name}** • Version ${t.version}`,files:[{attachment:body,name:service.templateFilename(t)}]});
          return i.reply({content:'I sent the server layout to your DMs.',ephemeral:true});
        } catch {
          return i.reply({content:'I could not DM you the server layout. Please enable DMs from Oxy.',ephemeral:true});
        }
      }
      if(t.status!=='published') return i.reply({content:'That template is not currently available for download.',ephemeral:true});
      const body=Buffer.from(service.serverLayoutText(t),'utf8');
      return i.reply({content:`**${t.name}** • Version ${t.version}`,files:[{attachment:body,name:service.templateFilename(t)}],ephemeral:true});
    }
    if(sub==='versions') {
      const id=i.options.getInteger('id',true);
      const t=db.getTemplate(id);
      if(!t || t.status!=='published') return i.reply({content:'That template is not available.',ephemeral:true});
      const versions=db.listTemplateVersions(id,20);
      const lines=versions.length ? versions.map(v=>`**v${v.version}** — ${v.change_log}\n<@${v.changed_by}> • <t:${Math.floor(Number(v.created_at)/1000)}:R>`).join('\n\n') : 'No changelog entries are available.';
      return i.reply({content:`## ${t.name} — Changelog\n\n${lines}`,ephemeral:true});
    }
    if(sub==='mine') {
      const service=require('../../services/templates');
      const mine=db.listTemplatesByCreator(i.user.id,25).filter(t=>t.status==='private');
      if(!mine.length) return i.reply({content:'You do not have any private templates yet.',ephemeral:true});
      const lines=mine.map(t=>`**#${t.id} • ${t.name}**\nVersion ${t.version} • https://oxcontroller.app${service.hostedPath(t,i.user.username)}`).join('\n\n');
      return i.reply({content:`## Your Private Templates\n\n${lines}`,ephemeral:true});
    }
    if(sub==='submit') {
      const url=i.options.getString('link',true).trim();
      try {
        const service=require('../../services/templates');
        const t=await service.submitDiscordTemplate({url,createdBy:i.user.id});
        const reviewChannelId=String(process.env.TEMPLATE_REVIEW_CHANNEL_ID||'').trim();
        if(reviewChannelId){
          const review=await i.client.channels.fetch(reviewChannelId).catch(()=>null);
          if(!review) throw new Error('The Oxy template review channel could not be found.');
          if(!review.isTextBased()) throw new Error('The Oxy template review channel is not a text channel.');
          const perms=review.permissionsFor(i.client.user);
          if(!perms?.has(PermissionFlagsBits.SendMessages)) throw new Error('Oxy does not have permission to send template reviews to the configured channel.');
          const discordCode=JSON.parse(t.definition_json||'{}').discordTemplate?.code||'';
          await review.send({content:`## 🧩 New Server Template Submission\n\n**#${t.id} • ${t.name}**\n**Submitted by:** <@${i.user.id}>\n**Source:** Discord template\n**Link:** https://discord.new/${discordCode}`,components:[{type:1,components:[{type:2,style:3,label:'Approve',custom_id:`about:templates:approve:${t.id}`,type:2},{type:2,style:4,label:'Reject',custom_id:`about:templates:reject:${t.id}`,type:2}]}]});
        } else {
          throw new Error('Template submissions are not currently configured.');
        }
        return i.reply({content:`**Template submitted**\n\n**${t.name}** has been submitted for review. It will appear in the public catalogue after approval.`,ephemeral:true});
      } catch(e) {
        return i.reply({content:`**Template submission failed**\n\n${e.message}`,ephemeral:true});
      }
    }
    return i.reply(panel());
  },

  async handleSelect(i) {
    if (i.customId !== 'templates:view') return false;
    const template = db.getTemplate(Number(i.values[0]));
    if (!template || template.status !== 'published') {
      return i.reply({ content: 'That template is no longer published.', ephemeral: true });
    }
    return i.update(templateView(template));
  },


  async handleButton(i) {
    if (i.customId === 'templates:back' || i.customId === 'templates:refresh') {
      return i.update(panel());
    }
    if (i.customId === 'templates:import') {
      const service = require('../../services/templates');
      await i.reply({ content: '**Import Discord Template**\n\nReply in this channel with your Discord template link (`https://discord.new/...` or `https://discord.com/template/...`).\n\nYour submission will be sent to the central Oxy staff review queue. You have 2 minutes.', ephemeral: true });
      const channel = i.channel;
      if (!channel?.isTextBased()) return true;
      const collector = channel.createMessageCollector({ filter: m => m.author.id === i.user.id, max: 1, time: 120000 });
      collector.on('collect', async m => {
        const url = m.content.trim();
        await m.delete().catch(() => {});
        try {
          const t = await service.submitDiscordTemplate({ url, createdBy: i.user.id });
          const reviewChannelId = String(process.env.TEMPLATE_REVIEW_CHANNEL_ID || '').trim();
          if (!reviewChannelId) throw new Error('Template submissions are not currently configured.');
          const review = await i.client.channels.fetch(reviewChannelId).catch(() => null);
          if (!review?.isTextBased()) throw new Error('The Oxy template review channel could not be found.');
          const perms = review.permissionsFor(i.client.user);
          if (!perms?.has(PermissionFlagsBits.SendMessages)) throw new Error('Oxy does not have permission to send template reviews to the configured channel.');
          const d = JSON.parse(t.definition_json || '{}').discordTemplate || {};
          await review.send({ content: `## 🧩 New Server Template Submission\n\n**#${t.id} • ${t.name}**\n**Submitted by:** <@${i.user.id}>\n**Source:** Discord template\n**Link:** ${d.url || url}`, components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Approve', custom_id: `about:templates:approve:${t.id}`, type: 2 }, { type: 2, style: 4, label: 'Reject', custom_id: `about:templates:reject:${t.id}`, type: 2 }] }] });
          await i.followUp({ content: `**Template submitted**\n\n**${t.name}** has been sent to the Oxy staff review queue.`, ephemeral: true });
        } catch (e) {
          await i.followUp({ content: `**Template import failed**\n\n${e.message}`, ephemeral: true }).catch(() => {});
        }
      });
      return true;
    }
    return false;
  }
};
