const { SlashCommandBuilder } = require('discord.js');
const { text, v2Payload } = require('../../utils/components');
module.exports={
 data:new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this Discord server'),
 async execute(i){const g=i.guild;return i.reply(v2Payload([{type:'text',value:text(`## ${g.name}\n**ID:** ${g.id}\n**Members:** ${g.memberCount}\n**Owner:** <@${g.ownerId}>\n**Created:** <t:${Math.floor(g.createdTimestamp/1000)}:R>\n**Shard:** ${(g.shardId??0)+1}/${i.client.shard?.count??1}`)}],true));}
};
