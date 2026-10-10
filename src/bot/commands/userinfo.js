const { SlashCommandBuilder } = require('discord.js');
const { text, v2Payload } = require('../../utils/components');
module.exports={data:new SlashCommandBuilder().setName('userinfo').setDescription('Show information about a Discord user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(false)),async execute(i){const u=i.options.getUser('user')||i.user;return i.reply(v2Payload([{type:'text',value:text(`## ${u.username}\n**Mention:** ${u}\n**ID:** ${u.id}\n**Created:** <t:${Math.floor(u.createdTimestamp/1000)}:R>\n**Bot:** ${u.bot?'Yes':'No'}`)}],true));}};
