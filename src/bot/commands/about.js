const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ButtonStyle
} = require('discord.js');

const {
  text,
  separator,
  button,
  row,
  select,
  v2Payload,
  modalWithText
} = require('../../utils/components');

const pendingTemplateNames = new Map();
const { websiteUrl, dashboardUrl, websiteMessage, dashboardMessage } = require('../../utils/branding');


function ownerIds() {
  return new Set(
    String(process.env.BOT_OWNER_IDS || process.env.BOT_OWNER_ID || process.env.OWNER_ID || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  );
}

function isOwner(i) {
  return ownerIds().has(String(i.user.id));
}

function botInfo(i) {
  const pkg = require('../../../package.json');
  return v2Payload([
    { type: 'text', value: text(`## Oxy Controller\n\n**Version:** ${pkg.version}\n**Shift verification:** Enabled\n**Roblox account linking:** Enabled\n**Tickets:** Enabled\n**Applications:** Enabled\n**Suggestions:** Enabled\n**Website:** ${websiteUrl() || 'Not configured'} • ${websiteMessage()}`) },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([button('about:back', 'Back')]) }
  ], { ephemeral: true });
}

function ownerPanel(i) {

  return v2Payload([
    {
      type: 'text',
      value: text(`## Oxy Controller • Bot Controls

Private owner controls.

Select an action below.`)
    },
    { type: 'separator', value: separator() },
    {
      type: 'row',
      value: row([
        select(
          'about:admin',
          'Select a bot control',
          require('../dev/features')
        )
      ])
    }
  ], { ephemeral: true });
}

function serverList(i) {
  const guilds = [...i.client.guilds.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!guilds.length) {
    return v2Payload([
      {
        type: 'text',
        value: text('## Server List\n\nThe bot is not currently connected to any servers.')
      },
      {
        type: 'row',
        value: row([button('about:back', 'Back')])
      }
    ], { ephemeral: true });
  }

  const options = guilds.slice(0, 25).map(g => ({
    label: g.name.slice(0, 100),
    value: g.id,
    description: `${g.memberCount ?? '?'} members`
  }));

  return v2Payload([
    {
      type: 'text',
      value: text(`## Server List

**Servers available:** ${guilds.length}

Select a server to manage it.${guilds.length > 25 ? '\n\nOnly the first 25 servers can be displayed in one Discord menu.' : ''}`)
    },
    {
      type: 'separator',
      value: separator()
    },
    {
      type: 'row',
      value: row([
        select(
          'about:server',
          'Select a server',
          options
        )
      ])
    },
    {
      type: 'row',
      value: row([
        button('about:back', 'Back')
      ])
    }
  ], { ephemeral: true });
}

function selectedServer(i, guild) {
  return v2Payload([
    {
      type: 'text',
      value: text(`## Server

**Name:** ${guild.name}
**ID:** ${guild.id}
**Members:** ${guild.memberCount ?? 'Unknown'}
Choose an action.`)
    },
    {
      type: 'separator',
      value: separator()
    },
    {
      type: 'row',
      value: row([
        button(`about:invite:${guild.id}`, 'Create 30 Second Invite')
      ])
    },
    {
      type: 'row',
      value: row([
        button('about:servers', 'Back to Servers'),
        button('about:back', 'Bot Controls')
      ])
    }
  ], { ephemeral: true });
}

function shardInfo(i) {
  const client = i.client;
  return v2Payload([
    { type: 'text', value: text(`## Runtime Information\n\n**Connected servers:** ${client.guilds.cache.size}\n**Response time:** ${client.ws.ping}ms\n**Uptime:** ${Math.floor(process.uptime())} seconds`) },
    { type: 'row', value: row([button('about:back', 'Back')]) }
  ], { ephemeral: true });
}

async function createInvite(i, guildId) {
  const guild = i.client.guilds.cache.get(guildId);

  if (!guild) {
    return i.reply({
      content: 'That server is no longer available on this shard.',
      ephemeral: true
    });
  }

  await i.deferUpdate();

  try {
    await guild.channels.fetch();

    const channels = [...guild.channels.cache.values()]
      .filter(channel =>
        channel &&
        channel.isTextBased() &&
        typeof channel.createInvite === 'function' &&
        channel.permissionsFor(i.client.user)?.has(
          PermissionFlagsBits.CreateInstantInvite
        )
      )
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    if (!channels.length) {
      return i.editReply(
        v2Payload([
          {
            type: 'text',
            value: text(`## Unable to Create Invite

I couldn't find a channel where I have permission to create an invite in **${guild.name}**.`)
          },
          {
            type: 'row',
            value: row([
              button('about:servers', 'Back to Servers')
            ])
          }
        ], { ephemeral: true })
      );
    }

    const channel = channels[0];

    const invite = await channel.createInvite({
      maxAge: 30,
      maxUses: 1,
      unique: true,
      reason: `Oxy Controller owner server inspection`
    });

    return i.editReply(
      v2Payload([
        {
          type: 'text',
          value: text(`## Temporary Invite

**Server:** ${guild.name}
**Channel:** ${channel.name}

${invite.url}

This invite expires automatically in **30 seconds** or after it is used.`)
        },
        {
          type: 'row',
          value: row([
            button('about:servers', 'Back to Servers')
          ])
        }
      ], { ephemeral: true })
    );
  } catch (error) {
    console.error('Failed to create temporary invite:', error);

    return i.editReply(
      v2Payload([
        {
          type: 'text',
          value: text(`## Invite Failed

I couldn't create an invite for **${guild.name}**.

**Error:** ${error.message}`)
        },
        {
          type: 'row',
          value: row([
            button('about:servers', 'Back to Servers')
          ])
        }
      ], { ephemeral: true })
    );
  }
}

function devFeaturePanel(title, body, buttons = []) {
  return v2Payload([{ type:'text', value:text(`## ${title}\n\n${body}`) }, { type:'separator', value:separator() }, { type:'row', value:row(buttons.length ? buttons : [button('about:back','Back')]) }], { ephemeral:true });
}

function autoModPanel() {
  const am = require('../../services/automod');
  const words = am.loadWords();
  const cats = am.categories();
  return devFeaturePanel('🛡️ AutoMod Manager', `**Status:** ${am.loadDefaults().enabled ? 'Enabled' : 'Disabled'}\n**Words:** ${words.length}\n**Categories:** ${cats.length}\n\nWords are managed in \`config/automod/words.txt\`. Format: \`word, category\`.`, [button('about:automod:add','Add Word'),button('about:automod:edit','Edit Word'),button('about:automod:remove','Remove Word'),button('about:automod:reload','Reload'),button('about:back','Back')]);
}

function musicPanel() {
  return devFeaturePanel('🎵 Music Manager', `Music is available through the bot's music controls.\n\n**Required:** Discord voice permissions.\n**Search/playback:** enabled through \`/play\`.\n**Panel:** \`/music\`.\n\nKeep future music settings in one service so new providers can be added without changing the command layer.`, [button('about:back','Back')]);
}


function casesPanel() {
  return devFeaturePanel(
    '🗂️ Moderation Cases',
    'Owner-only access to moderation cases across connected servers.\n\nUse the controls below to inspect a case or review recent cases.',
    [
      button('about:cases:view', 'View Case', ButtonStyle.Primary),
      button('about:cases:recent', 'Recent Cases'),
      button('about:back', 'Back')
    ]
  );
}

function formatOwnerCase(client, row) {
  const guild = client.guilds.cache.get(String(row.guild_id));
  const guildName = guild?.name || `Unknown Server (${row.guild_id})`;
  const when = `<t:${Math.floor(row.created_at / 1000)}:F>`;
  const duration = row.duration_seconds ? `\n**Duration:** ${row.duration_seconds}s` : '';
  return `**#${row.id}** • ${row.action} • **${guildName}**\n` +
         `**Recipient:** ${row.target_tag || row.target_id} \`${row.target_id}\`\n` +
         `**Moderator:** ${row.moderator_tag || row.moderator_id} \`${row.moderator_id}\`\n` +
         `**When:** ${when}\n` +
         `**Reason:** ${row.reason || 'No reason provided'}${duration}`;
}

function ownerCaseView(client, row) {
  return v2Payload([
    {
      type: 'text',
      value: text(
        `## Moderation Case #${row.id}\n\n` +
        `**Server:** ${client.guilds.cache.get(String(row.guild_id))?.name || `Unknown Server (${row.guild_id})`}\n` +
        `**Server ID:** ${row.guild_id}\n` +
        `**Action:** ${row.action}\n` +
        `**Recipient:** ${row.target_tag || row.target_id} \`${row.target_id}\`\n` +
        `**Moderator:** ${row.moderator_tag || row.moderator_id} \`${row.moderator_id}\`\n` +
        `**When:** <t:${Math.floor(row.created_at / 1000)}:F>\n` +
        `**Reason:** ${row.reason || 'No reason provided'}\n` +
        (row.duration_seconds ? `**Duration:** ${row.duration_seconds}s\n` : '') +
        (row.details ? `**Details:** ${row.details}\n` : '')
      )
    },
    { type:'separator', value:separator() },
    { type:'row', value:row([
      button('about:cases', 'Back to Cases'),
      button('about:back', 'Bot Controls')
    ])}
  ], {ephemeral:true});
}

function recentCasesPanel(client) {
  const db = require('../../db/database');
  const rows = db.getAllModerationCases(25);
  const body = rows.length
    ? rows.map(r => formatOwnerCase(client, r)).join('\n\n')
    : 'No moderation cases have been recorded yet.';
  return v2Payload([
    { type:'text', value:text(`## Recent Moderation Cases\n\n${body}`) },
    { type:'separator', value:separator() },
    { type:'row', value:row([
      button('about:cases', 'Back to Cases'),
      button('about:back', 'Bot Controls')
    ])}
  ], {ephemeral:true});
}

function templatePanel() {
  const service = require('../../services/templates');
  const templates = service.list();
  const pendingCommunity = templates.filter(t => t.source === 'community' && t.status === 'pending');
  const draftAI = templates.filter(t => t.source === 'ai' && t.status === 'draft');
  const lines = templates.slice(0,10).map(t => `**#${t.id}** ${t.name} • ${t.status} • ${t.source}`).join('\n') || 'No templates created yet.';
  const parts = [
    { type:'text', value:text(`## 🧩 AI Server Templates\n\nOnly approved template creators can generate templates.\n\n**Templates:** ${templates.length}\n**Pending community templates:** ${pendingCommunity.length}\n\n${lines}`) },
    { type:'separator', value:separator() },
    { type:'row', value:row([button('about:templates:create','Create Template',ButtonStyle.Primary),button('about:templates:list','Refresh'),button('about:contributors:grant','Grant Code Contributor'),button('about:back','Back')]) }
  ];
  if (pendingCommunity.length) parts.splice(2,0,{type:'row',value:row([select('about:templates:review','Review community template',pendingCommunity.slice(0,25).map(t=>({label:`#${t.id} • ${t.name}`.slice(0,100),value:String(t.id),description:'Approve for publication and grant 3 Contributor days'})))])});
  if (draftAI.length) parts.splice(3,0,{type:'row',value:row([select('about:templates:publish-ai','Publish AI template',draftAI.slice(0,25).map(t=>({label:`#${t.id} • ${t.name}`.slice(0,100),value:String(t.id),description:'Review and publish this AI-generated template'})))])});
  return v2Payload(parts,{ephemeral:true});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('About Oxy Controller'),

  async execute(i) {
    if (isOwner(i)) {
      return i.reply(ownerPanel(i));
    }

    return i.reply(
      v2Payload([
        {
          type: 'text',
          value: text(`## Oxy Controller

**Version:** ${require('../../../package.json').version}
**Shift verification:** Enabled
**Roblox account linking:** Enabled
**Tickets:** Enabled
**Applications:** Enabled
**Suggestions:** Enabled
**Dashboard:** ${dashboardUrl() || 'Not configured'} • ${dashboardMessage()}
**Website:** ${websiteUrl() || 'Not configured'} • ${websiteMessage()}`)
        }
      ], { ephemeral: true })
    );
  },

  async handleSelect(i) {
    if (!isOwner(i)) {
      return i.reply({
        content: 'You do not have access to these controls.',
        ephemeral: true
      });
    }

    if (i.customId === 'about:admin') {
      const value = i.values[0];

      if (value === 'info') {
        return i.update(botInfo(i));
      }

      if (value === 'servers') {
        return i.update(serverList(i));
      }

      if (value === 'shards') {
        return i.update(shardInfo(i));
      }

      if (value === 'refresh') {
        try {
          if (typeof i.client.refreshPresence === 'function') {
            await i.client.refreshPresence(i.client);
          }
        } catch {}

        return i.update(ownerPanel(i));
      }

      if (value === 'automod') return i.update(autoModPanel());
      if (value === 'music') return i.update(musicPanel());
      if (value === 'tickets') return i.update(devFeaturePanel('🎫 Tickets', 'Inspect ticket activity and support controls. The server can use /tickets to create and manage support tickets.'));
      if (value === 'applications') return i.update(devFeaturePanel('📋 Applications', 'Inspect application activity and review states. The server can use /applications to submit and review forms.'));
      if (value === 'website') return i.update(devFeaturePanel('🌐 Website Integration', `${websiteMessage()} ${websiteUrl() || 'Website URL not configured'} · ${dashboardUrl() || 'Dashboard URL not configured'} · ${dashboardMessage()}`));
      if (value === 'cases') return i.update(casesPanel());
      if (value === 'templates') return i.update(templatePanel());
      if (value === 'contributors') return i.update(devFeaturePanel('🏅 Contributor Benefits', 'Code contributors can be granted Contributor benefits here. Community template authors receive 3 days per staff-approved public template.'));

      if (value === 'reset') {
        try {
          if (i.client.shard) {
            await i.client.shard.broadcastEval(c => {
              if (typeof c.user?.setPresence === 'function') {
                c.user.setPresence({
                  status: 'online',
                  activities: [{
                    name: `Rescanning servers...`,
                    type: 3
                  }]
                });
              }
            });
          }
        } catch {}

        return i.update(
          v2Payload([
            {
              type: 'text',
              value: text(`## Shard Reset Requested

The shard has been instructed to refresh its state.

**Current shard:** ${(i.client.shardId ?? 0) + 1}
**Servers:** ${i.client.guilds.cache.size}

The main bot manager performs automatic shard scaling separately.`)
            },
            {
              type: 'row',
              value: row([
                button('about:back', 'Back')
              ])
            }
          ], { ephemeral: true })
        );
      }
    }

    if (i.customId === 'about:templates:publish-ai') {
      const t=require('../../db/database').getTemplate(Number(i.values[0]));
      if(!t || t.source!=='ai' || t.status!=='draft') return i.reply({content:'That AI template is not available for publication.',ephemeral:true});
      return i.reply(v2Payload([
        {type:'text',value:text(`## 🧩 AI Template #${t.id}\n\n**${t.name}**\n\n${t.description}\n\n**Status:** ${t.status}\n**Prompt:** ${t.prompt || 'Not recorded'}\n\nPublish this template to make it available through \`/templates\`.`)},
        {type:'row',value:row([button(`about:templates:publish-ai:${t.id}`,'Publish',ButtonStyle.Success),button('about:back','Back')])}
      ],{ephemeral:true}));
    }

    if (i.customId === 'about:templates:review') {
      const t=require('../../db/database').getTemplate(Number(i.values[0]));
      if(!t) return i.reply({content:'Template not found.',ephemeral:true});
      let discordLink=''; try { const d=JSON.parse(t.definition_json||'{}')?.discordTemplate; if(d?.url) discordLink=`\n\n**Discord template:** ${d.url}`; } catch {}
      return i.reply(v2Payload([
        {type:'text',value:text(`## 🧩 Community Template #${t.id}\n\n**${t.name}**\n\n${t.description}${discordLink}\n\n**Status:** ${t.status}\n**Creator:** <@${t.created_by}>\n\nApproving this template publishes it and awards the creator **3 days of Contributor benefits**.`)},
        {type:'row',value:row([button(`about:templates:approve:${t.id}`,'Approve + Publish',ButtonStyle.Success),button('about:back','Back')])}
      ],{ephemeral:true}));
    }

    if (i.customId === 'about:server') {
      const guild = i.client.guilds.cache.get(i.values[0]);

      if (!guild) {
        return i.update(
          v2Payload([
            {
              type: 'text',
              value: text('That server is no longer available.')
            },
            {
              type: 'row',
              value: row([
                button('about:servers', 'Back to Servers')
              ])
            }
          ], { ephemeral: true })
        );
      }

      return i.update(selectedServer(i, guild));
    }

    return false;
  },

  async handleButton(i) {
    if (!isOwner(i)) {
      return i.reply({
        content: 'You do not have access to these controls.',
        ephemeral: true
      });
    }

    if (i.customId === 'about:automod:add') {
      return i.showModal(modalWithText({ customId:'about:automod:addmodal', title:'Add AutoMod Word', label:'Word and category', description:'Use: word, category', inputId:'entry', placeholder:'example, profanity', maxLength:500 }));
    }
    if (i.customId === 'about:automod:edit') {
      return i.showModal(modalWithText({ customId:'about:automod:editmodal', title:'Edit AutoMod Word', label:'Old word, new word, category', description:'Use: old, new, category', inputId:'entry', placeholder:'example, replacement, profanity', maxLength:500 }));
    }
    if (i.customId === 'about:automod:remove') {
      return i.showModal(modalWithText({ customId:'about:automod:removemodal', title:'Remove AutoMod Word', label:'Word', description:'Enter the exact word to remove.', inputId:'word', placeholder:'example', maxLength:200 }));
    }
    if (i.customId === 'about:automod:reload') { require('../../services/automod').loadWords(); return i.update(autoModPanel()); }


    if (i.customId === 'about:cases') {
      return i.update(casesPanel());
    }
    if (i.customId === 'about:cases:view') {
      return i.showModal(modalWithText({
        customId:'about:cases:viewModal',
        title:'View Moderation Case',
        label:'Case ID',
        description:'Enter the moderation case ID.',
        inputId:'case',
        placeholder:'1842',
        maxLength:12
      }));
    }
    if (i.customId === 'about:cases:recent') {
      return i.update(recentCasesPanel(i.client));
    }

    if (i.customId === 'about:templates:create') {
      const service=require('../../services/templates');
      if (!service.canCreate(i.user.id)) return i.reply({content:'Only approved template creators can generate templates.',ephemeral:true});
      const promptId = `template-create-${i.user.id}-${Date.now()}`;
      pendingTemplateNames.set(i.user.id, promptId);
      await i.reply({content:'**AI Server Template Generator**\n\nReply to this message with:\n`Template name | Describe the server you want.`\n\nExample:\n`Oxford Response Community | A structured emergency response server with staff, support, applications, suggestions and clear channel organisation.`\n\nYou have 2 minutes. Your message will be deleted after it is received.',ephemeral:true});
      const channel=i.channel;
      if (!channel?.isTextBased()) return true;
      const collector=channel.createMessageCollector({filter:m=>m.author.id===i.user.id,max:1,time:120000});
      collector.on('collect',async m=>{
        const raw=m.content.trim();
        await m.delete().catch(()=>{});
        const split=raw.indexOf('|');
        if(split<1){ pendingTemplateNames.delete(i.user.id); return i.followUp({content:'Use the format `Template name | Describe the server you want.`',ephemeral:true}).catch(()=>{}); }
        const name=raw.slice(0,split).trim().slice(0,100);
        const goal=raw.slice(split+1).trim().slice(0,1800);
        pendingTemplateNames.delete(i.user.id);
        if(!name||!goal) return i.followUp({content:'Both a template name and a description are required.',ephemeral:true}).catch(()=>{});
        await i.followUp({content:'Generating the AI template now...',ephemeral:true}).catch(()=>{});
        try {
          const t=await service.generate({name,goal,createdBy:i.user.id});
          await i.followUp({content:`**AI Template Created**\n\n**#${t.id}** ${t.name}\n**Status:** ${t.status}\n\nThe template has been saved for your review in the Dev Panel.`,ephemeral:true});
        } catch(e) {
          await i.followUp({content:`**Template Generation Failed**\n\n${e.message}`,ephemeral:true}).catch(()=>{});
        }
      });
      collector.on('end',(_,reason)=>{ if(reason==='time') pendingTemplateNames.delete(i.user.id); });
      return true;
    }
    if (i.customId === 'about:templates:list') return i.update(templatePanel());
    if (i.customId.startsWith('about:templates:publish-ai:')) {
      const id=Number(i.customId.split(':')[3]);
      const t=require('../../db/database').getTemplate(id);
      if(!t || t.source!=='ai' || t.status!=='draft') return i.reply({content:'That AI template is no longer a draft.',ephemeral:true});
      require('../../services/templates').publishTemplate(id,i.user.id);
      return i.update(templatePanel());
    }
    if (i.customId.startsWith('about:templates:approve:')) {
      const service=require('../../db/database');
      const id=Number(i.customId.split(':')[3]);
      const t=service.getTemplate(id);
      if(!t || t.source!=='community' || t.status!=='pending') return i.reply({content:'That is not a pending community template.',ephemeral:true});
      service.approveTemplate(id,i.user.id);
      return i.update(templatePanel());
    }
    if (i.customId === 'about:contributors:grant') {
      return i.showModal(modalWithText({customId:'about:contributors:grantModal',title:'Grant Code Contributor',label:'Discord user ID',description:'Grant the configured code contributor duration.',inputId:'user',placeholder:'123456789012345678',maxLength:20}));
    }

    if (i.customId === 'about:back') {
      return i.update(ownerPanel(i));
    }

    if (i.customId === 'about:servers') {
      return i.update(serverList(i));
    }

    if (i.customId.startsWith('about:invite:')) {
      const guildId = i.customId.slice('about:invite:'.length);
      return createInvite(i, guildId);
    }

    return false;
  },

  async handleModal(i) {
    if (!isOwner(i)) return i.reply({ content:'You do not have access to these controls.', ephemeral:true });
    if (i.customId === 'about:cases:viewModal') {
      const id = Number(i.fields.getTextInputValue('case').trim());
      if (!Number.isInteger(id) || id < 1) {
        return i.reply({content:'Enter a valid case ID.',ephemeral:true});
      }
      const db = require('../../db/database');
      const row = db.getModerationCase(id);
      if (!row) {
        return i.reply({content:`Moderation case #${id} could not be found.`,ephemeral:true});
      }
      return i.reply(ownerCaseView(i.client, row));
    }

    const am=require('../../services/automod');
    if (i.customId==='about:automod:addmodal') {
      const raw=i.fields.getTextInputValue('entry'); const comma=raw.indexOf(',');
      if (comma<1) return i.reply({content:'Use the format: `word, category`.',ephemeral:true});
      const word=raw.slice(0,comma).trim(); const category=raw.slice(comma+1).trim();
      if(!word||!category) return i.reply({content:'Both word and category are required.',ephemeral:true});
      am.addWord(word,category); return i.reply({content:`Added \`${word}\` to **${category}**.`,ephemeral:true});
    }
    if (i.customId==='about:automod:editmodal') {
      const raw=i.fields.getTextInputValue('entry'); const parts=raw.split(',').map(x=>x.trim());
      if(parts.length<3 || !parts[0] || !parts[1] || !parts[2]) return i.reply({content:'Use the format: `old, new, category`.',ephemeral:true});
      const ok=am.updateWord(parts[0],parts[1],parts[2]); return i.reply({content:ok?`Updated \`${parts[0]}\` → \`${parts[1]}\`, category **${parts[2]}**.`:`No matching word found for \`${parts[0]}\`.`,ephemeral:true});
    }
    if (i.customId==='about:automod:removemodal') {
      const word=i.fields.getTextInputValue('word').trim(); const ok=am.removeWord(word);
      return i.reply({content:ok?`Removed \`${word}\`.`:`No matching word found for \`${word}\`.`,ephemeral:true});
    }
    if (i.customId==='about:contributors:grantModal') {
      const user=i.fields.getTextInputValue('user').trim();
      if(!/^\d{16,20}$/.test(user)) return i.reply({content:'Enter a valid Discord user ID.',ephemeral:true});
      const benefit=require('../../services/templates').grantCodeContributor(user,i.user.id);
      return i.reply(v2Payload([{type:'text',value:text(`## 🏅 Contributor Benefit Granted\n\n**User:** <@${user}>\n**Days:** ${benefit.days}\n**Ends:** <t:${Math.floor(benefit.ends_at/1000)}:F>`)}],{ephemeral:true}));
    }
    return false;
  },

  page(page) {
    return v2Payload([{ type: 'text', value: text(`## Oxy Controller

**Version:** ${require('../../../package.json').version}

Use \`/about\` to view bot information.`) }], { ephemeral: true });
  }
};
