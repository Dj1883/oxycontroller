require('dotenv').config();
const path=require('node:path');
const { ShardingManager }=require('discord.js');
const api = require('./api/server');
const { startVerifier }=require('./services/shifts');

if(process.env.BOT_DISABLED!=='true'&&(!process.env.DISCORD_TOKEN||!process.env.DISCORD_CLIENT_ID)){console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.');process.exit(1);}

const per=Math.max(1,Number(process.env.SHARD_GUILDS_PER_SHARD||10));
let manager;
let scaling=false;
let previousGuildCount=0;

function desiredShards(totalGuilds){ return Math.max(1,Math.ceil(totalGuilds/per)); }
function buildManager(totalShards){
  return new ShardingManager(path.join(__dirname,'shard.js'),{
    token:process.env.DISCORD_TOKEN,
    totalShards,
    respawn:true
  });
}
function attachManagerEvents(m){
  m.on('shardCreate',shard=>{
    console.log(`Launching shard ${shard.id+1}`);
    shard.on('ready',()=>console.log(`Shard ${shard.id+1} gateway ready.`));
    shard.on('disconnect',()=>console.warn(`Shard ${shard.id+1} disconnected.`));
    shard.on('reconnecting',()=>console.log(`Shard ${shard.id+1} reconnecting.`));
  });
}
async function spawnManager(totalShards){
  manager=buildManager(totalShards);
  attachManagerEvents(manager);
  await manager.spawn({amount:totalShards,delay:7000,timeout:120000});
  global.__oxManagerShardCount=totalShards;
  console.log(`Running ${totalShards} shard(s). Target: 1 shard per ${per} servers.`);
}

async function stopManager(){
  if(!manager) return;
  const old=manager;
  try { await old.broadcastEval(c=>{ try { c.destroy(); } catch {} }); } catch {}
  await Promise.all([...old.shards.values()].map(s=>s.kill().catch(()=>{})));
  manager=null;
}

async function collectGuilds(){
  if(!manager || !manager.shards.size) return [];
  try {
    const lists=await manager.broadcastEval(c=>c.guilds.cache.map(g=>({id:g.id,name:g.name,shardId:g.shardId})));
    return lists.flat();
  } catch { return []; }
}
async function collectBotInfo(){
  if(!manager || !manager.shards.size) return null;

  try {
    const shardData = await manager.broadcastEval(c => ({
      id: c.shardId ?? 0,
      guilds: c.guilds.cache.size,
      members: c.guilds.cache.reduce((total, g) => total + Number(g.memberCount || 0), 0),
      ping: Number(c.ws?.ping ?? -1),
      ready: c.isReady(),
      user: c.user ? {
        id: c.user.id,
        tag: c.user.tag
      } : null
    }));

    const shards = shardData
      .sort((a,b) => a.id - b.id)
      .map(s => ({
        id: s.id,
        number: s.id + 1,
        guilds: Number(s.guilds || 0),
        members: Number(s.members || 0),
        ping: Number(s.ping ?? -1),
        ready: Boolean(s.ready),
        user: s.user || null
      }));

    const guilds = shards.reduce((total, s) => total + s.guilds, 0);
    const members = shards.reduce((total, s) => total + s.members, 0);

    global.__oxBotInfo = {
      ok: true,
      guilds,
      members,
      shards: shards.length,
      uptime: process.uptime(),
      updatedAt: new Date().toISOString(),
      shards
    };

    global.__oxManagerGuilds = guilds;
    global.__oxManagerShardCount = shards.length;

    return global.__oxBotInfo;
  } catch(e) {
    console.error('Bot info snapshot failed:', e.message);
    return global.__oxBotInfo || null;
  }
}

async function updatePresence(){
  if(!manager) return;
  try { await manager.broadcastEval(c=>{const id=c.shardId??0;const count=c.shard?.count??1;c.user.setPresence({status:'online',activities:[{name:`Shard ${id+1}/${count} • ${c.guilds.cache.size} servers`,type:3}]});}); } catch {}
}
async function updateShardCount(){
  if(scaling || !manager) return;
  scaling=true;
  try{
    const counts=await manager.fetchClientValues('guilds.cache.size');
    const total=counts.reduce((a,b)=>a+Number(b||0),0);
    global.__oxManagerGuilds=total;
    const desired=desiredShards(total);
    const current=manager.totalShards;
    const change=desired!==current;
    console.log(`Shard scaler check: ${total} guilds; ${current} shard(s) -> ${desired} desired shard(s).`);
    if(change){
      console.log(`Resharding: changing ${current} -> ${desired}. Discord will rebalance guilds across the new shard count.`);
      await stopManager();
      await spawnManager(desired);
      console.log(`Reshard complete. Guilds will now be distributed across ${desired} shard(s).`);
    }
    await updatePresence();
    const guilds=await collectGuilds();
    global.__oxGuilds=guilds;
    await collectBotInfo();
    previousGuildCount=total;
  }catch(e){console.error('Shard scaling check failed:',e.message);}
  finally{scaling=false;}
}

(async()=>{
  if(process.env.BOT_DISABLED==='true'){
    global.__oxBotInfo={ok:false,guilds:0,members:0,shards:0,uptime:process.uptime(),updatedAt:new Date().toISOString(),shards:[]};
    global.__oxManagerGuilds=0;
    global.__oxManagerShardCount=0;
    console.warn('BOT_DISABLED=true: Discord bot is offline; API and dashboard remain online.');
    return;
  }
  try{
    await spawnManager(1);
    setTimeout(updateShardCount,15000);

    // Shard scaling remains frequent so the bot can react to guild changes.
    setInterval(updateShardCount,Number(process.env.SHARD_SCALE_INTERVAL_MS||60000));

    // Bot Info snapshot refreshes every 8 minutes for the dashboard.
    setTimeout(() => collectBotInfo().catch(e => console.error('Initial bot info failed:', e.message)), 5000);
    setInterval(() => collectBotInfo().catch(e => console.error('Bot info refresh failed:', e.message)), 8 * 60 * 1000);

    startVerifier();
  }catch(e){console.error(e);process.exit(1);}
})();

process.on('SIGTERM',async()=>{console.log('SIGTERM received, shutting down.');try{await stopManager();await api.close();}finally{process.exit(0);}});
process.on('SIGINT',async()=>{console.log('SIGINT received, shutting down.');try{await stopManager();await api.close();}finally{process.exit(0);}});
