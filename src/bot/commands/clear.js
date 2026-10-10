const {SlashCommandBuilder,PermissionFlagsBits}=require('discord.js');
const {text,v2Payload}=require('../../utils/components');
const logs=require('../../services/modlogs');
module.exports={
 data:new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages').addIntegerOption(o=>o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
 async execute(i){
  const n=i.options.getInteger('amount',true), channel=i.channel;
  if(!channel?.bulkDelete)return i.reply(v2Payload([{type:'text',value:text('This command is only available in message channels where bulk deletion is supported.')}],true));
  if(!channel.permissionsFor(i.client.user)?.has(PermissionFlagsBits.ManageMessages))return i.reply(v2Payload([{type:'text',value:text('I need the **Manage Messages** permission in this channel to do that.')}],true));
  await i.deferReply({flags:64});
  try{
   const deleted=await channel.bulkDelete(n,true);
   const caseRow=logs.recordAction({guildId:i.guild.id,action:'clear',targetId:i.user.id,targetTag:i.user.tag,moderatorId:i.user.id,moderatorTag:i.user.tag,reason:'Bulk message deletion',details:`Deleted ${deleted.size} messages in #${channel.name}`});
   await logs.sendLog(i.guild,caseRow).catch(e=>console.error('Clear log failed:',e.message));
   return i.editReply(v2Payload([{type:'text',value:text(`Deleted **${deleted.size}** message${deleted.size===1?'':'s'}.`)}],true));
  }catch(e){
   return i.editReply(v2Payload([{type:'text',value:text(`I could not delete those messages. ${e.message||''}`)}],true));
  }
 }
};
