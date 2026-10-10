const crypto=require('node:crypto');
const db=require('../db/database');
function hashApiKey(key){return crypto.createHash('sha256').update(key).digest('hex');}
function auth(requiredScope='read'){
  return (req,res,next)=>{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return res.status(401).json({error:'Missing bearer token.',code:'MISSING_API_KEY'});
    if(!/^oxc_[A-Za-z0-9_-]{32,}$/.test(token))return res.status(403).json({error:'Invalid server API key.',code:'INVALID_API_KEY'});
    const guild=db.getGuildByApiKeyHash(hashApiKey(token));
    if(!guild)return res.status(403).json({error:'Invalid or revoked server API key.',code:'INVALID_API_KEY'});
    db.touchGuildApiKey(guild.guild_id);
    req.apiKey=token;req.guildId=guild.guild_id;req.guild=guild;req.apiScopes=new Set(['read','command','config']);
    if(req.params.guildId&&String(req.params.guildId)!==String(guild.guild_id))return res.status(403).json({error:'This API key does not belong to this Discord server.',code:'GUILD_MISMATCH'});
    if(!req.apiScopes.has(requiredScope))return res.status(403).json({error:'API key does not have the required scope.',code:'INSUFFICIENT_SCOPE'});
    next();
  };
}
function rateLimit(windowMs,max){
  const hits=new Map();
  return (req,res,next)=>{
    const now=Date.now();const key=req.ip||'unknown';let e=hits.get(key);
    if(!e||now-e.started>windowMs)e={started:now,count:0},hits.set(key,e);
    e.count++;
    if(e.count>max)return res.status(429).json({error:'Rate limit exceeded.',code:'RATE_LIMITED',retry_after_ms:Math.max(0,windowMs-(now-e.started))});
    next();
  };
}
module.exports={auth,rateLimit,hashApiKey};
