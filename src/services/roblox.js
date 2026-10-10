const axios=require('axios');
const crypto=require('node:crypto');
const client=axios.create({baseURL:'https://users.roblox.com',timeout:Number(process.env.ROBLOX_API_TIMEOUT_MS||10000),headers:{'User-Agent':'Oxy-Controller/0.4'}});
function hashCode(code){return crypto.createHash('sha256').update(String(code)).digest('hex');}
function makeCode(){return (process.env.ROBLOX_LINK_PREFIX||'OXCTRL-')+crypto.randomBytes(6).toString('hex').toUpperCase();}
async function findUserByUsername(username){const res=await client.post('/v1/usernames/users',{usernames:[username],excludeBannedUsers:false});const u=res.data?.data?.[0];if(!u)throw new Error('Roblox user could not be found.');return {id:Number(u.id),name:u.name,displayName:u.displayName};}
async function getUser(userId){return (await client.get(`/v1/users/${userId}`)).data;}
function extractCodes(description,prefix=process.env.ROBLOX_LINK_PREFIX||'OXCTRL-'){const re=new RegExp(`${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}[A-F0-9]{12}`,'gi');return String(description||'').match(re)||[];}
function hasCode(description,code){return String(description||'').toUpperCase().includes(String(code||'').toUpperCase());}
function findMatchingCode(description,hash,prefix){return extractCodes(description,prefix).some(code=>hashCode(code)===hash);}
module.exports={hashCode,makeCode,findUserByUsername,getUser,hasCode,findMatchingCode,extractCodes};
