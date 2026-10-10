require('dotenv').config();
const { makeClient }=require('./bot/client');
const client=makeClient();
client.login(process.env.DISCORD_TOKEN).catch(e=>{console.error('Discord login failed:',e);process.exit(1);});
