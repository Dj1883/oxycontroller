const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const { text, separator, button, row, v2Payload } = require('../../utils/components');

function buildPage(page=0, shardInfo={ id:0, count:1 }) {
  const pages=[
    ['Core', ['/help — Show this help menu','/about — About Oxy Controller','/settings — Server settings','/ping — Check response time','/serverinfo — Information about this Discord server','/website — Website integration']],
    ['Moderation', ['/warn — Warn a member','/timeout — Timeout a member','/untimeout — Remove a timeout','/kick — Kick a member','/ban — Ban a member','/unban — Unban a user','/softban — Softban a member']],
    ['Moderation tools', ['/warnings — View active warnings','/clear-warnings — Clear active warnings','/note — Add a staff note','/notes — View staff notes','/lock — Lock a channel','/unlock — Unlock a channel','/slowmode — Configure channel slowmode','/moderation — Configure moderation logs and action roles']],
    ['Staff & support', ['/manage-staff — Manage staff profiles, roles and shift time','/promote — Promote a staff member','/demote — Demote a staff member','/shift — Shift management and movement verification','/tickets — Ticket and modmail control panel','/applications — Applications and manager review','/suggestions — Submit and review suggestions']],
    ['More tools', ['/music — Full music player and queue controls','/giveaway — Create and manage giveaways','/reactionroles — Configure self-assignable roles','/templates — Browse published server templates','/clear — Bulk delete recent messages','/userinfo — User information','/avatar — Display a user avatar','/health — Bot health and diagnostics','/config — Advanced server configuration','/oxford — Oxford Response controls','/roblox — Roblox account linking and profile tools']],
  ];
  const [title, lines]=pages[page] || pages[0];
  return v2Payload([
    {type:'text',value:text(`## Oxy Controller\n**${title}**\n\n${lines.join('\n')}`)},
    {type:'separator',value:separator()},
    {type:'row',value:row([
      button('help:prev', '← Previous', ButtonStyle.Secondary, page===0),
      button('help:next', 'Next →', ButtonStyle.Secondary, page===pages.length-1)
    ])}
  ], true);
}

module.exports = {
  data:new SlashCommandBuilder().setName('help').setDescription('Browse Oxy Controller commands and tools'),
  async execute(i) { i.client.helpPage = i.client.helpPage || new Map(); i.client.helpPage.set(i.user.id,0); return i.reply(buildPage(0,{id:i.guild?.shardId??0,count:i.client.shard?.count ?? i.client.ws.shards.size})); },
  page:buildPage
};
