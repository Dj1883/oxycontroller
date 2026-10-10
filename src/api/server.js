require('dotenv').config();
const express=require('express');
const cors=require('cors');
const {auth,rateLimit}=require('./middleware');
const db=require('../db/database');
const ox=require('../services/oxford');
const { attachDashboard }=require('../dashboard/server');
const { attachWebsiteApi }=require('./website');

const app=express();
const host=process.env.API_HOST||'127.0.0.1';
const port=Number(process.env.API_PORT||4000);
app.disable('x-powered-by');
if(process.env.API_TRUST_PROXY==='true')app.set('trust proxy',1);
const origins=String(process.env.API_CORS_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({origin:origins.length?origins:false}));
app.use(express.json({limit:'1mb'}));
attachDashboard(app);
attachWebsiteApi(app);
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');next();});

const APP_VERSION=require('../../package.json').version;
app.get('/health',(req,res)=>res.json({ok:true,service:'oxy-controller-api',version:APP_VERSION,time:new Date().toISOString()}));
app.get('/v1/health',(req,res)=>res.json({ok:true,service:'oxy-controller-api',version:APP_VERSION,time:new Date().toISOString()}));
app.use('/v1',rateLimit(Number(process.env.API_RATE_LIMIT_WINDOW_MS||60000),Number(process.env.API_RATE_LIMIT_MAX||120)));

app.get('/v1/status',auth('read'),(req,res)=>res.json({ok:true,version:APP_VERSION,guilds:Number(global.__oxManagerGuilds||0),shards:Number(global.__oxManagerShardCount||1),uptime:process.uptime(),time:new Date().toISOString()}));
app.get('/v1/guilds',auth('read'),(req,res)=>res.json({guilds:global.__oxGuilds||[]}));
app.get('/v1/bot/info',auth('read'),(req,res)=>res.json(global.__oxBotInfo||{ok:false,guilds:0,members:0,shards:1,uptime:process.uptime(),updatedAt:null,shards:[]}));
app.get('/v1/bot/shards',auth('read'),(req,res)=>{const info=global.__oxBotInfo;res.json({ok:Boolean(info),shards:info?.shards||[],total:Number(info?.shards?.length||global.__oxManagerShardCount||1),updatedAt:info?.updatedAt||null});});

const dataRoutes={status:g=>ox.server(g),players:g=>ox.players(g),queue:g=>ox.queue(g),robberies:g=>ox.robberies(g),radio:g=>ox.radio(g),modcalls:g=>ox.modcalls(g),vehicles:g=>ox.vehicles(g),bans:g=>ox.bans(g),killlogs:g=>ox.killlogs(g),commandlogs:g=>ox.commandlogs(g),joinlogs:g=>ox.joinlogs(g)};
for(const [name,fn] of Object.entries(dataRoutes)){
  app.get(`/v1/guilds/:guildId/${name}`,auth('read'),async(req,res)=>{try{res.json(await fn(req.params.guildId));}catch(e){res.status(e.status||502).json({error:e.message,code:e.code||'OXFORD_ERROR'});}});
}
app.get('/v1/guilds/:guildId/config',auth('read'),(req,res)=>{const c=db.getGuildConfig(req.params.guildId);res.json({guild_id:req.params.guildId,configured:Boolean(c.oxford_api_key||process.env.OXFORD_API_KEY),admin_role_configured:Boolean(c.admin_role_id||process.env.OXFORD_ADMIN_ROLE_ID),api_key_created_at:c.api_key_created_at||null,api_key_last_used_at:c.api_key_last_used_at||null,updated_at:c.updated_at});});
app.get('/v1/guilds/:guildId/shifts',auth('read'),(req,res)=>res.json(db.listActiveShifts().filter(s=>s.guild_id===req.params.guildId)));
app.put('/v1/guilds/:guildId/config/admin-role',auth('config'),(req,res)=>{const roleId=String(req.body?.role_id||'').trim();if(!/^\\d{5,30}$/.test(roleId))return res.status(400).json({error:'Invalid role ID.'});const c=db.setGuildConfig(req.params.guildId,{admin_role_id:roleId});res.json({guild_id:req.params.guildId,admin_role_id:c.admin_role_id});});
app.delete('/v1/guilds/:guildId/config/admin-role',auth('config'),(req,res)=>{const c=db.setGuildConfig(req.params.guildId,{admin_role_id:null});res.json({guild_id:req.params.guildId,admin_role_id:c.admin_role_id});});
app.put('/v1/guilds/:guildId/config/oxford-key',auth('config'),(req,res)=>{const key=String(req.body?.api_key||'').trim();if(!key||key.length>500)return res.status(400).json({error:'Invalid API key.'});db.setGuildConfig(req.params.guildId,{oxford_api_key:key});res.json({guild_id:req.params.guildId,configured:true});});
app.delete('/v1/guilds/:guildId/config/oxford-key',auth('config'),(req,res)=>{db.setGuildConfig(req.params.guildId,{oxford_api_key:null});res.json({guild_id:req.params.guildId,configured:Boolean(process.env.OXFORD_API_KEY)});});

app.post('/v1/guilds/:guildId/command',auth('command'),rateLimit(Number(process.env.API_COMMAND_RATE_LIMIT_WINDOW_MS||60000),Number(process.env.API_COMMAND_RATE_LIMIT_MAX||5)),async(req,res)=>{
  const cmd=String(req.body?.command||'').trim();
  if(!cmd||cmd.length>500)return res.status(400).json({error:'Invalid command.'});
  const allow=String(process.env.OXFORD_COMMAND_ALLOWLIST||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!allow.length)return res.status(403).json({error:'Command API is disabled until OXFORD_COMMAND_ALLOWLIST is configured.'});
  const allowed=allow.some(prefix=>cmd.startsWith(prefix));
  if(!allowed)return res.status(403).json({error:'Command rejected by API allowlist.'});
  try{res.json({ok:true,data:await ox.command(req.params.guildId,cmd)});}catch(e){res.status(e.status||502).json({error:e.message,code:e.code||'OXFORD_COMMAND_ERROR'});}
});

app.use((err,req,res,next)=>{console.error('API error:',err);if(res.headersSent)return next(err);res.status(500).json({error:'Internal server error',code:'INTERNAL_ERROR'});});
const server=app.listen(port,host,()=>console.log(`Ox Controller API listening on http://${host}:${port}`));
function close(){return new Promise(resolve=>server.close(()=>resolve()));}
module.exports={app,server,close};
