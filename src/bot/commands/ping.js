const { SlashCommandBuilder } = require('discord.js');
const { text, v2Payload } = require('../../utils/components');
module.exports={
 data:new SlashCommandBuilder().setName('ping').setDescription('Check Oxy Controller response time'),
 async execute(i){
  const before=Date.now();
  await i.deferReply({flags:64});
  const elapsed=Date.now()-before;
  return i.editReply(v2Payload([{type:'text',value:text(`## Pong\n**Response:** ${elapsed}ms`)}],true));
 }
};
