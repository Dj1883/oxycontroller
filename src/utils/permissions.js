const { PermissionFlagsBits }=require('discord.js');
const db=require('../db/database');

function settings(guildId){const cfg=db.getGuildConfig(guildId);try{return JSON.parse(cfg.settings_json||'{}');}catch{return {};}}
function hierarchy(guildId){const s=settings(guildId);const h=Array.isArray(s.staffHierarchy)?s.staffHierarchy:[];return h.filter(x=>x&&x.roleId).sort((a,b)=>Number(a.level||0)-Number(b.level||0));}
function getStaffLevel(interaction){
 if(!interaction.guild||!interaction.member)return 0;
 if(interaction.guild.ownerId===interaction.user.id)return 100;
 if(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))return 95;
 let level=0;
 const roles=interaction.member.roles?.cache;
 for(const item of hierarchy(interaction.guild.id)) if(roles?.has(item.roleId)) level=Math.max(level,Number(item.level||0));
 const managerRoleId=settings(interaction.guild.id).applications?.managerRoleId;
 if(managerRoleId){const manager=interaction.guild.roles.cache.get(managerRoleId);if(manager&&interaction.member.roles?.highest?.position>=manager.position)level=Math.max(level,80);}
 return level;
}
function hasStaffLevel(interaction,required){return getStaffLevel(interaction)>=Number(required);}
function isGuildAdmin(interaction){return hasStaffLevel(interaction,60)||Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));}
module.exports={settings,hierarchy,getStaffLevel,hasStaffLevel,isGuildAdmin};
