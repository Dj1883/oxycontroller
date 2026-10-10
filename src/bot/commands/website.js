const { SlashCommandBuilder, ButtonStyle }=require('discord.js');
const { text, separator, row, button, v2Payload }=require('../../utils/components');
const { websiteUrl, dashboardUrl, websiteMessage }=require('../../utils/branding');
module.exports={
  data:new SlashCommandBuilder().setName('website').setDescription('Open Oxy website integration'),
  async execute(i){
    const site=websiteUrl() || 'Website URL not configured';
    const dashboard=dashboardUrl() || 'Dashboard URL not configured';
    const status=websiteMessage();
    return i.reply(v2Payload([
      {type:'text',value:text(`## 🌐 Oxy Website Integration\n\n### ${status}\n\nThe Oxy website integration is being prepared. This panel will connect your Discord server to the Oxy web dashboard, website tools and future web-based features once released.\n\n**Website:** ${site}\n**Dashboard:** ${dashboard}`)},
      {type:'separator',value:separator()},
      {type:'row',value:row([button('website:coming',status,ButtonStyle.Secondary,true)])}
    ],{ephemeral:true}));
  }
};
