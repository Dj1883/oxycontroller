const ox=require('./oxford');
const {getAccount,getActiveShift,startShift,listActiveShifts,recordShiftCheck,endShift}=require('../db/database');

const intervalMs=Math.max(30000,Number(process.env.SHIFT_CHECK_INTERVAL_MS||180000));
const minMovement=Math.max(0,Number(process.env.SHIFT_MIN_MOVEMENT||5));
function distance(a,b){if(!a||!b)return null;return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2);}

async function samplePlayer(shift){
  const data=await ox.players(shift.guild_id);
  const account=getAccount(shift.discord_id);
  const player=ox.findPlayer(data,shift.roblox_user_id,account?.roblox_username);
  if(!player)return {inGame:false,moving:false,reason:'not_in_game',status:'paused',verifiedSeconds:0};

  const pos=ox.extractPosition(player);
  const serverId=player.ServerId??player.serverId??player.JobId??player.jobId??null;
  if(!pos)return {inGame:true,moving:false,reason:'position_unavailable',status:'unverified',serverId,verifiedSeconds:0};

  const previous = Number.isFinite(Number(shift.last_x)) && Number.isFinite(Number(shift.last_y)) && Number.isFinite(Number(shift.last_z))
    ? {x:Number(shift.last_x),y:Number(shift.last_y),z:Number(shift.last_z)} : null;
  const d=distance(previous,pos);
  const moving=d !== null && d>=minMovement;
  return {inGame:true,moving,distance:d,x:pos.x,y:pos.y,z:pos.z,serverId,reason:previous?(moving?'moving':'stationary'):'first_sample',status:moving?'active':'unverified',verifiedSeconds:moving?Math.round(intervalMs/1000):0};
}

let running=false;
let timer=null;
async function verifyOne(shift){
  try{const result=await samplePlayer(shift);recordShiftCheck(shift.id,result);return {shift,result};}
  catch(e){const result={inGame:false,moving:false,reason:'verification_error',status:'error',verifiedSeconds:0};recordShiftCheck(shift.id,result);return {shift,result,error:e};}
}
async function verifyAll(){
  if(running)return;
  running=true;
  try {
    for(const shift of listActiveShifts()) await verifyOne(shift);
  } finally { running=false; }
}
function startVerifier(){stopVerifier();timer=setInterval(()=>verifyAll().catch(e=>console.error('Shift verification failed:',e)),intervalMs);return timer;}
function stopVerifier(){if(timer)clearInterval(timer);timer=null;}
async function start(guildId,discordId){
  const account=getAccount(discordId);
  if(!account?.roblox_user_id||!account?.linked_at)throw new Error('Link your Roblox account first with `/roblox`.');
  if(getActiveShift(guildId,discordId))throw new Error('You already have an active shift in this server.');
  const data=await ox.players(guildId);
  const player=ox.findPlayer(data,account.roblox_user_id,account.roblox_username);
  if(!player)throw new Error('You must be in an Oxford Response server before starting a shift.');
  const pos=ox.extractPosition(player);
  if(process.env.SHIFT_REQUIRE_MOVEMENT==='true'&&!pos)throw new Error('Oxford Response did not provide a usable player position, so movement cannot be verified.');
  return startShift(guildId,discordId,account.roblox_user_id,pos?{...pos,serverId:player.ServerId??player.serverId??null}:{});
}
function end(guildId,discordId,reason='manual'){const active=getActiveShift(guildId,discordId);return active?endShift(active.id,reason):null;}
function status(guildId,discordId){const active=getActiveShift(guildId,discordId);return active?{active,elapsed:Math.floor((Date.now()-active.started_at)/1000),verified:active.verified_seconds}:null;}
module.exports={start,end,status,verifyAll,startVerifier,stopVerifier,intervalMs,minMovement};
