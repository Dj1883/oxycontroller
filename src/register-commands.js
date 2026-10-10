require('dotenv').config();
const { REST, Routes }=require('discord.js');
const { loadCommands }=require('./bot/commandLoader');
(async()=>{const r=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);const body=[...loadCommands().values()].map(c=>c.data.toJSON());const route=process.env.DISCORD_GUILD_ID?Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID):Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);await r.put(route,{body});console.log(`${body.length} commands registered ${process.env.DISCORD_GUILD_ID?'to development guild':'globally'}.`);})().catch(e=>{console.error(e);process.exit(1);});
