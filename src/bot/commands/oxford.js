const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ox = require('../../services/oxford');
const db = require('../../db/database');
const { isGuildAdmin } = require('../../utils/permissions');
const { text, separator, select, row, v2Payload, modalWithSelect, modalWithText } = require('../../utils/components');
const { StringSelectMenuBuilder } = require('discord.js');
const { json, truncate } = require('../../utils/format');

const options = [
  ['status','Server status','Current Oxford Response server information','🖥️'],
  ['players','Players','Show online players','👥'],
  ['queue','Queue','Show the server queue','📋'],
  ['robberies','Robberies','Show robbery data','🚨'],
  ['radio','Radio calls','Show recent radio calls','📻'],
  ['modcalls','Moderator calls','Show recent moderator calls','🛡️'],
  ['vehicles','Vehicles','Show spawned vehicles','🚗'],
  ['bans','Bans','Show server bans','⛔'],
  ['killlogs','Kill logs','Show recent kill logs','⚔️'],
  ['commandlogs','Command logs','Show recent command logs','📜'],
  ['joinlogs','Join logs','Show recent join/leave logs','↔️'],
  ['command','Execute command','Run an authorised Oxford Response command','⌨️']
];

function actionSelect(customId='oxford:modal-select') {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select an Oxford Response action')
    .setRequired(true)
    .addOptions(options.map(([value,label,description,emoji]) => ({ value, label, description, emoji })));
}
function openMenuModal() {
  return modalWithSelect({
    customId:'oxford:menu-modal',
    title:'Oxford Response',
    label:'Action',
    description:'Choose what you want to view or do.',
    selectComponent:actionSelect()
  });
}
async function showCommandModal(i) {
  return i.showModal(modalWithText({
    customId:'oxford:command-modal',
    title:'Oxford Response Command',
    label:'Command',
    description:'Enter an authorised Oxford Response command.',
    inputId:'command',
    placeholder:':announce Hello world',
    maxLength:200
  }));
}
async function render(i, sub) {
  try {
    if (sub === 'command') return showCommandModal(i);
    await i.deferReply({ flags:64 });
    if (sub === 'status') {
      const x = await ox.server(i.guild.id);
      return i.editReply(v2Payload([{type:'text',value:text(`## ${ox.cleanText(x.StyledName)||x.Name||'Oxford Response'}\n\n${ox.cleanText(x.Description)||''}\n\n**Players:** ${x.CurrentPlayers??'?'} / ${x.MaxPlayers??'?'}\n**Weather:** ${x.Weather??'Unknown'}\n**Time:** ${x.TimeOfDay??'Unknown'}\n**Join Code:** ${x.JoinCode??'Unknown'}`)}], {ephemeral:true}));
    }
    if (sub === 'players') {
      const p=await ox.players(i.guild.id); const arr=Array.isArray(p)?p:(p?.players||p?.data||[]);
      const s=arr.slice(0,35).map(x=>`**${x.DisplayName||x.Username||x.Name||'Unknown'}** (${x.Username||x.Name||'?'})\n${x.Team||'No team'}${x.Callsign?` • ${x.Callsign}`:''}`).join('\n\n')||'No players online.';
      return i.editReply(v2Payload([{type:'text',value:text(`## Online Players • ${arr.length}\n\n${truncate(s,3500)}`)}], {ephemeral:true}));
    }
    if (sub === 'queue') {
      const q=await ox.queue(i.guild.id);
      return i.editReply(v2Payload([{type:'text',value:text(`## Queue\n\n**Waiting:** ${q.total??q.users?.length??0}\n\n${(q.users||[]).map(x=>`• ${x}`).join('\n')||'Nobody waiting.'}`)}], {ephemeral:true}));
    }
    const data = await ox[sub](i.guild.id);
    return i.editReply(v2Payload([{type:'text',value:text(`## ${sub}\n\n${json(data,3400)}`)}], {ephemeral:true}));
  } catch (e) {
    console.error(e);
    const msg=e.code==='OXFORD_NOT_CONFIGURED'?'Oxford Response is not configured for this Discord server. Use `/config` to configure it.':e.status===403?'Oxford API rejected the configured key.':e.status===503?'Oxford Response data is temporarily unavailable.':'Oxford Response API request failed.';
    if (i.deferred || i.replied) return i.editReply(v2Payload([{type:'text',value:text(msg)}], {ephemeral:true}));
    return i.reply(v2Payload([{type:'text',value:text(msg)}], {ephemeral:true}));
  }
}

module.exports = {
 data:new SlashCommandBuilder().setName('oxford').setDescription('Open Oxford Response tools'),
 openMenuModal,
 async handleModal(i) {
   if (i.customId === 'oxford:menu-modal') {
     const sub=i.fields.getStringSelectValues('oxford:modal-select')[0];
     return render(i,sub);
   }
   if (i.customId === 'oxford:command-modal') {
     const allowed=isGuildAdmin(i);
     if(!allowed) return i.reply(v2Payload([{type:'text',value:text('You are not authorised to execute Oxford Response server commands.')}], {ephemeral:true}));
     const cmd=i.fields.getTextInputValue('command').trim();
     try { await ox.command(i.guild.id,cmd); return i.reply(v2Payload([{type:'text',value:text(`Command sent successfully: \`${cmd}\``)}], {ephemeral:true})); }
     catch(e){return i.reply(v2Payload([{type:'text',value:text(e.status===403?'Oxford API rejected the configured key.':'Oxford Response command failed.')}], {ephemeral:true}));}
   }
   return false;
 },
 async execute(i){ return i.showModal(openMenuModal()); }
};
