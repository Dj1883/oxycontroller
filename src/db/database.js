const path=require('node:path');
const fs=require('node:fs');
const Database=require('better-sqlite3');
const { encryptSecret, decryptSecret }=require('../utils/secrets');

const dbPath=path.resolve(process.env.DATABASE_PATH||'./data/oxcontroller.db');
fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath);
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');
db.pragma('busy_timeout=5000');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
 guild_id TEXT PRIMARY KEY,
 oxford_api_key TEXT,
 admin_role_id TEXT,
 settings_json TEXT NOT NULL DEFAULT '{}',
 api_key_hash TEXT,
 api_key_created_at INTEGER,
 api_key_last_used_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
 discord_id TEXT PRIMARY KEY,
 roblox_user_id INTEGER UNIQUE,
 roblox_username TEXT,
 verification_code_hash TEXT,
 verification_code TEXT,
 verification_expires_at INTEGER,
 linked_at INTEGER,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 discord_id TEXT NOT NULL,
 roblox_user_id INTEGER NOT NULL,
 started_at INTEGER NOT NULL,
 ended_at INTEGER,
 verified_seconds INTEGER NOT NULL DEFAULT 0,
 last_check_at INTEGER,
 last_x REAL,
 last_y REAL,
 last_z REAL,
 last_server_id TEXT,
 last_status TEXT NOT NULL DEFAULT 'active',
 end_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts(guild_id,discord_id,ended_at);
CREATE INDEX IF NOT EXISTS idx_shifts_roblox ON shifts(roblox_user_id,ended_at);
CREATE TABLE IF NOT EXISTS staff_time_adjustments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 discord_id TEXT NOT NULL,
 seconds INTEGER NOT NULL,
 changed_by TEXT NOT NULL,
 reason TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_time_adjustments_user ON staff_time_adjustments(guild_id,discord_id,created_at DESC);
CREATE TABLE IF NOT EXISTS shift_checks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL,
 in_game INTEGER NOT NULL,
 moving INTEGER NOT NULL,
 distance REAL,
 server_id TEXT,
 reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_checks_shift_time ON shift_checks(shift_id,checked_at);
CREATE TABLE IF NOT EXISTS moderation_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 action TEXT NOT NULL,
 target_id TEXT NOT NULL,
 target_tag TEXT,
 moderator_id TEXT NOT NULL,
 moderator_tag TEXT,
 reason TEXT,
 duration_seconds INTEGER,
 details TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_cases_guild_time ON moderation_cases(guild_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_cases_target ON moderation_cases(guild_id,target_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_cases_moderator ON moderation_cases(guild_id,moderator_id,created_at DESC);
CREATE TABLE IF NOT EXISTS channel_locks (
 guild_id TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 previous_send_messages TEXT NOT NULL DEFAULT 'neutral',
 created_at INTEGER NOT NULL,
 PRIMARY KEY(guild_id,channel_id)
);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 channel_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'open',
 mode TEXT NOT NULL DEFAULT 'panel',
 anonymous INTEGER NOT NULL DEFAULT 0,
 claimed_by TEXT,
 locked INTEGER NOT NULL DEFAULT 0,
 priority TEXT NOT NULL DEFAULT 'normal',
 subject TEXT,
 answers_json TEXT NOT NULL DEFAULT '{}',
 closed_at INTEGER,
 closed_by TEXT,
 closed_reason TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_user_status ON tickets(guild_id,user_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 roblox_username TEXT,
 department TEXT,
 experience TEXT,
 motivation TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 reviewer_id TEXT,
 reviewer_reason TEXT,
 answers_json TEXT NOT NULL DEFAULT '{}',
 form_name TEXT NOT NULL DEFAULT 'Application',
 form_version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_guild_status ON applications(guild_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(guild_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS giveaways (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 message_id TEXT,
 host_id TEXT NOT NULL,
 prize TEXT NOT NULL,
 winner_count INTEGER NOT NULL DEFAULT 1,
 ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 participants_json TEXT NOT NULL DEFAULT '[]',
 winners_json TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways(status,ends_at);
CREATE TABLE IF NOT EXISTS suggestions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 channel_id TEXT,
 message_id TEXT,
 user_id TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 reviewer_id TEXT,
 review_reason TEXT,
 upvotes_json TEXT NOT NULL DEFAULT '[]',
 downvotes_json TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_guild_status ON suggestions(guild_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 slug TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'community',
 version INTEGER NOT NULL DEFAULT 1,
 source TEXT NOT NULL DEFAULT 'ai',
 status TEXT NOT NULL DEFAULT 'draft',
 created_by TEXT NOT NULL,
 creator_note TEXT,
 creator_slug TEXT,
 definition_json TEXT NOT NULL,
 prompt TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_creator ON templates(created_by,created_at DESC);
CREATE TABLE IF NOT EXISTS template_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 definition_json TEXT NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 change_log TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(template_id,version)
);
CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id,version DESC);
CREATE TABLE IF NOT EXISTS contributor_benefits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 discord_id TEXT NOT NULL,
 grant_type TEXT NOT NULL,
 reference_id TEXT,
 days INTEGER NOT NULL,
 granted_by TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contributor_benefits_user ON contributor_benefits(discord_id,ends_at DESC);
`);

for(const statement of [
 "ALTER TABLE templates ADD COLUMN creator_slug TEXT",
 "ALTER TABLE tickets ADD COLUMN mode TEXT NOT NULL DEFAULT 'panel'",
 "ALTER TABLE tickets ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0",
 'ALTER TABLE tickets ADD COLUMN claimed_by TEXT',
 "ALTER TABLE tickets ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
 "ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
 'ALTER TABLE tickets ADD COLUMN subject TEXT',
 "ALTER TABLE tickets ADD COLUMN answers_json TEXT NOT NULL DEFAULT '{}'",
 'ALTER TABLE tickets ADD COLUMN closed_reason TEXT',
 "ALTER TABLE applications ADD COLUMN answers_json TEXT NOT NULL DEFAULT '{}'",
 "ALTER TABLE applications ADD COLUMN form_name TEXT NOT NULL DEFAULT 'Application'",
 "ALTER TABLE applications ADD COLUMN form_version INTEGER NOT NULL DEFAULT 1"
]){try{db.exec(statement);}catch{}}

try {
  db.exec(`INSERT OR IGNORE INTO template_versions(template_id,version,definition_json,name,description,change_log,changed_by,created_at)
    SELECT id,version,definition_json,name,description,'Imported from existing template history',created_by,created_at
    FROM templates WHERE id NOT IN (SELECT template_id FROM template_versions)`);
} catch {}

function now(){return Date.now();}
function ensureGuild(guildId){let row=db.prepare('SELECT * FROM guild_config WHERE guild_id=?').get(String(guildId));if(row)return row;const ts=now();db.prepare('INSERT INTO guild_config(guild_id,created_at,updated_at) VALUES(?,?,?)').run(String(guildId),ts,ts);return db.prepare('SELECT * FROM guild_config WHERE guild_id=?').get(String(guildId));}
function getGuildConfig(guildId){const row=ensureGuild(guildId);return {...row,oxford_api_key:row.oxford_api_key?decryptSecret(row.oxford_api_key):null};}
function setGuildConfig(guildId,patch){const current=ensureGuild(guildId);const key=patch.oxford_api_key===undefined?current.oxford_api_key:(patch.oxford_api_key?encryptSecret(patch.oxford_api_key):null);const settings=patch.settings_json===undefined?current.settings_json:patch.settings_json;db.prepare('UPDATE guild_config SET oxford_api_key=?,admin_role_id=?,settings_json=?,updated_at=? WHERE guild_id=?').run(key,patch.admin_role_id===undefined?current.admin_role_id:patch.admin_role_id,settings,now(),guildId);return getGuildConfig(guildId);}
function setGuildApiKey(guildId,hash){ensureGuild(guildId);db.prepare('UPDATE guild_config SET api_key_hash=?,api_key_created_at=?,api_key_last_used_at=NULL,updated_at=? WHERE guild_id=?').run(hash,now(),now(),guildId);return getGuildConfig(guildId);}
function getGuildByApiKeyHash(hash){return db.prepare('SELECT * FROM guild_config WHERE api_key_hash=? LIMIT 1').get(hash);}
function revokeGuildApiKey(guildId){ensureGuild(guildId);db.prepare('UPDATE guild_config SET api_key_hash=NULL,api_key_created_at=NULL,api_key_last_used_at=NULL,updated_at=? WHERE guild_id=?').run(now(),guildId);return getGuildConfig(guildId);}
function touchGuildApiKey(guildId){db.prepare('UPDATE guild_config SET api_key_last_used_at=? WHERE guild_id=?').run(now(),guildId);}
function getOxfordKey(guildId){return getGuildConfig(guildId).oxford_api_key||process.env.OXFORD_API_KEY||null;}
function createModerationCase(data){const r=db.prepare('INSERT INTO moderation_cases(guild_id,action,target_id,target_tag,moderator_id,moderator_tag,reason,duration_seconds,details,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(String(data.guildId),data.action,String(data.targetId),data.targetTag||null,String(data.moderatorId),data.moderatorTag||null,data.reason||null,data.durationSeconds||null,data.details||null,data.createdAt||now());return db.prepare('SELECT * FROM moderation_cases WHERE id=?').get(r.lastInsertRowid);}
function getModerationActionCount(guildId,moderatorId){return db.prepare('SELECT COUNT(*) count FROM moderation_cases WHERE guild_id=? AND moderator_id=?').get(String(guildId),String(moderatorId)).count;}
function getModerationRecipientCount(guildId,targetId){return db.prepare('SELECT COUNT(*) count FROM moderation_cases WHERE guild_id=? AND target_id=?').get(String(guildId),String(targetId)).count;}
function getModerationCases(guildId,targetId,limit=25){const n=Math.min(100,Math.max(1,Number(limit)));return targetId?db.prepare('SELECT * FROM moderation_cases WHERE guild_id=? AND target_id=? ORDER BY created_at DESC LIMIT ?').all(String(guildId),String(targetId),n):db.prepare('SELECT * FROM moderation_cases WHERE guild_id=? ORDER BY created_at DESC LIMIT ?').all(String(guildId),n);}
function getModerationCase(id){return db.prepare('SELECT * FROM moderation_cases WHERE id=?').get(Number(id));}function getAllModerationCases(limit=50){const n=Math.min(100,Math.max(1,Number(limit)));return db.prepare('SELECT * FROM moderation_cases ORDER BY created_at DESC LIMIT ?').all(n);}
function setChannelLock(guildId,channelId,previousSendMessages){db.prepare('INSERT INTO channel_locks(guild_id,channel_id,previous_send_messages,created_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,channel_id) DO UPDATE SET previous_send_messages=excluded.previous_send_messages,created_at=excluded.created_at').run(String(guildId),String(channelId),previousSendMessages||'neutral',now());}
function getChannelLock(guildId,channelId){return db.prepare('SELECT * FROM channel_locks WHERE guild_id=? AND channel_id=?').get(String(guildId),String(channelId));}
function deleteChannelLock(guildId,channelId){db.prepare('DELETE FROM channel_locks WHERE guild_id=? AND channel_id=?').run(String(guildId),String(channelId));}
function getAdminRoleId(guildId){return getGuildConfig(guildId).admin_role_id||process.env.OXFORD_ADMIN_ROLE_ID||null;}
function upsertAccount(discordId,data){const ts=now();const existing=db.prepare('SELECT * FROM accounts WHERE discord_id=?').get(discordId);const vals={roblox_user_id:data.roblox_user_id??existing?.roblox_user_id??null,roblox_username:data.roblox_username??existing?.roblox_username??null,verification_code_hash:data.verification_code_hash??existing?.verification_code_hash??null,verification_code:data.verification_code??null,verification_expires_at:data.verification_expires_at??existing?.verification_expires_at??null,linked_at:data.linked_at??existing?.linked_at??null};if(existing)db.prepare('UPDATE accounts SET roblox_user_id=?,roblox_username=?,verification_code_hash=?,verification_code=?,verification_expires_at=?,linked_at=?,updated_at=? WHERE discord_id=?').run(vals.roblox_user_id,vals.roblox_username,vals.verification_code_hash,vals.verification_code,vals.verification_expires_at,vals.linked_at,ts,discordId);else db.prepare('INSERT INTO accounts(discord_id,roblox_user_id,roblox_username,verification_code_hash,verification_code,verification_expires_at,linked_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(discordId,vals.roblox_user_id,vals.roblox_username,vals.verification_code_hash,null,vals.verification_expires_at,vals.linked_at,ts);return db.prepare('SELECT * FROM accounts WHERE discord_id=?').get(discordId);}
function getAccount(discordId){return db.prepare('SELECT * FROM accounts WHERE discord_id=?').get(discordId);}
function getAccountByRobloxId(robloxId){return db.prepare('SELECT * FROM accounts WHERE roblox_user_id=?').get(Number(robloxId));}
function clearAccount(discordId){db.prepare('DELETE FROM accounts WHERE discord_id=?').run(discordId);}
function startShift(guildId,discordId,robloxUserId,sample={}){const active=db.prepare('SELECT * FROM shifts WHERE guild_id=? AND discord_id=? AND ended_at IS NULL').get(guildId,discordId);if(active)return active;const ts=now();const info=db.prepare("INSERT INTO shifts(guild_id,discord_id,roblox_user_id,started_at,last_check_at,last_x,last_y,last_z,last_server_id,last_status) VALUES(?,?,?,?,?,?,?,?,?,'active')").run(guildId,discordId,Number(robloxUserId),ts,ts,sample.x??null,sample.y??null,sample.z??null,sample.serverId??null);return db.prepare('SELECT * FROM shifts WHERE id=?').get(info.lastInsertRowid);}
function getActiveShift(guildId,discordId){return db.prepare('SELECT * FROM shifts WHERE guild_id=? AND discord_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(guildId,discordId);}
function listActiveShifts(){return db.prepare('SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at ASC').all();}
function recordShiftCheck(shiftId,result){const ts=result.checkedAt||now();db.prepare('INSERT INTO shift_checks(shift_id,checked_at,in_game,moving,distance,server_id,reason) VALUES(?,?,?,?,?,?,?)').run(shiftId,ts,result.inGame?1:0,result.moving?1:0,result.distance??null,result.serverId??null,result.reason??null);db.prepare('UPDATE shifts SET last_check_at=?,last_x=?,last_y=?,last_z=?,last_server_id=?,last_status=?,verified_seconds=verified_seconds+? WHERE id=?').run(ts,result.x??null,result.y??null,result.z??null,result.serverId??null,result.status||'active',Math.max(0,Number(result.verifiedSeconds||0)),shiftId);}
function endShift(id,reason='manual'){const shift=db.prepare('SELECT * FROM shifts WHERE id=?').get(id);if(!shift)return null;const ts=now();db.prepare('UPDATE shifts SET ended_at=?,end_reason=?,last_status=? WHERE id=?').run(ts,reason,'ended',id);return db.prepare('SELECT * FROM shifts WHERE id=?').get(id);}
function getShiftChecks(shiftId,limit=20){return db.prepare('SELECT * FROM shift_checks WHERE shift_id=? ORDER BY checked_at DESC LIMIT ?').all(shiftId,Math.max(1,Math.min(100,Number(limit))));}function getStaffShiftStats(guildId,discordId){
 const shiftsRow=db.prepare('SELECT COALESCE(SUM(verified_seconds),0) verifiedSeconds, COUNT(*) completedShifts, MAX(COALESCE(ended_at,started_at)) lastShiftAt FROM shifts WHERE guild_id=? AND discord_id=?').get(String(guildId),String(discordId));
 const adj=db.prepare('SELECT COALESCE(SUM(seconds),0) adjustmentSeconds FROM staff_time_adjustments WHERE guild_id=? AND discord_id=?').get(String(guildId),String(discordId));
 const verifiedSeconds=Number(shiftsRow?.verifiedSeconds||0);
 const adjustmentSeconds=Number(adj?.adjustmentSeconds||0);
 return {verifiedSeconds,adjustmentSeconds,totalSeconds:Math.max(0,verifiedSeconds+adjustmentSeconds),completedShifts:Number(shiftsRow?.completedShifts||0),lastShiftAt:shiftsRow?.lastShiftAt?Number(shiftsRow.lastShiftAt):null};
}
function adjustStaffTime(guildId,discordId,seconds,changedBy,reason=null){
 const ts=now();
 const r=db.prepare('INSERT INTO staff_time_adjustments(guild_id,discord_id,seconds,changed_by,reason,created_at) VALUES(?,?,?,?,?,?)').run(String(guildId),String(discordId),Math.round(Number(seconds)),String(changedBy),reason||null,ts);
 return db.prepare('SELECT * FROM staff_time_adjustments WHERE id=?').get(r.lastInsertRowid);
}

function createTicket(guildId,userId,channelId,data={}){const ts=now();const r=db.prepare('INSERT INTO tickets(guild_id,user_id,channel_id,status,mode,anonymous,claimed_by,subject,answers_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(String(guildId),String(userId),String(channelId),'open',data.mode||'panel',data.anonymous?1:0,data.claimedBy||null,data.subject||null,JSON.stringify(data.answers||{}),ts);return db.prepare('SELECT * FROM tickets WHERE id=?').get(r.lastInsertRowid);}
function getOpenTicketForUser(guildId,userId){return db.prepare('SELECT * FROM tickets WHERE guild_id=? AND user_id=? AND status=? ORDER BY created_at DESC LIMIT 1').get(String(guildId),String(userId),'open');}
function getTicketByChannel(channelId){return db.prepare('SELECT * FROM tickets WHERE channel_id=? LIMIT 1').get(String(channelId));}
function getTicket(id){return db.prepare('SELECT * FROM tickets WHERE id=?').get(Number(id));}
function closeTicket(id,closedBy,reason='Closed'){db.prepare('UPDATE tickets SET status=?,closed_at=?,closed_by=?,closed_reason=? WHERE id=?').run('closed',now(),String(closedBy),reason||null,Number(id));return getTicket(id);}
function reopenTicket(id){db.prepare('UPDATE tickets SET status=?,closed_at=NULL,closed_by=NULL,closed_reason=NULL WHERE id=?').run('open',Number(id));return getTicket(id);}
function claimTicket(id,userId=null){db.prepare('UPDATE tickets SET claimed_by=? WHERE id=?').run(userId?String(userId):null,Number(id));return getTicket(id);}
function setTicketLocked(id,locked){db.prepare('UPDATE tickets SET locked=? WHERE id=?').run(locked?1:0,Number(id));return getTicket(id);}
function setTicketPriority(id,priority){db.prepare('UPDATE tickets SET priority=? WHERE id=?').run(String(priority||'normal'),Number(id));return getTicket(id);}
function listOpenTickets(guildId,limit=25){return db.prepare('SELECT * FROM tickets WHERE guild_id=? AND status=? ORDER BY created_at DESC LIMIT ?').all(String(guildId),'open',Math.min(100,Math.max(1,Number(limit))));}
function createApplication(data){const ts=now();const answers=JSON.stringify(data.answers||{});const r=db.prepare('INSERT INTO applications(guild_id,user_id,roblox_username,department,experience,motivation,status,answers_json,form_name,form_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(String(data.guildId),String(data.userId),data.robloxUsername||null,data.department||null,data.experience||null,data.motivation||null,'pending',answers,data.formName||'Application',Number(data.formVersion||1),ts,ts);return db.prepare('SELECT * FROM applications WHERE id=?').get(r.lastInsertRowid);}
function getLatestApplication(guildId,userId){return db.prepare('SELECT * FROM applications WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1').get(String(guildId),String(userId));}
function getPendingApplications(guildId,limit=25){return db.prepare('SELECT * FROM applications WHERE guild_id=? AND status=? ORDER BY created_at ASC LIMIT ?').all(String(guildId),'pending',Math.min(100,Math.max(1,Number(limit))));}
function getApplication(id){return db.prepare('SELECT * FROM applications WHERE id=?').get(Number(id));}
function updateApplicationStatus(id,status,reviewerId,reason){db.prepare('UPDATE applications SET status=?,reviewer_id=?,reviewer_reason=?,updated_at=? WHERE id=?').run(String(status),String(reviewerId),reason||null,now(),Number(id));return getApplication(id);}
function createGiveaway(data){const ts=now();const r=db.prepare('INSERT INTO giveaways(guild_id,channel_id,message_id,host_id,prize,winner_count,ends_at,status,participants_json,winners_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(String(data.guildId),String(data.channelId),data.messageId?String(data.messageId):null,String(data.hostId),String(data.prize),Math.max(1,Math.min(20,Number(data.winnerCount||1))),Number(data.endsAt),'active','[]','[]',ts);return db.prepare('SELECT * FROM giveaways WHERE id=?').get(r.lastInsertRowid);}
function getGiveaway(id){return db.prepare('SELECT * FROM giveaways WHERE id=?').get(Number(id));}
function setGiveawayMessage(id,messageId){db.prepare('UPDATE giveaways SET message_id=? WHERE id=?').run(String(messageId),Number(id));return getGiveaway(id);}
function toggleGiveawayParticipant(id,userId){const g=getGiveaway(id);if(!g)return null;const list=JSON.parse(g.participants_json||'[]');const idx=list.indexOf(String(userId));if(idx>=0)list.splice(idx,1);else list.push(String(userId));db.prepare('UPDATE giveaways SET participants_json=? WHERE id=?').run(JSON.stringify(list),Number(id));return {giveaway:getGiveaway(id),joined:idx<0};}
function getEndingGiveaways(ts=now(),limit=50){return db.prepare('SELECT * FROM giveaways WHERE status=? AND ends_at<=? ORDER BY ends_at ASC LIMIT ?').all('active',Number(ts),limit);}
function finishGiveaway(id,winners){db.prepare('UPDATE giveaways SET status=?,winners_json=? WHERE id=?').run('ended',JSON.stringify(winners.map(String)),Number(id));return getGiveaway(id);}
function createSuggestion(data){const ts=now();const r=db.prepare('INSERT INTO suggestions(guild_id,channel_id,message_id,user_id,title,description,status,reviewer_id,review_reason,upvotes_json,downvotes_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(String(data.guildId),data.channelId?String(data.channelId):null,data.messageId?String(data.messageId):null,String(data.userId),String(data.title),String(data.description),'pending',null,null,'[]','[]',ts,ts);return db.prepare('SELECT * FROM suggestions WHERE id=?').get(r.lastInsertRowid);}
function getSuggestion(id){return db.prepare('SELECT * FROM suggestions WHERE id=?').get(Number(id));}
function setSuggestionMessage(id,messageId,channelId){db.prepare('UPDATE suggestions SET message_id=?,channel_id=?,updated_at=? WHERE id=?').run(String(messageId),String(channelId),now(),Number(id));return getSuggestion(id);}
function voteSuggestion(id,userId,type){const s=getSuggestion(id);if(!s)return null;let up=JSON.parse(s.upvotes_json||'[]');let down=JSON.parse(s.downvotes_json||'[]');const uid=String(userId);up=up.filter(x=>x!==uid);down=down.filter(x=>x!==uid);if(type==='up')up.push(uid);if(type==='down')down.push(uid);db.prepare('UPDATE suggestions SET upvotes_json=?,downvotes_json=?,updated_at=? WHERE id=?').run(JSON.stringify([...new Set(up)]),JSON.stringify([...new Set(down)]),now(),Number(id));return getSuggestion(id);}
function reviewSuggestion(id,status,reviewerId,reason){db.prepare('UPDATE suggestions SET status=?,reviewer_id=?,review_reason=?,updated_at=? WHERE id=?').run(String(status),String(reviewerId),reason||null,now(),Number(id));return getSuggestion(id);}
function createTemplate(data){const ts=now();const version=Number(data.version||1);const definition=JSON.stringify(data.definition||{});const r=db.prepare('INSERT INTO templates(slug,name,description,category,version,source,status,created_by,creator_note,creator_slug,definition_json,prompt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(String(data.slug),String(data.name),String(data.description),String(data.category||'community'),version,String(data.source||'ai'),String(data.status||'draft'),String(data.createdBy),data.creatorNote||null,data.creatorSlug||null,definition,data.prompt||null,ts,ts);const id=Number(r.lastInsertRowid);db.prepare('INSERT INTO template_versions(template_id,version,definition_json,name,description,change_log,changed_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,version,definition,String(data.name),String(data.description),'Template created',String(data.createdBy),ts);return getTemplate(id);}
function listTemplates(status=null,limit=50){const n=Math.min(100,Math.max(1,Number(limit)));return status?db.prepare('SELECT * FROM templates WHERE status=? ORDER BY created_at DESC LIMIT ?').all(String(status),n):db.prepare('SELECT * FROM templates ORDER BY created_at DESC LIMIT ?').all(n);}
function listTemplatesByCreator(creatorId,limit=50){return db.prepare('SELECT * FROM templates WHERE created_by=? ORDER BY updated_at DESC LIMIT ?').all(String(creatorId),Math.min(100,Math.max(1,Number(limit))));}
function countPrivateTemplates(creatorId){return Number(db.prepare("SELECT COUNT(*) count FROM templates WHERE created_by=? AND status='private'").get(String(creatorId)).count||0);}
function getTemplate(id){return db.prepare('SELECT * FROM templates WHERE id=?').get(Number(id));}
function updateTemplateStatus(id,status){db.prepare('UPDATE templates SET status=?,updated_at=? WHERE id=?').run(String(status),now(),Number(id));return getTemplate(id);}
function updateTemplate(id,data,changedBy,changeLog){const current=getTemplate(id);if(!current)return null;const version=Number(current.version||1)+1;const definition=JSON.stringify(data.definition||JSON.parse(current.definition_json||'{}'));const ts=now();db.prepare('UPDATE templates SET name=?,description=?,category=?,version=?,definition_json=?,updated_at=? WHERE id=?').run(String(data.name??current.name),String(data.description??current.description),String(data.category??current.category),version,definition,ts,Number(id));db.prepare('INSERT INTO template_versions(template_id,version,definition_json,name,description,change_log,changed_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(Number(id),version,definition,String(data.name??current.name),String(data.description??current.description),String(changeLog||'Template updated'),String(changedBy),ts);return getTemplate(id);}
function listTemplateVersions(templateId,limit=50){return db.prepare('SELECT id,template_id,version,name,description,change_log,changed_by,created_at FROM template_versions WHERE template_id=? ORDER BY version DESC LIMIT ?').all(Number(templateId),Math.min(100,Math.max(1,Number(limit))));}
function getTemplateVersion(templateId,version){return db.prepare('SELECT * FROM template_versions WHERE template_id=? AND version=?').get(Number(templateId),Number(version));}
function restoreTemplateVersion(templateId,version,changedBy){const v=getTemplateVersion(templateId,version);if(!v)return null;return updateTemplate(templateId,{name:v.name,description:v.description,definition:JSON.parse(v.definition_json||'{}')},changedBy,`Restored version ${version}`);}
function grantContributorDays(discordId,days,grantType,grantedBy,referenceId=null){const ts=now();const existing=db.prepare('SELECT MAX(ends_at) ends_at FROM contributor_benefits WHERE discord_id=?').get(String(discordId));const starts=Math.max(ts,Number(existing?.ends_at||0));const ends=starts+Math.max(1,Number(days))*86400000;const r=db.prepare('INSERT INTO contributor_benefits(discord_id,grant_type,reference_id,days,granted_by,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?,?)').run(String(discordId),String(grantType),referenceId?String(referenceId):null,Number(days),String(grantedBy),starts,ends,ts);return db.prepare('SELECT * FROM contributor_benefits WHERE id=?').get(r.lastInsertRowid);}
function getContributorBenefit(discordId){return db.prepare('SELECT MAX(ends_at) ends_at, SUM(days) days FROM contributor_benefits WHERE discord_id=? AND ends_at>?').get(String(discordId),now());}
function approveTemplate(id,reviewerId){const t=getTemplate(id);if(!t)return null;if(t.source!=='community'||t.status!=='pending')return t;updateTemplateStatus(id,'published');grantContributorDays(t.created_by,3,'template',reviewerId,String(t.id));return getTemplate(id);}

module.exports={db,ensureGuild,getGuildConfig,setGuildConfig,setGuildApiKey,getGuildByApiKeyHash,revokeGuildApiKey,touchGuildApiKey,getOxfordKey,getAdminRoleId,createModerationCase,getModerationActionCount,getModerationRecipientCount,getModerationCases,getModerationCase,setChannelLock,getChannelLock,deleteChannelLock,upsertAccount,getAccount,getAccountByRobloxId,clearAccount,startShift,getActiveShift,listActiveShifts,recordShiftCheck,endShift,getShiftChecks,getStaffShiftStats,adjustStaffTime,createTicket,getOpenTicketForUser,getTicketByChannel,getTicket,closeTicket,reopenTicket,claimTicket,setTicketLocked,setTicketPriority,listOpenTickets,createApplication,getLatestApplication,getPendingApplications,getApplication,updateApplicationStatus,createGiveaway,getGiveaway,setGiveawayMessage,toggleGiveawayParticipant,getEndingGiveaways,finishGiveaway,createSuggestion,getSuggestion,setSuggestionMessage,voteSuggestion,reviewSuggestion,createTemplate,listTemplates,listTemplatesByCreator,countPrivateTemplates,getTemplate,updateTemplateStatus,updateTemplate,listTemplateVersions,getTemplateVersion,restoreTemplateVersion,grantContributorDays,getContributorBenefit,approveTemplate};
