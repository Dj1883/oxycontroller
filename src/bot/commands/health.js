const {SlashCommandBuilder}=require('discord.js');
const {text,v2Payload}=require('../../utils/components');
module.exports={data:new SlashCommandBuilder().setName('health').setDescription('Show Oxy Controller service status'),async execute(i){
  const pkg=require('../../../package.json');
  return i.reply(v2Payload([{type:'text',value:text(`## Oxy Controller Health\n\n**Status:** Online\n**Version:** ${pkg.version}\n**Uptime:** ${Math.floor(process.uptime())}s\n**Services:** Operational`)}],{ephemeral:true}));
}};
