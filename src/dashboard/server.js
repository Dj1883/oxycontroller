const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { URLSearchParams } = require('node:url');
const db = require('../db/database');
const { websiteUrl, dashboardUrl, publicApiUrl, websiteMessages, dashboardMessages, rotationMs, redirectUri } = require('../utils/branding');

const sessions = new Map();
const oauthStates = new Map();
const DASHBOARD_COOKIE = 'oxy_dashboard_session';

function owners() {
  return new Set(
    String(process.env.BOT_OWNER_IDS || process.env.BOT_OWNER_ID || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  );
}

function safeEquals(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function sessionCookie(res, token, clear = false) {
  const maxAge = clear ? 0 : Math.floor(Number(process.env.DASHBOARD_SESSION_TTL_MS || 86400000) / 1000);
  res.setHeader('Set-Cookie', `${DASHBOARD_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

function getSession(req) {
  const header = String(req.headers.cookie || '');
  const match = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${DASHBOARD_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(DASHBOARD_COOKIE.length + 1);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireSession(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Dashboard authentication required.', code: 'AUTH_REQUIRED' });
  req.dashboardSession = session;
  next();
}

function managedGuild(session, guildId) {
  const guild = session.guilds.find(g => String(g.id) === String(guildId));
  if (!guild) return null;
  const permissions = BigInt(String(guild.permissions || '0'));
  const administrator = (permissions & 0x8n) === 0x8n;
  const manageGuild = (permissions & 0x20n) === 0x20n;
  if (!guild.owner && !administrator && !manageGuild) return null;
  return guild;
}

async function discordToken(code) {
  const params = new URLSearchParams({
    client_id: process.env.DASHBOARD_CLIENT_ID || process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DASHBOARD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri()
  });
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Discord OAuth token exchange failed.');
  return data;
}

async function discordGet(pathname, accessToken) {
  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `Discord API request failed (${response.status}).`);
  return data;
}

function attachDashboard(app) {
  if (String(process.env.DASHBOARD_ENABLED || 'true') !== 'true') return;
  const publicDir = path.resolve(__dirname, '../../dashboard');
  app.use('/dashboard', require('express').static(publicDir, { extensions: ['html'] }));

  app.get('/', (req, res) => res.redirect('/dashboard/'));
  app.get('/dashboard', (req, res) => res.redirect('/dashboard/'));

  app.get('/auth/discord', (req, res) => {
    if (!process.env.DASHBOARD_CLIENT_SECRET) return res.status(503).send('Dashboard OAuth is not configured. Set DASHBOARD_CLIENT_SECRET in .env.');
    const state = crypto.randomBytes(24).toString('hex');
    oauthStates.set(state, { createdAt: Date.now() });
    const query = new URLSearchParams({
      client_id: process.env.DASHBOARD_CLIENT_ID || process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'identify guilds',
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();
      const stateRow = oauthStates.get(state);
      oauthStates.delete(state);
      if (!code) return res.redirect('/dashboard/?auth=cancelled');
      if (!stateRow || Date.now() - stateRow.createdAt > 10 * 60 * 1000) return res.redirect('/dashboard/?auth=error&message=Invalid%20OAuth%20state');
      const token = await discordToken(code);
      const [user, guilds] = await Promise.all([
        discordGet('/users/@me', token.access_token),
        discordGet('/users/@me/guilds', token.access_token)
      ]);
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, {
        user,
        guilds,
        accessToken: token.access_token,
        expiresAt: Date.now() + Number(process.env.DASHBOARD_SESSION_TTL_MS || 86400000)
      });
      sessionCookie(res, sessionId);
      res.redirect('/dashboard/');
    } catch (error) {
      console.error('[Dashboard] OAuth callback failed:', error.message);
      res.redirect(`/dashboard/?auth=error&message=${encodeURIComponent(error.message)}`);
    }
  });

  app.post('/auth/logout', (req, res) => {
    const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${DASHBOARD_COOKIE}=`));
    if (cookie) sessions.delete(cookie.slice(DASHBOARD_COOKIE.length + 1));
    sessionCookie(res, '', true);
    res.json({ ok: true });
  });

  app.get('/dashboard/api/public-config', (req, res) => {
    res.json({
      ok: true,
      websiteUrl: websiteUrl(),
      dashboardUrl: dashboardUrl(),
      publicApiUrl: publicApiUrl(),
      websiteMessages: websiteMessages(),
      dashboardMessages: dashboardMessages(),
      websiteRotationMs: rotationMs('WEBSITE_MESSAGE_ROTATION_MS'),
      dashboardRotationMs: rotationMs('DASHBOARD_MESSAGE_ROTATION_MS')
    });
  });

  app.get('/auth/me', requireSession, (req, res) => {
    const session = req.dashboardSession;
    const guilds = session.guilds.filter(g => managedGuild(session, g.id)).map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      owner: Boolean(g.owner),
      permissions: g.permissions
    }));
    res.json({ ok: true, user: { id: session.user.id, username: session.user.username, global_name: session.user.global_name, avatar: session.user.avatar }, guilds, developer: owners().has(String(session.user.id)) });
  });

  app.get('/dashboard/api/overview', requireSession, (req, res) => {
    const info = global.__oxBotInfo || {}; res.json({ ok: true, bot: { online: Boolean(info.ok), guilds: Number(info.guilds || global.__oxManagerGuilds || 0), members: Number(info.members || 0), uptime: process.uptime() } });
  });

  app.get('/dashboard/api/guilds/:guildId/config', requireSession, (req, res) => {
    if (!managedGuild(req.dashboardSession, req.params.guildId)) return res.status(403).json({ error: 'You do not manage this Discord server.' });
    const c = db.getGuildConfig(req.params.guildId);
    res.json({
      guildId: req.params.guildId,
      oxfordConfigured: Boolean(c.oxford_api_key || process.env.OXFORD_API_KEY),
      adminRoleId: c.admin_role_id || '',
      apiKeyConfigured: Boolean(c.api_key_hash),
      updatedAt: c.updated_at
    });
  });

  app.put('/dashboard/api/guilds/:guildId/config/admin-role', requireSession, (req, res) => {
    const guild = managedGuild(req.dashboardSession, req.params.guildId);
    if (!guild) return res.status(403).json({ error: 'You do not manage this Discord server.' });
    const roleId = String(req.body?.role_id || '').trim();
    if (roleId && !/^\d{5,30}$/.test(roleId)) return res.status(400).json({ error: 'Invalid Discord role ID.' });
    db.setGuildConfig(req.params.guildId, { admin_role_id: roleId || null });
    res.json({ ok: true, adminRoleId: roleId });
  });

  app.put('/dashboard/api/guilds/:guildId/config/oxford-key', requireSession, (req, res) => {
    const guild = managedGuild(req.dashboardSession, req.params.guildId);
    if (!guild) return res.status(403).json({ error: 'You do not manage this Discord server.' });
    const key = String(req.body?.api_key || '').trim();
    if (!key || key.length > 500) return res.status(400).json({ error: 'Invalid Oxford Response server key.' });
    db.setGuildConfig(req.params.guildId, { oxford_api_key: key });
    res.json({ ok: true, configured: true });
  });

  app.delete('/dashboard/api/guilds/:guildId/config/oxford-key', requireSession, (req, res) => {
    const guild = managedGuild(req.dashboardSession, req.params.guildId);
    if (!guild) return res.status(403).json({ error: 'You do not manage this Discord server.' });
    db.setGuildConfig(req.params.guildId, { oxford_api_key: null });
    res.json({ ok: true, configured: Boolean(process.env.OXFORD_API_KEY) });
  });


  // Per-server dashboard data. Every endpoint checks the selected guild against
  // the Discord OAuth session before reading or changing its configuration.
  function dashboardGuild(req, res) {
    const guild = managedGuild(req.dashboardSession, req.params.guildId);
    if (!guild) {
      res.status(403).json({ error: 'You do not manage this Discord server.' });
      return null;
    }
    return guild;
  }

  app.get('/dashboard/api/guilds/:guildId/overview', requireSession, (req, res) => {
    const guild = dashboardGuild(req, res);
    if (!guild) return;
    const cases = db.getModerationCases(req.params.guildId, null, 10);
    const shifts = db.listActiveShifts().filter(x => String(x.guild_id) === String(req.params.guildId));
    let settings = {};
    try { settings = JSON.parse(db.getGuildConfig(req.params.guildId).settings_json || '{}'); } catch {}
    res.json({
      ok: true,
      guild: { id: guild.id, name: guild.name, icon: guild.icon || null },
      oxfordConfigured: Boolean(db.getOxfordKey(req.params.guildId)),
      adminRoleConfigured: Boolean(db.getAdminRoleId(req.params.guildId)),
      activeShifts: shifts.length,
      recentModeration: cases.map(x => ({
        id: x.id, action: x.action, targetId: x.target_id, targetTag: x.target_tag,
        moderatorId: x.moderator_id, moderatorTag: x.moderator_tag,
        reason: x.reason, createdAt: x.created_at
      })),
      automodEnabled: settings.automod?.enabled !== false,
      updatedAt: db.getGuildConfig(req.params.guildId).updated_at
    });
  });

  app.get('/dashboard/api/guilds/:guildId/moderation', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
    const cases = db.getModerationCases(req.params.guildId, null, limit);
    res.json({ ok: true, cases: cases.map(x => ({
      id: x.id, action: x.action, targetId: x.target_id, targetTag: x.target_tag,
      moderatorId: x.moderator_id, moderatorTag: x.moderator_tag, reason: x.reason,
      durationSeconds: x.duration_seconds, details: x.details, createdAt: x.created_at
    })) });
  });

  app.get('/dashboard/api/guilds/:guildId/automod', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const automod = require('../services/automod');
    res.json({ ok: true, config: automod.loadGuildConfig(req.params.guildId), defaults: automod.DEFAULTS });
  });

  app.put('/dashboard/api/guilds/:guildId/automod', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const body = req.body || {};
    const automod = require('../services/automod');
    const current = db.getGuildConfig(req.params.guildId);
    let settings = {};
    try { settings = JSON.parse(current.settings_json || '{}'); } catch {}
    const before = automod.loadGuildConfig(req.params.guildId);
    const incoming = body.config;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'A valid AutoMod configuration is required.' });
    }
    const next = JSON.parse(JSON.stringify(before));
    for (const key of ['enabled', 'deleteMessages', 'logActions', 'bypassAdmins']) {
      if (typeof incoming[key] === 'boolean') next[key] = incoming[key];
    }
    if (incoming.modules && typeof incoming.modules === 'object') {
      for (const key of Object.keys(next.modules)) {
        if (typeof incoming.modules[key] === 'boolean') next.modules[key] = incoming.modules[key];
      }
    }
    if (incoming.thresholds && typeof incoming.thresholds === 'object') {
      const bounds = {
        spamMessages: [2, 30], spamWindowMs: [1000, 60000], duplicate: [2, 10],
        mentions: [2, 50], capsRatio: [0.5, 1], capsMinimum: [4, 100],
        emojis: [3, 100]
      };
      for (const [key, [min, max]] of Object.entries(bounds)) {
        if (incoming.thresholds[key] === undefined) continue;
        const n = Number(incoming.thresholds[key]);
        if (!Number.isFinite(n) || n < min || n > max) {
          return res.status(400).json({ error: `AutoMod threshold ${key} must be between ${min} and ${max}.` });
        }
        next.thresholds[key] = n;
      }
    }
    if (incoming.escalation && typeof incoming.escalation === 'object') {
      if (typeof incoming.escalation.enabled === 'boolean') next.escalation.enabled = incoming.escalation.enabled;
      if (incoming.escalation.threshold !== undefined) {
        const n = Number(incoming.escalation.threshold);
        if (!Number.isInteger(n) || n < 2 || n > 20) return res.status(400).json({ error: 'Escalation threshold must be between 2 and 20.' });
        next.escalation.threshold = n;
      }
      if (incoming.escalation.action && ['warn', 'timeout', 'kick', 'ban'].includes(incoming.escalation.action)) next.escalation.action = incoming.escalation.action;
      if (incoming.escalation.duration !== undefined) {
        const n = Number(incoming.escalation.duration);
        if (!Number.isInteger(n) || n < 30 || n > 2419200) return res.status(400).json({ error: 'Escalation duration must be between 30 and 2419200 seconds.' });
        next.escalation.duration = n;
      }
    }
    settings.automod = next;
    db.setGuildConfig(req.params.guildId, { settings_json: JSON.stringify(settings) });
    res.json({ ok: true, config: next });
  });

  app.get('/dashboard/api/guilds/:guildId/oxford/status', requireSession, async (req, res) => {
    if (!dashboardGuild(req, res)) return;
    try {
      const ox = require('../services/oxford');
      const [server, players] = await Promise.all([
        ox.server(req.params.guildId),
        ox.players(req.params.guildId)
      ]);
      const list = ox.playerArray(players);
      res.json({
        ok: true,
        server: {
          name: ox.cleanText(server?.StyledName || server?.Name || 'Oxford Response'),
          description: ox.cleanText(server?.Description || ''),
          currentPlayers: server?.CurrentPlayers ?? list.length,
          maxPlayers: server?.MaxPlayers ?? null,
          weather: server?.Weather ?? null,
          timeOfDay: server?.TimeOfDay ?? null,
          joinCode: server?.JoinCode ?? null
        },
        players: list.slice(0, 100).map(p => ({
          name: String(p.DisplayName || p.Username || p.Name || 'Unknown').slice(0, 100),
          username: String(p.Username || p.Name || '').slice(0, 100),
          team: String(p.Team || 'No team').slice(0, 100),
          callsign: String(p.Callsign || '').slice(0, 40)
        })),
        playerCount: list.length
      });
    } catch (error) {
      res.status(error.status || 502).json({
        error: error.code === 'OXFORD_NOT_CONFIGURED'
          ? 'Oxford Response is not configured for this server.'
          : error.message || 'Oxford Response is currently unavailable.',
        code: error.code || 'OXFORD_ERROR'
      });
    }
  });


  app.get('/dashboard/api/guilds/:guildId/messages', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const row = db.getGuildConfig(req.params.guildId);
    let settings = {};
    try { settings = JSON.parse(row.settings_json || '{}'); } catch {}
    const messages = settings.messages || {};
    res.json({
      ok: true,
      messages: {
        welcome: { enabled: Boolean(messages.welcome?.enabled), channelId: messages.welcome?.channelId || '', content: String(messages.welcome?.content || 'Welcome to {server}, {user}!') },
        leave: { enabled: Boolean(messages.leave?.enabled), channelId: messages.leave?.channelId || '', content: String(messages.leave?.content || '{user} has left the server.') },
        moderationLogChannelId: messages.moderationLogChannelId || '',
        commandLogChannelId: messages.commandLogChannelId || '',
        joinLogChannelId: messages.joinLogChannelId || '',
        ticketLogChannelId: messages.ticketLogChannelId || '',
        applicationLogChannelId: messages.applicationLogChannelId || '',
        suggestionLogChannelId: messages.suggestionLogChannelId || ''
      },
      updatedAt: row.updated_at
    });
  });

  app.put('/dashboard/api/guilds/:guildId/messages', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const incoming = req.body?.messages;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return res.status(400).json({ error: 'A valid messages configuration is required.' });
    const validId = value => value == null || value === '' || /^\d{5,30}$/.test(String(value));
    for (const key of ['welcome', 'leave']) {
      const item = incoming[key];
      if (!item || typeof item !== 'object') return res.status(400).json({ error: `Missing ${key} message configuration.` });
      if (typeof item.enabled !== 'boolean') return res.status(400).json({ error: `Invalid ${key} enabled value.` });
      if (!validId(item.channelId)) return res.status(400).json({ error: `Invalid ${key} channel ID.` });
      if (String(item.content || '').length > 1000) return res.status(400).json({ error: `${key} message must be 1000 characters or fewer.` });
      if (item.enabled && !item.channelId) return res.status(400).json({ error: `Choose a channel for the ${key} message.` });
    }
    const logKeys = ['moderationLogChannelId','commandLogChannelId','joinLogChannelId','ticketLogChannelId','applicationLogChannelId','suggestionLogChannelId'];
    for (const key of logKeys) if (!validId(incoming[key])) return res.status(400).json({ error: `Invalid channel ID for ${key}.` });
    const row = db.getGuildConfig(req.params.guildId);
    let settings = {};
    try { settings = JSON.parse(row.settings_json || '{}'); } catch {}
    settings.messages = {
      ...(settings.messages || {}),
      welcome: { enabled: incoming.welcome.enabled, channelId: incoming.welcome.channelId || null, content: String(incoming.welcome.content || '').trim() || 'Welcome to {server}, {user}!' },
      leave: { enabled: incoming.leave.enabled, channelId: incoming.leave.channelId || null, content: String(incoming.leave.content || '').trim() || '{user} has left the server.' },
      ...Object.fromEntries(logKeys.map(key => [key, incoming[key] || null]))
    };
    db.setGuildConfig(req.params.guildId, { settings_json: JSON.stringify(settings) });
    res.json({ ok: true });
  });

  app.get('/dashboard/api/guilds/:guildId/shifts', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const shifts = db.listActiveShifts().filter(s => String(s.guild_id) === String(req.params.guildId));
    res.json({ ok: true, shifts: shifts.map(s => ({
      id: s.id, discordId: s.discord_id, robloxUserId: s.roblox_user_id,
      startedAt: s.started_at, verifiedSeconds: s.verified_seconds || 0,
      lastCheckAt: s.last_check_at, lastStatus: s.last_status || 'active'
    })) });
  });


  app.get('/dashboard/api/guilds/:guildId/tickets', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const tickets = db.listOpenTickets(req.params.guildId, 50);
    res.json({ ok: true, tickets: tickets.map(t => ({
      id: t.id, userId: t.user_id, channelId: t.channel_id, status: t.status,
      mode: t.mode, subject: t.subject || '', priority: t.priority || 'normal',
      claimedBy: t.claimed_by || null, createdAt: t.created_at
    })) });
  });

  app.get('/dashboard/api/guilds/:guildId/applications', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const applications = db.getPendingApplications(req.params.guildId, 50);
    res.json({ ok: true, applications: applications.map(a => ({
      id: a.id, userId: a.user_id, robloxUsername: a.roblox_username || '',
      department: a.department || '', formName: a.form_name || 'Application',
      answers: (() => { try { return JSON.parse(a.answers_json || '{}'); } catch { return {}; } })(),
      createdAt: a.created_at
    })) });
  });

  app.put('/dashboard/api/guilds/:guildId/applications/:applicationId', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const id = Number(req.params.applicationId);
    const application = db.getApplication(id);
    if (!application || String(application.guild_id) !== String(req.params.guildId)) return res.status(404).json({ error: 'Application not found for this server.' });
    const status = String(req.body?.status || '');
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    const updated = db.updateApplicationStatus(id, status, req.dashboardSession.user.id, reason);
    res.json({ ok: true, application: { id: updated.id, status: updated.status } });
  });

  app.get('/dashboard/api/guilds/:guildId/suggestions', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const suggestions = db.db.prepare('SELECT id,user_id,title,description,status,reviewer_id,review_reason,upvotes_json,downvotes_json,created_at,updated_at FROM suggestions WHERE guild_id=? ORDER BY created_at DESC LIMIT 50').all(String(req.params.guildId));
    res.json({ ok: true, suggestions: suggestions.map(s => ({
      id: s.id, userId: s.user_id, title: s.title, description: s.description,
      status: s.status, reviewerId: s.reviewer_id, reviewReason: s.review_reason,
      upvotes: (() => { try { return JSON.parse(s.upvotes_json || '[]').length; } catch { return 0; } })(),
      downvotes: (() => { try { return JSON.parse(s.downvotes_json || '[]').length; } catch { return 0; } })(),
      createdAt: s.created_at
    })) });
  });

  app.put('/dashboard/api/guilds/:guildId/suggestions/:suggestionId', requireSession, (req, res) => {
    if (!dashboardGuild(req, res)) return;
    const id = Number(req.params.suggestionId);
    const suggestion = db.getSuggestion(id);
    if (!suggestion || String(suggestion.guild_id) !== String(req.params.guildId)) return res.status(404).json({ error: 'Suggestion not found for this server.' });
    const status = String(req.body?.status || '');
    if (!['approved', 'rejected', 'considered'].includes(status)) return res.status(400).json({ error: 'Invalid suggestion status.' });
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    const updated = db.reviewSuggestion(id, status, req.dashboardSession.user.id, reason);
    res.json({ ok: true, suggestion: { id: updated.id, status: updated.status } });
  });

  function requireDeveloper(req,res){if(!owners().has(String(req.dashboardSession?.user?.id||''))){res.status(403).json({error:'Developer access required.'});return false;}return true;}
  function botFilesDirectory(){return path.resolve(process.env.BOT_FILES_DIR||path.join(process.cwd(),'data','bot-files'));}
  function safeBotFileName(value){const name=String(value||'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/.test(name)||name.startsWith('.'))return null;return name;}
  app.get('/dashboard/api/dev/bot',requireSession,(req,res)=>{if(!requireDeveloper(req,res))return;res.json(global.__oxBotControl?.status?.()||{ok:true,online:Boolean(global.__oxBotInfo?.ok),disabled:!global.__oxBotInfo?.ok,shards:Number(global.__oxManagerShardCount||0)});});
  app.post('/dashboard/api/dev/bot',requireSession,async(req,res)=>{if(!requireDeveloper(req,res))return;const action=String(req.body?.action||'');if(!['start','stop'].includes(action))return res.status(400).json({error:'Action must be start or stop.'});try{const control=global.__oxBotControl;if(!control)return res.status(503).json({error:'Bot controls are unavailable in this process.'});const status=action==='start'?await control.start():await control.stop();res.json({ok:true,...status});}catch(e){res.status(500).json({error:e.message||'Bot control failed.'});}});
  app.get('/dashboard/api/dev/files',requireSession,async(req,res)=>{if(!requireDeveloper(req,res))return;try{const dir=botFilesDirectory();await fs.promises.mkdir(dir,{recursive:true});const entries=await fs.promises.readdir(dir,{withFileTypes:true});const files=[];for(const entry of entries){if(!entry.isFile())continue;const st=await fs.promises.stat(path.join(dir,entry.name));files.push({name:entry.name,size:st.size,modifiedAt:st.mtime.toISOString()});}files.sort((a,b)=>a.name.localeCompare(b.name));res.json({ok:true,files});}catch(e){res.status(500).json({error:'Unable to list bot files.'});}});
  app.put('/dashboard/api/dev/files',requireSession,require('express').raw({type:'application/octet-stream',limit:'10mb'}),async(req,res)=>{if(!requireDeveloper(req,res))return;const name=safeBotFileName(req.query.name);if(!name)return res.status(400).json({error:'Invalid filename. Use a simple filename without folders or hidden-file prefixes.'});if(!Buffer.isBuffer(req.body)||req.body.length===0)return res.status(400).json({error:'Choose a non-empty file.'});try{const dir=botFilesDirectory();await fs.promises.mkdir(dir,{recursive:true});await fs.promises.writeFile(path.join(dir,name),req.body);res.json({ok:true,name,size:req.body.length});}catch(e){res.status(500).json({error:'Unable to save uploaded file.'});}});
  app.delete('/dashboard/api/dev/files/:name',requireSession,async(req,res)=>{if(!requireDeveloper(req,res))return;const name=safeBotFileName(req.params.name);if(!name)return res.status(400).json({error:'Invalid filename.'});try{await fs.promises.unlink(path.join(botFilesDirectory(),name));res.json({ok:true,name});}catch(e){res.status(e.code==='ENOENT'?404:500).json({error:e.code==='ENOENT'?'File not found.':'Unable to delete file.'});}});

  app.get('/dashboard/api/dev/overview', requireSession, (req, res) => {
    if (!owners().has(String(req.dashboardSession.user.id))) return res.status(403).json({ error: 'Developer access required.' });
    const info = global.__oxBotInfo || {};
    const bot = global.__oxBotControl?.status?.() || {online:Boolean(info.ok),disabled:!info.ok,shards:Number(global.__oxManagerShardCount||0)};
    res.json({ ok: true, version: require('../../package.json').version, guilds: info.guilds || 0, members: info.members || 0, uptime: process.uptime(), bot });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  }, 60_000).unref?.();
}

module.exports = { attachDashboard };
