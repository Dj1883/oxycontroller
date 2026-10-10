const axios = require('axios');
const { getOxfordKey } = require('../db/database');

const timeout = Number(process.env.OXFORD_API_TIMEOUT_MS || 10000);
const baseURL = process.env.OXFORD_API_BASE || 'https://api.oxfd.re/v1';

function createClient(guildId) {
  const key = getOxfordKey(guildId);
  if (!key) {
    const e = new Error('Oxford Response is not configured for this Discord server.');
    e.code = 'OXFORD_NOT_CONFIGURED';
    e.status = 503;
    throw e;
  }
  return axios.create({
    baseURL,
    timeout,
    headers: { 'server-key': key, Accept: 'application/json', 'User-Agent': 'Oxy-Controller/0.4' }
  });
}

async function request(guildId, method, path, data) {
  try {
    return (await createClient(guildId).request({ method, url: path, data })).data;
  } catch (e) {
    const response = e.response;
    const err = new Error(
      response?.data?.message ||
      response?.data?.error ||
      (e.code === 'ECONNABORTED' ? 'Oxford Response timed out.' : e.message)
    );
    err.status = response?.status;
    err.code = response?.data?.code || e.code;
    throw err;
  }
}

async function server(g) { return request(g,'GET','/server'); }
async function players(g) { return request(g,'GET','/server/players'); }
async function queue(g) { return request(g,'GET','/server/queue'); }
async function list(g,n) { return request(g,'GET',`/server/${n}`); }
async function command(g,c) { return request(g,'POST','/server/command',{command:c}); }

function cleanText(s) { return String(s ?? '').replace(/<[^>]*>/g,''); }
function playerArray(data) { return Array.isArray(data) ? data : (data?.players || data?.data || []); }
function findPlayer(data, robloxUserId, username) {
  const wanted=String(robloxUserId);
  const name=String(username||'').toLowerCase();
  return playerArray(data).find(p =>
    String(p.UserId ?? p.userId ?? p.RobloxUserId ?? p.robloxUserId ?? '')===wanted ||
    String(p.Username ?? p.username ?? p.Name ?? '').toLowerCase()===name
  ) || null;
}
function extractPosition(player) {
  if (!player || typeof player !== 'object') return null;
  const candidates=[player.Position,player.position,player.Coordinates,player.coordinates,player.Location,player.location,player.CFrame,player.cframe];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length>=3 && c.every(v=>Number.isFinite(Number(v)))) return {x:Number(c[0]),y:Number(c[1]),z:Number(c[2])};
    if (c && typeof c==='object') {
      const x=c.x??c.X??c.positionX??c.PositionX, y=c.y??c.Y??c.positionY??c.PositionY, z=c.z??c.Z??c.positionZ??c.PositionZ;
      if ([x,y,z].every(v=>Number.isFinite(Number(v)))) return {x:Number(x),y:Number(y),z:Number(z)};
    }
  }
  const x=player.x??player.X, y=player.y??player.Y, z=player.z??player.Z;
  return [x,y,z].every(v=>Number.isFinite(Number(v))) ? {x:Number(x),y:Number(y),z:Number(z)} : null;
}
module.exports={server,players,queue,robberies:g=>list(g,'robberies'),radio:g=>list(g,'radiocalls'),modcalls:g=>list(g,'modcalls'),vehicles:g=>list(g,'vehicles'),bans:g=>list(g,'bans'),killlogs:g=>list(g,'killlogs'),commandlogs:g=>list(g,'commandlogs'),joinlogs:g=>list(g,'joinlogs'),command,cleanText,playerArray,findPlayer,extractPosition};
