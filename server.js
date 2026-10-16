const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

// Load and self-heal the mounted .env BEFORE runtime constants are captured.
// This means every container restart can add newly-required configuration keys
// without overwriting anything that already exists.
const ENV_FILE = process.env.ENV_FILE || '/data/env/.env';
function bootstrapParseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}
function bootstrapUpsertEnv(text, key, value, comment) {
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  return text + prefix + `\n# ${comment}\n${key}=${value}\n`;
}
function bootstrapEnvironment() {
  let text = '';
  try { text = fs.readFileSync(ENV_FILE, 'utf8'); } catch { text = ''; }
  let parsed = bootstrapParseEnv(text);
  const defaults = [
    ['PORT', process.env.PORT || '8091', 'Admin HTTP port.'],
    ['ADMIN_USERNAME', process.env.ADMIN_USERNAME || 'Life3760', 'Owner/admin username.'],
    ['ADMIN_PASSWORD', process.env.ADMIN_PASSWORD || '', 'Initial owner password; account passwords are stored as scrypt hashes after setup.'],
    ['GUIDE_DIR', process.env.GUIDE_DIR || '/data/guides', 'Guide content directory.'],
    ['DOC_DIR', process.env.DOC_DIR || '/data/docs', 'Documentation content directory.'],
    ['CHANGELOG_DIR', process.env.CHANGELOG_DIR || '/data/changelog', 'Changelog content directory.'],
    ['APP_DATA_DIR', process.env.APP_DATA_DIR || '/data/app', 'Admin application data directory.'],
    ['NGINX_LOG', process.env.NGINX_LOG || '/data/nginx/access.log', 'Nginx access log path.'],
    ['AI_API_KEY', process.env.AI_API_KEY || '', 'AI provider API key.'],
    ['XAI_API_KEY', process.env.XAI_API_KEY || '', 'Optional xAI API key.'],
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY || '', 'Optional OpenAI API key.'],
    ['AI_MODEL', process.env.AI_MODEL || (process.env.XAI_API_KEY ? 'grok-4-1-fast-reasoning' : 'gpt-4o-mini'), 'AI model used by the writing tools.'],
    ['AI_BASE_URL', process.env.AI_BASE_URL || (process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1'), 'OpenAI-compatible AI API base URL.'],
    ['LOCKDOWN_WEBHOOK_URL', process.env.LOCKDOWN_WEBHOOK_URL || '', 'Discord webhook used for emergency lockdown notifications.'],
    ['BOT_SOURCE_HOST_DIR', process.env.BOT_SOURCE_HOST_DIR || '', 'Optional absolute VPS path for the real bot source checkout; recreate the admin container after changing this mount.'],
    ['API_HEALTH_URL', process.env.API_HEALTH_URL || 'http://oxcontroller-fresh:4000/', 'Internal endpoint used by the management health check.'],
    ['PUBLIC_SITE_HEALTH_URL', process.env.PUBLIC_SITE_HEALTH_URL || 'http://oxy-info-site:8080/', 'Internal endpoint used by the public information site health check.'],
  ];
  let changed = false;
  for (const [key, value, comment] of defaults) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      text = bootstrapUpsertEnv(text, key, value, comment);
      changed = true;
    }
  }
  // Treat the installer placeholder as missing and generate the real secret.
  const currentSecret = parsed.ADMIN_SESSION_SECRET || '';
  if (!currentSecret || /^CHANGE_ME(?:_TO_A_LONG_RANDOM_VALUE)?$/i.test(currentSecret)) {
    const generated = crypto.randomBytes(48).toString('base64url');
    text = bootstrapUpsertEnv(text, 'ADMIN_SESSION_SECRET', generated, 'Cryptographically-random secret used for admin session security.');
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
    if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, `${ENV_FILE}.backup-${Date.now()}`);
    fs.writeFileSync(ENV_FILE, text.endsWith('\n') ? text : text + '\n', 'utf8');
    console.log('[env] Added or repaired missing configuration keys.');
  }
  parsed = bootstrapParseEnv(text);
  for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
  return { text, parsed, changed };
}
const BOOTSTRAP_ENV = bootstrapEnvironment();

const PORT = Number(process.env.PORT || 8091);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Life3760';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
let SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(48).toString('base64url');
const GUIDE_DIR = process.env.GUIDE_DIR || '/data/guides';
const DOC_DIR = process.env.DOC_DIR || '/data/docs';
const APP_DATA_DIR = process.env.APP_DATA_DIR || '/data/app';
const NGINX_LOG = process.env.NGINX_LOG || '/data/nginx/access.log';
const CHANGELOG_DIR = process.env.CHANGELOG_DIR || '/data/changelog';
const SESSION_TTL = 1000 * 60 * 60 * 12;
const ADMIN_BASE = '/admin';
const AI_API_KEY = process.env.AI_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || (process.env.XAI_API_KEY ? 'grok-4-1-fast-reasoning' : 'gpt-4o-mini');
const AI_BASE_URL = (process.env.AI_BASE_URL || (process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');

function adminUrl(pathname='/', query='') {
  let p = String(pathname || '/');
  let q = String(query || '');
  const qIndex = p.indexOf('?');
  if (qIndex >= 0) {
    q = p.slice(qIndex + 1);
    p = p.slice(0, qIndex);
  }
  if (!p.startsWith('/')) p = '/' + p;
  if (p !== '/' && !p.endsWith('/')) p += '/';
  return `${ADMIN_BASE}${p}${q ? `?${q}` : ''}`;
}

function normalizeAdminPath(pathname) {
  let p = pathname || '/';
  if (p === ADMIN_BASE || p === `${ADMIN_BASE}/`) return '/';
  if (p.startsWith(`${ADMIN_BASE}/`)) p = p.slice(ADMIN_BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  if (p !== '/') p = p.replace(/\/+$/, '');
  return p || '/';
}

fs.mkdirSync(GUIDE_DIR, { recursive: true });
fs.mkdirSync(DOC_DIR, { recursive: true });
fs.mkdirSync(APP_DATA_DIR, { recursive: true });
fs.mkdirSync(CHANGELOG_DIR, { recursive: true });

const activityFile = path.join(APP_DATA_DIR, 'activity.jsonl');
const sessions = new Map();
const loginFailures = new Map();


// ---- Admin roles / accounts -------------------------------------------------
const ADMIN_STORE_FILE = path.join(APP_DATA_DIR, 'admins.json');
const ROLE_STORE_FILE = path.join(APP_DATA_DIR, 'roles.json');
const ROADMAP_FILE = path.join(APP_DATA_DIR, 'roadmap.json');
const DEFAULT_ROADMAP = {title:'Roadmap',eyebrow:'The future of Oxy',intro:'The Oxy Controller roadmap.',notice:'Planned work may change.',sections:[]};

const PERMISSIONS = [
  'dashboard.view',
  'docs.view','docs.create','docs.edit','docs.delete',
  'changelog.view','changelog.create','changelog.edit','changelog.delete',
  'analytics.view','activity.view','settings.view',
  'admins.view','admins.create','admins.edit','admins.delete',
  'roles.view','roles.create','roles.edit','roles.delete','roles.assign',
  'site.version.view','site.version.edit',
  'templates.view','templates.create','templates.edit','templates.delete','templates.publish',
  'ai.use','ai.format','ai.summarize',
  'system.backup','content.edit',
  'roadmap.view','roadmap.edit'
];

const PERMISSION_INFO = {
  'dashboard.view': {label:'View dashboard', description:'Open the main admin dashboard.'},
  'docs.view': {label:'View documentation', description:'Read documentation pages.'},
  'docs.create': {label:'Create documentation', description:'Add new documentation pages.'},
  'docs.edit': {label:'Edit documentation', description:'Change existing documentation pages.'},
  'docs.delete': {label:'Delete documentation', description:'Remove documentation pages.'},
  'changelog.view': {label:'View changelog', description:'Read release notes.'},
  'changelog.create': {label:'Create changelog entries', description:'Add release notes.'},
  'changelog.edit': {label:'Edit changelog entries', description:'Change existing release notes.'},
  'changelog.delete': {label:'Delete changelog entries', description:'Remove release notes.'},
  'analytics.view': {label:'View analytics', description:'See website traffic and usage statistics.'},
  'activity.view': {label:'View activity history', description:'Read recent activity and audit records.'},
  'settings.view': {label:'View settings', description:'Open admin settings pages.'},
  'admins.view': {label:'View admin accounts', description:'See administrator accounts and their roles.'},
  'admins.create': {label:'Create admin accounts', description:'Add administrator accounts.'},
  'admins.edit': {label:'Edit admin accounts', description:'Change administrator details, roles and passwords.'},
  'admins.delete': {label:'Delete admin accounts', description:'Remove eligible administrator accounts.'},
  'roles.view': {label:'View roles and permissions', description:'Read role definitions and access rights.'},
  'roles.create': {label:'Create roles', description:'Create new permission roles.'},
  'roles.edit': {label:'Edit roles and permissions', description:'Change role names, descriptions and access.'},
  'roles.delete': {label:'Delete roles', description:'Remove eligible roles that are not assigned.'},
  'roles.assign': {label:'Assign roles', description:'Assign roles to accounts where supported.'},
  'site.version.view': {label:'View website version', description:'See the configured website version.'},
  'site.version.edit': {label:'Edit website version', description:'Change the configured website version.'},
  'templates.view': {label:'View templates', description:'Browse available templates.'},
  'templates.create': {label:'Create templates', description:'Add templates.'},
  'templates.edit': {label:'Edit templates', description:'Change existing templates.'},
  'templates.delete': {label:'Delete templates', description:'Remove templates.'},
  'templates.publish': {label:'Publish templates', description:'Make templates available to users.'},
  'ai.use': {label:'Use AI tools', description:'Access AI-assisted writing tools.'},
  'ai.format': {label:'Format content with AI', description:'Use AI to improve content formatting.'},
  'ai.summarize': {label:'Summarise content with AI', description:'Generate content summaries.'},
  'system.backup': {label:'Manage system backups', description:'Access system backup operations where implemented.'},
  'content.edit': {label:'Edit website content', description:'Edit supported existing website content.'},
  'roadmap.view': {label:'View roadmap editor', description:'Access the roadmap editor page.'},
  'roadmap.edit': {label:'Edit public roadmap', description:'Change the public roadmap title, sections and items.'}
};

const DEFAULT_ROLES = [
  {id:'owner',name:'Owner',description:'Full access to the entire admin site.',permissions:['*'],system:true},
  {id:'administrator',name:'Administrator',description:'Manage most admin features.',permissions:PERMISSIONS.filter(p=>!['admins.delete','roles.delete','system.backup'].includes(p)),system:false},
  {id:'editor',name:'Editor',description:'Manage documentation and changelog content.',permissions:['dashboard.view','docs.view','docs.create','docs.edit','docs.delete','changelog.view','changelog.create','changelog.edit','changelog.delete','analytics.view','activity.view','ai.use','ai.format','ai.summarize'],system:false},
  {id:'viewer',name:'Viewer',description:'Read-only dashboard access.',permissions:['dashboard.view','analytics.view','activity.view','docs.view','changelog.view'],system:false}
];
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJson(file,data){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n','utf8');fs.renameSync(tmp,file);}
function loadRoles(){return readJson(ROLE_STORE_FILE,DEFAULT_ROLES);}
function loadAdmins(){return readJson(ADMIN_STORE_FILE,[]);}
function saveRoles(v){writeJson(ROLE_STORE_FILE,v);}
function saveAdmins(v){writeJson(ADMIN_STORE_FILE,v);}
function getRole(id){return loadRoles().find(r=>r.id===id)||null;}
function getAdmin(username){return loadAdmins().find(a=>a.username===username&&a.enabled!==false)||null;}
function getAdminAny(username){return loadAdmins().find(a=>a.username===username)||null;}
function adminPermissions(admin){const out=new Set();for(const id of (admin?.roleIds||[])){const role=getRole(id);if(!role)continue;for(const p of (role.permissions||[]))out.add(p);}return out;}
function hasPermission(admin,permission){
  const p = adminPermissions(admin);
  if (p.has('*') || p.has(permission)) return true;
  if (!p.has('content.edit')) return false;
  return [
    'docs.view','docs.edit',
    'changelog.view','changelog.edit',
    'site.version.view','site.version.edit',
    'templates.view','templates.edit'
  ].includes(permission);
}
function requirePermission(admin,res,permission){if(!admin||!hasPermission(admin,permission)){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Forbidden',`<section class="panel"><h2>403</h2><p>You do not have permission to access <code>${htmlEscape(permission)}</code>.</p></section>`,admin?.username||''));return false;}return true;}
function passwordHash(password){const salt=crypto.randomBytes(16);const hash=crypto.scryptSync(String(password),salt,64);return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;}
function passwordVerify(password,encoded){try{const [,saltHex,hashHex]=String(encoded||'').split('$');if(!saltHex||!hashHex)return false;const expected=Buffer.from(hashHex,'hex');const actual=crypto.scryptSync(String(password),Buffer.from(saltHex,'hex'),expected.length);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}catch{return false;}}
function ensureAdminStores(){
  let roles=loadRoles();
  if(!roles.length)roles=[...DEFAULT_ROLES];
  for(const base of DEFAULT_ROLES){if(!roles.some(r=>r.id===base.id))roles.push(base);}
  saveRoles(roles);
  let admins=loadAdmins();
  let owner=admins.find(a=>a.username===ADMIN_USERNAME);
  if(!owner){
    if(!ADMIN_PASSWORD)throw new Error('ADMIN_PASSWORD must be configured before first admin login.');
    owner={username:ADMIN_USERNAME,passwordHash:passwordHash(ADMIN_PASSWORD),roleIds:['owner'],enabled:true,system:true,createdAt:new Date().toISOString()};
    admins.push(owner);saveAdmins(admins);
  }else if(!owner.system||!(owner.roleIds||[]).includes('owner')){
    owner.system=true;owner.enabled=true;owner.roleIds=['owner'];saveAdmins(admins);
  }
}
ensureAdminStores();
if (BOOTSTRAP_ENV.changed) console.log(`[env] Self-healed ${BOOTSTRAP_ENV.parsed ? Object.keys(BOOTSTRAP_ENV.parsed).length : 0} configuration entries on startup.`);

function htmlEscape(value = '') {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function attr(value = '') { return htmlEscape(value); }
function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'guide';
}
function newId() { return crypto.randomBytes(8).toString('hex'); }

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function makeSession(username, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, ip, csrf: crypto.randomBytes(24).toString('hex'), expires: Date.now() + SESSION_TTL });
  return token;
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function auth(req) {
  const token = getCookie(req, 'oxy_admin_session');
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  const admin = getAdmin(s.username);
  if (!admin) { sessions.delete(token); return null; }
  s.expires = Date.now() + SESSION_TTL;
  return { token, ...s, admin };
}
function setSession(res, token) {
  res.setHeader('Set-Cookie', `oxy_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor(SESSION_TTL/1000)}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'oxy_admin_session=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
}

function getClientIP(req) {
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cf) return cf;
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded;
  return String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function writeActivity(type, details = {}) {
  const row = { at: new Date().toISOString(), type, ...details };
  fs.appendFileSync(activityFile, JSON.stringify(row) + '\n');
}

function parseFrontmatter(text) {
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) return { meta: {}, body: text };
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: text };
  const header = trimmed.slice(3, end).replace(/^\r?\n/, '');
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  const meta = {};
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    meta[m[1]] = value;
  }
  return { meta, body };
}
function composeGuide(fields, body) {
  const order = ['id','title','description','category','difficulty','time','slug'];
  const lines = ['---'];
  for (const key of order) {
    const value = fields[key] ?? '';
    lines.push(`${key}: "${String(value).replaceAll('"', '\\"')}"`);
  }
  lines.push('---', '', body.trimEnd(), '');
  return lines.join('\n');
}
function listGuides() {
  const entries = [];
  for (const name of fs.readdirSync(GUIDE_DIR)) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(GUIDE_DIR, name);
    try {
      const stat = fs.statSync(full);
      const raw = fs.readFileSync(full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
      entries.push({ file: name, path: full, ...meta, wordCount, size: stat.size, modified: stat.mtime.toISOString() });
    } catch (e) { /* skip bad files */ }
  }
  return entries.sort((a,b) => String(a.title || a.file).localeCompare(String(b.title || b.file)));
}
function getGuide(idOrFile) {
  const guides = listGuides();
  return guides.find(g => g.id === idOrFile || g.file === idOrFile || g.slug === idOrFile) || null;
}


function composeDoc(fields, body) {
  const order = ['id','title','description','section','order','slug'];
  const lines = ['---'];
  for (const key of order) {
    const value = fields[key] ?? '';
    lines.push(`${key}: "${String(value).replaceAll('"', '\\"')}"`);
  }
  lines.push('---', '', body.trimEnd(), '');
  return lines.join('\n');
}
function listDocs() {
  const entries = [];
  for (const name of fs.readdirSync(DOC_DIR)) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(DOC_DIR, name);
    try {
      const stat = fs.statSync(full);
      const raw = fs.readFileSync(full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
      entries.push({ file:name, path:full, ...meta, wordCount, size:stat.size, modified:stat.mtime.toISOString() });
    } catch {}
  }
  return entries.sort((a,b) => String(a.title || a.file).localeCompare(String(b.title || b.file)));
}
function getDoc(idOrFile) {
  const docs = listDocs();
  return docs.find(d => d.id === idOrFile || d.file === idOrFile || d.slug === idOrFile) || null;
}
function docFilename(slug, title) {
  return `${slugify(slug || title)}.md`;
}


function parseChangelogMarkdown(source) {
  const trimmed = source.replace(/^\uFEFF/, '');
  let meta = {};
  let body = trimmed;
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3);
    if (end >= 0) {
      const header = trimmed.slice(3, end).replace(/^\r?\n/, '');
      body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
      for (const line of header.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        meta[m[1]] = v;
      }
    }
  }
  const items = [];
  let current = 'Added';
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const candidate = heading[1].trim();
      current = ['Added','Improved','Fixed','Developer','Templates'].includes(candidate) ? candidate : 'Added';
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) items.push({ kind: current, text: bullet[1].trim() });
  }
  return { meta, body, items };
}
function composeChangelog(fields, body) {
  const lines = ['---'];
  for (const key of ['version','date','title','summary']) {
    const value = fields[key] ?? '';
    lines.push(`${key}: "${String(value).replaceAll('"','\\"')}"`);
  }
  lines.push('---','',body.trimEnd(),'');
  return lines.join('\n');
}
function listChangelogs() {
  const out = [];
  for (const name of fs.readdirSync(CHANGELOG_DIR)) {
    if (!name.endsWith('.md') || name.toLowerCase() === 'readme.md') continue;
    const full = path.join(CHANGELOG_DIR, name);
    try {
      const stat = fs.statSync(full);
      const raw = fs.readFileSync(full, 'utf8');
      const parsed = parseChangelogMarkdown(raw);
      out.push({ file:name, path:full, ...parsed.meta, items:parsed.items, modified:stat.mtime.toISOString(), size:stat.size });
    } catch {}
  }
  return out.sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')) || String(b.version||'').localeCompare(String(a.version||'')));
}
function getChangelog(fileOrVersion) {
  return listChangelogs().find(x => x.file === fileOrVersion || x.version === fileOrVersion) || null;
}
function changelogFilename(version, title) {
  const safeVersion = String(version || 'release').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safeVersion}-${slugify(title || 'release')}.md`;
}

function recentActivity(limit = 30) {
  if (!fs.existsSync(activityFile)) return [];
  const lines = fs.readFileSync(activityFile, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse();
  return lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

function analytics() {
  const buckets = { total: 0, last24h: 0, last7d: 0, guides: new Map(), status: new Map() };
  if (!fs.existsSync(NGINX_LOG)) return buckets;
  const now = Date.now();
  const text = fs.readFileSync(NGINX_LOG, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/\[(.+?)\] "(\w+) ([^ ]+) [^"]+" (\d{3}) /);
    if (!m) continue;
    const [, datePart, method, uri, status] = m;
    const timestamp = Date.parse(datePart.replace(/:/, ' '));
    const ts = Number.isFinite(timestamp) ? timestamp : now;
    const age = now - ts;
    if (method !== 'GET') continue;
    buckets.total++;
    if (age <= 86400000) buckets.last24h++;
    if (age <= 604800000) buckets.last7d++;
    buckets.status.set(status, (buckets.status.get(status) || 0) + 1);
    const clean = uri.split('?')[0];
    if (clean.startsWith('/guides/') || clean === '/guides') {
      buckets.guides.set(clean, (buckets.guides.get(clean) || 0) + 1);
    }
  }
  return buckets;
}

function renderMarkdownLite(text) {
  // Admin-only preview: intentionally lightweight. Public site remains responsible for full Markdown rendering.
  let s = htmlEscape(text);
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>')
       .replace(/^## (.+)$/gm, '<h2>$1</h2>')
       .replace(/^# (.+)$/gm, '<h1>$1</h1>')
       .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
       .replace(/`([^`]+)`/g, '<code>$1</code>')
       .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
       .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
       .replace(/(?:<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
       .replace(/\n\n/g, '</p><p>')
       .replace(/\n/g, '<br>');
  return `<div class="md-preview"><p>${s}</p></div>`;
}

function layout(title, body, user, active='dashboard') {
  const admin = user ? getAdminAny(user) : null;
  const navAll = [
    ['dashboard','dashboard.view',adminUrl('/'),'Dashboard'],
    ['oxcontroller-management','dashboard.view',adminUrl('/oxcontroller'),'OxController'],
    ['guides','docs.view',adminUrl('/editor'),'Guides'],
    ['docs','docs.view',adminUrl('/docs'),'Docs'],
    ['changelog','changelog.view',adminUrl('/changelog'),'Changelog'],
    ['analytics','analytics.view',adminUrl('/analytics'),'Analytics'],
    ['activity','activity.view',adminUrl('/activity'),'Activity'],
    ['admins','admins.view',adminUrl('/admins'),'Admins'],
    ['roles','roles.view',adminUrl('/roles'),'Roles'],
    ['settings','settings.view',adminUrl('/settings'),'Settings'],
    ['account',null,adminUrl('/account'),'My Account']
  ];
  const nav = navAll.filter(([,permission])=>!permission || !admin || hasPermission(admin,permission));
  const roleNames = (admin?.roleIds||[]).map(id=>getRole(id)?.name).filter(Boolean).join(', ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#070708"><title>${htmlEscape(title)} · Oxy Admin</title><link rel="stylesheet" href="${ADMIN_BASE}/admin.css?v=20261003builder4"></head><body><div class="mobile-topbar"><div class="mobile-brand"><div class="mark">O</div><div><strong>Oxy</strong><span>ADMIN</span></div></div><button class="mobile-menu-toggle" id="oxy-mobile-menu" type="button" aria-label="Open navigation" aria-controls="oxy-admin-sidebar" aria-expanded="false"><span class="hamburger" aria-hidden="true"></span></button></div><div class="mobile-overlay" id="oxy-mobile-overlay" aria-hidden="true"></div><div class="shell"><aside class="sidebar" id="oxy-admin-sidebar"><div class="brand"><div class="mark">O</div><div><strong>Oxy</strong><span>ADMIN</span></div></div><div class="side-label">Control</div>${nav.map(([key,permission,href,label])=>`<a class="nav ${active===key?'active':''}" href="${href}">${label}</a>`).join('')}<div class="side-spacer"></div><form method="post" action="${ADMIN_BASE}/logout/"><button class="logout" type="submit">Sign out</button></form></aside><main class="main"><header class="top"><div><span class="eyebrow">Oxy Controller</span><h1>${htmlEscape(title)}</h1></div><div class="user">${htmlEscape(user || '')} ${roleNames?`· ${htmlEscape(roleNames)}`:''}</div></header>${body}</main></div><script>(()=>{const b=document.body,t=document.getElementById('oxy-mobile-menu'),o=document.getElementById('oxy-mobile-overlay'),s=document.getElementById('oxy-admin-sidebar');if(!t||!o||!s)return;const setOpen=(open)=>{b.classList.toggle('menu-open',open);t.setAttribute('aria-expanded',String(open));t.setAttribute('aria-label',open?'Close navigation':'Open navigation');o.setAttribute('aria-hidden',String(!open));};t.addEventListener('click',()=>setOpen(!b.classList.contains('menu-open')));o.addEventListener('click',()=>setOpen(false));s.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>setOpen(false)));document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false);});})();</script>${visualBuilderScript()}${aiClientScript()}</body></html>`;
}
function redirect(res, location) {
  let target = location;
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith(`${ADMIN_BASE}/`) && target !== ADMIN_BASE) {
    target = adminUrl(target);
  }
  res.writeHead(303, { Location: target }); res.end();
}
function json(res, status, obj) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  return await new Promise((resolve, reject) => { let data=''; req.on('data', c=>{ data += c; if (data.length > 2_000_000) { req.destroy(); reject(new Error('body too large')); }}); req.on('end',()=>resolve(data)); req.on('error', reject); });
}


function isOwner(admin) {
  return Boolean(admin && (admin.system || (admin.roleIds || []).includes('owner')));
}
function readEnvFile() {
  try { return fs.readFileSync(ENV_FILE, 'utf8'); }
  catch { return ''; }
}
function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}
function applyEnvText(text) {
  const parsed = parseEnvFile(text);
  for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
  return parsed;
}
function requiredEnvDefinitions() {
  return [
    ['AI_API_KEY', '', 'AI provider API key. Use this or XAI_API_KEY/OPENAI_API_KEY.'],
    ['AI_MODEL', 'grok-4.7', 'AI model used by the admin writing tools.'],
    ['AI_BASE_URL', 'https://api.x.ai/v1', 'OpenAI-compatible AI API base URL.'],
    ['ADMIN_USERNAME', process.env.ADMIN_USERNAME || 'Life3760', 'Owner/admin username.'],
    ['ADMIN_PASSWORD', '', 'Initial owner password; account passwords are managed through the account system.'],
    ['ADMIN_SESSION_SECRET', crypto.randomBytes(48).toString('base64url'), 'Cryptographically-random secret used for admin session security.'],
    ['NGINX_LOG', process.env.NGINX_LOG || '/data/nginx/access.log', 'Nginx access log path.'],
    ['XAI_API_KEY', process.env.XAI_API_KEY || '', 'Optional xAI API key.'],
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY || '', 'Optional OpenAI API key.'],
    ['GUIDE_DIR', process.env.GUIDE_DIR || '/data/guides', 'Guide content directory.'],
    ['DOC_DIR', process.env.DOC_DIR || '/data/docs', 'Documentation content directory.'],
    ['CHANGELOG_DIR', process.env.CHANGELOG_DIR || '/data/changelog', 'Changelog content directory.'],
    ['APP_DATA_DIR', process.env.APP_DATA_DIR || '/data/app', 'Admin application data directory.'],
    ['LOCKDOWN_WEBHOOK_URL', process.env.LOCKDOWN_WEBHOOK_URL || '', 'Discord webhook used for emergency lockdown notifications.'],
    ['BOT_SOURCE_HOST_DIR', process.env.BOT_SOURCE_HOST_DIR || '', 'Optional absolute VPS path for the real bot source checkout. Recreate the admin container after changing this mount.'],
    ['API_HEALTH_URL', process.env.API_HEALTH_URL || 'http://oxcontroller-fresh:4000/', 'Internal endpoint used by the management health check.'],
    ['PUBLIC_SITE_HEALTH_URL', process.env.PUBLIC_SITE_HEALTH_URL || 'http://oxy-info-site:8080/', 'Internal endpoint used by the information site health check.']
  ];
}
function ensureRequiredEnvFile() {
  let text = readEnvFile();
  let parsed = parseEnvFile(text);
  const additions = [];
  let repairedSecret = false;
  for (const [key, value, description] of requiredEnvDefinitions()) {
    const missing = !Object.prototype.hasOwnProperty.call(parsed, key);
    const placeholderSecret = key === 'ADMIN_SESSION_SECRET' && (!parsed[key] || /^CHANGE_ME(?:_TO_A_LONG_RANDOM_VALUE)?$/i.test(parsed[key]));
    if (missing || placeholderSecret) {
      const actual = key === 'ADMIN_SESSION_SECRET' ? crypto.randomBytes(48).toString('base64url') : value;
      const re = new RegExp(`^${key}\\s*=.*$`, 'm');
      if (re.test(text)) text = text.replace(re, `${key}=${actual}`);
      else {
        if (text && !text.endsWith('\n')) text += '\n';
        text += `\n# ${description}\n${key}=${actual}\n`;
      }
      parsed[key] = actual;
      additions.push(key);
      if (key === 'ADMIN_SESSION_SECRET') repairedSecret = true;
    }
  }
  if (additions.length) {
    fs.mkdirSync(path.dirname(ENV_FILE), {recursive:true});
    if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, `${ENV_FILE}.backup-${Date.now()}`);
    fs.writeFileSync(ENV_FILE, text.endsWith('\n') ? text : text + '\n', 'utf8');
    applyEnvText(text);
  }
  return { text, parsed, added: additions.length > 0, repairedSecret, additions };
}

function envConfigStatus(parsed) {
  const checks = [
    ['AI provider key', Boolean(parsed.AI_API_KEY || parsed.XAI_API_KEY || parsed.OPENAI_API_KEY), true],
    ['AI model', Boolean(parsed.AI_MODEL), false],
    ['AI base URL', Boolean(parsed.AI_BASE_URL), false],
    ['Admin username', Boolean(parsed.ADMIN_USERNAME), true],
    ['Session secret', Boolean(parsed.ADMIN_SESSION_SECRET && !/^CHANGE_ME/i.test(parsed.ADMIN_SESSION_SECRET)), true]
  ];
  return checks.map(([label, ok, sensitive]) => ({label, ok, sensitive}));
}
function runtimeAIConfig() {
  const file = parseEnvFile(readEnvFile());
  const key = file.AI_API_KEY || file.XAI_API_KEY || file.OPENAI_API_KEY || process.env.AI_API_KEY || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = file.AI_MODEL || process.env.AI_MODEL || (file.XAI_API_KEY || process.env.XAI_API_KEY ? 'grok-4.7' : 'gpt-4o-mini');
  const base = (file.AI_BASE_URL || process.env.AI_BASE_URL || (file.XAI_API_KEY || process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  return { key, model, base };
}
function writeEnvText(text) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, `${ENV_FILE}.backup-${Date.now()}`);
  const finalText = String(text || '').endsWith('\n') ? String(text || '') : `${String(text || '')}\n`;
  fs.writeFileSync(ENV_FILE, finalText, 'utf8');
  applyEnvText(finalText);
  return finalText;
}
function upsertEnvValue(text, key, value) {
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  return text + prefix + `\n${key}=${value}\n`;
}

async function callAI({ task, content, context = '' }) {
  const ai = runtimeAIConfig();
  if (!ai.key) throw new Error('AI is not configured. Set AI_API_KEY, XAI_API_KEY, or OPENAI_API_KEY in the environment editor.');
  const cleaned = String(content || '').trim();
  if (!cleaned) throw new Error('There is no content to process.');
  if (cleaned.length > 60000) throw new Error('Content is too large for AI processing. Keep it under 60,000 characters.');

  const system = [
    'You are the writing assistant for the Oxy Controller admin site.',
    'Return only the requested Markdown or plain text result. Do not wrap it in code fences unless explicitly requested.',
    'Preserve Markdown structure and supported Oxy blocks such as :::warning, :::danger, :::note, :::tip, :::info, :::container and :::steps.',
    'Never invent product features, commands, URLs, facts, IDs, version numbers, or technical details that are not present in the source.',
    'Keep Discord/Markdown backticks, links, headings, lists, code blocks, and callouts valid.',
    context
  ].filter(Boolean).join('\\n');

  const userPrompts = {
    format: `Clean up and format this content for publication. Fix spacing, headings, list structure, Markdown consistency, awkward line breaks, and readability. Preserve the meaning and all technical information exactly. Do not add new facts.\\n\\nSOURCE:\\n${cleaned}`,
    improve: `Improve the writing quality of this content while preserving its meaning, technical details, Markdown structure, and overall length. Make it clearer and more professional. Do not invent information or add unsupported claims.\\n\\nSOURCE:\\n${cleaned}`,
    summarize: `Write a concise summary of this content for an admin/public documentation summary field. Return only the summary, ideally 1-3 sentences. Do not invent information.\\n\\nSOURCE:\\n${cleaned}`
  };

  if (!userPrompts[task]) throw new Error('Unknown AI task.');

  const response = await fetch(`${ai.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: ai.model,
      temperature: task === 'summarize' ? 0.2 : 0.35,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompts[task] }
      ]
    })
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    const msg = data?.error?.message || `AI request failed with HTTP ${response.status}.`;
    throw new Error(msg);
  }
  const result = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!result) throw new Error('The AI returned an empty result.');
  return result;
}
function visualBuilder(content, textareaId='ai-content') {
  const escaped = htmlEscape(String(content || ''));
  return `<div class="builder-wrap" data-builder-for="${attr(textareaId)}">
    <div class="builder-topbar">
      <div class="builder-topbar-title"><span class="eyebrow">Visual builder</span><strong>Content Builder</strong><span class="builder-save-state" data-builder-status>Ready</span></div>
      <div class="builder-topbar-actions">
        <button type="button" class="button secondary" data-builder-preview>Preview</button>
        <button type="button" class="button secondary" data-builder-toggle>Markdown</button>
        <button type="button" class="button secondary" data-builder-fullscreen aria-label="Open builder fullscreen">Fullscreen</button>
        <button type="button" class="button primary" data-builder-open>+ Add block</button>
      </div>
    </div>
    <div class="builder-layout">
      <aside class="builder-sidebar" data-builder-library>
        <div class="builder-sidebar-head"><strong>Blocks</strong><input type="search" placeholder="Search blocks…" data-builder-search></div>
        <div class="builder-library" data-builder-palette></div>
      </aside>
      <main class="builder-stage">
        <div class="builder-stage-toolbar"><span>Canvas</span><div class="builder-device"><button type="button" class="active" data-builder-device="desktop">Desktop</button><button type="button" data-builder-device="mobile">Mobile</button></div></div>
        <div class="builder-canvas-wrap"><div class="builder-canvas" data-builder-canvas></div></div>
      </main>
      <aside class="builder-inspector" data-builder-inspector><div class="builder-inspector-empty"><strong>Select a block</strong><span>Choose a block on the canvas to edit its content and settings.</span></div></aside>
    </div>
    <textarea class="markdown builder-source" id="${attr(textareaId)}" name="body" spellcheck="false">${escaped}</textarea>
    <div class="builder-mobile-sheet" data-builder-sheet>
      <div class="builder-sheet-card">
        <div class="builder-sheet-head"><strong>Add block</strong><button type="button" data-builder-close aria-label="Close">×</button></div>
        <input type="search" class="builder-sheet-search" placeholder="Search blocks…" data-builder-sheet-search>
        <div class="builder-sheet-palette" data-builder-sheet-palette></div>
      </div>
    </div>
  </div>`;
}

function visualBuilderScript() {
  return `<script src="${ADMIN_BASE}/builder.js?v=5"></script>`;
}

function aiClientScript() {
  return `<script>
  (function(){
    const getCsrf=()=>document.querySelector('input[name="csrf"]')?.value||'';
    async function runAI(task,targetId,summaryId,statusId){
      const target=document.getElementById(targetId);
      if(!target) return;
      const status=document.getElementById(statusId);
      if(status) status.textContent='Working…';
      try{
        const res=await fetch('${ADMIN_BASE}/ai/',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({csrf:getCsrf(),task,content:target.value})
        });
        const data=await res.json().catch(()=>({}));
        if(!res.ok||!data.ok) throw new Error(data.error||'AI request failed.');
        if(task==='summarize'&&summaryId){
          const summary=document.getElementById(summaryId);
          if(summary) summary.value=data.result;
        }else{
          target.value=data.result;
          target.dispatchEvent(new Event('input',{bubbles:true}));
        }
        if(status) status.textContent='Done';
      }catch(e){
        if(status) status.textContent=e.message||'AI request failed.';
      }
    }
    window.runOxyAI=runAI;
  })();
  </script>`;
}
function requireAuth(req, res) { const a = auth(req); if (!a) { redirect(res, '/login'); return null; } return a; }
function checkCsrf(req, res, form) { if (!form || form.csrf !== auth(req)?.csrf) { res.writeHead(403); res.end('Forbidden'); return false; } return true; }

function renderLogin(error='') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Oxy Admin</title><link rel="stylesheet" href="${ADMIN_BASE}/admin.css"></head><body class="login-body"><div class="login-card"><div class="brand center"><div class="mark">O</div><div><strong>Oxy</strong><span>ADMIN</span></div></div><div class="side-label center-text">Private administration</div>${error?`<div class="alert error">${htmlEscape(error)}</div>`:''}<form method="post" action="${ADMIN_BASE}/login/"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="primary full" type="submit">Sign in</button></form><p class="login-note">This area is intentionally not linked from the public site.</p></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = normalizeAdminPath(url.pathname);
    if (req.method === 'GET' && pathname === '/message-builder.js') {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'message-builder.js'));
      res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public,max-age=3600'}); res.end(js); return;
    }
    if (req.method === 'GET' && pathname === '/builder.js') {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'builder.js'));
      res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public,max-age=3600'}); res.end(js); return;
    }
    if (req.method === 'GET' && pathname === '/admin.css') {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'admin.css'));
      res.writeHead(200, {'Content-Type':'text/css; charset=utf-8','Cache-Control':'public,max-age=3600'}); res.end(css); return;
    }
    if (req.method === 'GET' && pathname === '/health') return json(res, 200, {ok:true, guides:listGuides().length, time:new Date().toISOString()});


    if (pathname === '/roadmap-public' && req.method === 'GET') {
      const roadmap = readJson(ROADMAP_FILE, DEFAULT_ROADMAP);
      const sectionsHtml = (Array.isArray(roadmap.sections) ? roadmap.sections : []).map(section => {
        const items = (Array.isArray(section.items) ? section.items : []).map(item =>
          `<article class="card"><span class="tag">${htmlEscape(section.title || 'Roadmap')}</span><h3>${htmlEscape(item.title || '')}</h3><p>${htmlEscape(item.detail || '')}</p></article>`
        ).join('');
        return `<section><h2>${htmlEscape(section.title || '')}</h2><p class="muted">${htmlEscape(section.description || '')}</p><div class="cards">${items}</div></section>`;
      }).join('');
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${htmlEscape(roadmap.intro || '')}"><title>${htmlEscape(roadmap.title || 'Roadmap')} · Oxy Controller</title><style>
      :root{color-scheme:dark;--bg:#09090b;--panel:#111114;--border:#29292f;--fg:#f4f4f5;--muted:#a1a1aa}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
      .wrap{max-width:1000px;margin:auto;padding:42px 22px 70px}.brand{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
      .eyebrow{margin-top:54px;color:var(--muted);font:12px monospace;letter-spacing:.16em;text-transform:uppercase}
      h1{font-size:clamp(38px,7vw,62px);letter-spacing:-.045em;line-height:1.08;margin:10px 0 18px}
      .intro{font-size:18px;color:var(--muted);max-width:700px}.notice{border:1px solid var(--border);background:var(--panel);border-radius:12px;padding:16px 18px;color:var(--muted);margin:28px 0 45px}
      section{margin:40px 0}h2{font-size:26px;letter-spacing:-.025em;margin-bottom:4px}.muted,p{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:14px;margin-top:18px}
      .card{border:1px solid var(--border);background:var(--panel);border-radius:12px;padding:20px}.card h3{font-size:17px;margin:16px 0 7px}.card p{font-size:14px;margin-bottom:0}
      .tag{border:1px solid var(--border);border-radius:99px;padding:4px 9px;color:var(--muted);font:10px monospace;letter-spacing:.08em;text-transform:uppercase}
      footer{margin-top:55px;border-top:1px solid var(--border);padding-top:22px;color:var(--muted);font-size:13px}a{color:var(--fg)}
      </style></head><body><main class="wrap"><div class="brand">Oxy Controller</div><header><div class="eyebrow">${htmlEscape(roadmap.eyebrow || 'The future of Oxy')}</div><h1>${htmlEscape(roadmap.title || 'Roadmap')}</h1><p class="intro">${htmlEscape(roadmap.intro || '')}</p></header><div class="notice">${htmlEscape(roadmap.notice || '')}</div>${sectionsHtml}<footer><a href="/">Back to Oxy Controller</a></footer></main></body></html>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      res.end(html);
      return;
    }

    if (pathname === '/login' && req.method === 'GET') { const rotated = url.searchParams.get('rotated') === '1'; res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(renderLogin(rotated ? 'Session security changed. Please sign in again.' : '')); return; }
    if (pathname === '/login' && req.method === 'POST') {
      const body = querystring.parse(await readBody(req));
      const key = req.socket.remoteAddress || 'unknown';
      const fail = loginFailures.get(key) || {count:0, until:0};
      if (fail.until > Date.now()) { res.writeHead(429); res.end('Too many login attempts. Try again later.'); return; }
      const username = String(body.username || '').trim();
      const admin = getAdmin(username);
      const ok = Boolean(admin && passwordVerify(String(body.password || ''), admin.passwordHash));
      if (!ok) {
        fail.count += 1;
        if (fail.count >= 8) { fail.until = Date.now() + 15*60*1000; fail.count = 0; }
        loginFailures.set(key, fail);
        writeActivity('login.failed', {user:username || 'unknown', ip:getClientIP(req)});
        res.writeHead(401, {'Content-Type':'text/html; charset=utf-8'});
        res.end(renderLogin('Invalid username or password.'));
        return;
      }
      loginFailures.delete(key);
      const token = makeSession(admin.username, key);
      setSession(res, token);
      writeActivity('login', {user:admin.username, ip:getClientIP(req), roles:admin.roleIds||[]});
      redirect(res, '/');
      return;
    }
    // OC_MGMT_BEGIN
    const ocDir = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
    const ocStateFile = path.join(ocDir, 'oxcontroller-management.json');
    const ocSiteDir = process.env.MGMT_SITE_DIR || '/data/info-site';
    const ocFlag = path.join(ocSiteDir, 'maintenance.flag');
    const ocBotDir = path.resolve(process.env.BOT_SOURCE_DIR || '/data/bot-source');
    const ocBotBackupDir = path.join(ocDir, 'bot-code-backups');
    const ocAllowedExt = new Set(['.txt','.md','.json','.js','.cjs','.mjs','.ts','.tsx','.jsx',
      '.css','.html','.xml','.yml','.yaml','.conf','.py','.sql','.toml','.sh','.properties']);

    const ocEsc = value => String(value ?? '').replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    const ocReadState = () => {
      try {
        const state = JSON.parse(fs.readFileSync(ocStateFile, 'utf8'));
        return {...{maintenance:false,lockdown:false,reason:'',updates:[],
          lastWebhookDelivery:null,lastWebhookTest:null}, ...state,
          updates:Array.isArray(state.updates)?state.updates:[]};
      } catch {
        return {maintenance:false,lockdown:false,reason:'',updates:[],
          lastWebhookDelivery:null,lastWebhookTest:null};
      }
    };
    const ocSaveState = state => {
      fs.mkdirSync(ocDir, {recursive:true});
      writeJson(ocStateFile, state);
    };
    const ocSyncMaintenanceFlag = state => {
      fs.mkdirSync(ocSiteDir, {recursive:true});
      if (state.maintenance || state.lockdown) {
        fs.writeFileSync(ocFlag,
          'OxController maintenance or lockdown is active\nReason: '+
          String(state.reason || 'Scheduled maintenance').slice(0,1000)+'\n', 'utf8');
      } else if (fs.existsSync(ocFlag)) fs.unlinkSync(ocFlag);
    };
    const ocPublishUpdate = entry => {
      fs.mkdirSync(ocSiteDir,{recursive:true});
      const file = path.join(ocSiteDir,'updates.json');
      let doc = [];
      try { doc = JSON.parse(fs.readFileSync(file,'utf8')); } catch {}
      if (Array.isArray(doc)) doc.unshift(entry);
      else if (doc && typeof doc === 'object') {
        if (!Array.isArray(doc.updates)) doc.updates = [];
        doc.updates.unshift(entry);
      } else doc = [entry];
      writeJson(file, Array.isArray(doc) ? doc.slice(0,100) : doc);
    };
    const ocWebhookTarget = () => {
      const raw = String(process.env.LOCKDOWN_WEBHOOK_URL || '').trim();
      if (!raw) throw new Error('Lockdown webhook is not configured.');
      const target = new URL(raw);
      if (target.protocol !== 'https:' || target.hostname !== 'discord.com' ||
          !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(target.pathname)) {
        throw new Error('The configured Discord webhook URL is invalid.');
      }
      return target;
    };
    const ocSendWebhook = async ({title,description,reason,author,color=15158332}) => {
      const target = ocWebhookTarget();
      const fields = [];
      if (reason) fields.push({name:'Reason',value:String(reason).slice(0,1024),inline:false});
      if (author) fields.push({name:'Administrator',value:String(author).slice(0,256),inline:true});
      const response = await fetch(target.href, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({username:'OxController Alerts',allowed_mentions:{parse:[]},embeds:[{
          title:String(title||'OxController notification').slice(0,256),
          description:String(description||'').slice(0,4000),color,
          fields,timestamp:new Date().toISOString()
        }]}), signal:AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}.`);
      return true;
    };
    const ocProbe = async raw => {
      const value = String(raw || '').trim();
      if (!value) return {configured:false,online:false,label:'Not configured'};
      const started = Date.now();
      try {
        const u = new URL(value);
        if (!['http:','https:'].includes(u.protocol)) throw new Error('Unsupported protocol');
        const response = await fetch(u.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(2500)});
        return {configured:true,online:true,status:response.status,ms:Date.now()-started,label:`Reachable · HTTP ${response.status}`};
      } catch (e) {
        return {configured:true,online:false,ms:Date.now()-started,label:'Unreachable'};
      }
    };
    const ocSourceMountConfigured = Boolean(String(process.env.BOT_SOURCE_MOUNT_ACTIVE || '').trim());
    const ocSafeBotRelative = raw => {
      const value = String(raw || '').trim().replace(/\\/g,'/');
      if (!value || value.length > 240 || value.startsWith('/') || value.includes('\0')) return '';
      const segments = value.split('/');
      if (segments.length > 8 || segments.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/.test(s))) return '';
      if (!ocAllowedExt.has(path.extname(segments[segments.length-1]).toLowerCase())) return '';
      return segments.join('/');
    };
    const ocBotPath = (raw, createDirs=false) => {
      const relative = ocSafeBotRelative(raw);
      if (!relative) return null;
      const root = path.resolve(ocBotDir);
      try {
        const rootStat = fs.lstatSync(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
      } catch { return null; }
      const target = path.resolve(root, ...relative.split('/'));
      if (!target.startsWith(root + path.sep)) return null;
      let cursor = root;
      const segments = relative.split('/');
      for (let i=0;i<segments.length;i++) {
        cursor = path.join(cursor,segments[i]);
        const last = i === segments.length-1;
        try {
          const st = fs.lstatSync(cursor);
          if (st.isSymbolicLink()) return null;
          if (!last && !st.isDirectory()) return null;
          if (last && !st.isFile()) return null;
        } catch {
          if (last) return createDirs ? target : null;
          if (!createDirs) return null;
          fs.mkdirSync(cursor,{recursive:false});
        }
      }
      return target;
    };
    const ocListBotFiles = () => {
      const found = [];
      const ignored = new Set(['node_modules','.git','.svn','dist','build','.next','.venv','venv','__pycache__','coverage']);
      const walk = (dir, relative='', depth=0) => {
        if (found.length >= 400 || depth > 7) return;
        let entries=[];
        try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
        for (const ent of entries) {
          if (found.length >= 400) break;
          if (ent.isSymbolicLink()) continue;
          if (ent.isDirectory()) {
            if (!ignored.has(ent.name) && !ent.name.startsWith('.')) walk(path.join(dir,ent.name),relative ? `${relative}/${ent.name}` : ent.name,depth+1);
          } else if (ent.isFile()) {
            const rel = relative ? `${relative}/${ent.name}` : ent.name;
            if (ocSafeBotRelative(rel)) found.push(rel);
          }
        }
      };
      try { if (fs.statSync(ocBotDir).isDirectory()) walk(ocBotDir); } catch {}
      return found.sort((a,b)=>a.localeCompare(b)).slice(0,400);
    };
    const ocBackupBotFile = (target, relative) => {
      fs.mkdirSync(ocBotBackupDir,{recursive:true});
      const backupRelative = relative.replace(/\//g,'__') + '.' + Date.now() + '.bak';
      const backup = path.join(ocBotBackupDir,backupRelative);
      fs.copyFileSync(target,backup);
      return backup;
    };
    const ocSaveBotFile = (target, content, relative) => {
      if (Buffer.byteLength(content,'utf8') > 1024*1024) throw new Error('Code files are limited to 1 MB.');
      if (fs.existsSync(target)) ocBackupBotFile(target,relative);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      const temp = target + '.oxy-tmp-' + crypto.randomBytes(5).toString('hex');
      fs.writeFileSync(temp,content,{encoding:'utf8',mode:0o640,flag:'wx'});
      fs.renameSync(temp,target);
    };
    const ocParseMultipart = async req => {
      const ct = String(req.headers['content-type'] || '');
      const match = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!match) throw new Error('A multipart file upload is required.');
      const boundary = '--' + (match[1] || match[2]).trim();
      const chunks=[]; let total=0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 2*1024*1024) throw new Error('Upload request exceeds 2 MB.');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('latin1');
      const fields={}; let uploaded=null;
      for (let part of raw.split(boundary).slice(1)) {
        if (part.startsWith('--')) break;
        part=part.replace(/^\r\n/,'').replace(/\r\n$/,'');
        const cut=part.indexOf('\r\n\r\n'); if(cut<0)continue;
        const headers=part.slice(0,cut); const content=part.slice(cut+4).replace(/\r\n$/,'');
        const nm=headers.match(/name="([^"]+)"/i); const fm=headers.match(/filename="([^"]*)"/i);
        if(!nm)continue;
        if(fm && fm[1]) uploaded={name:path.basename(fm[1].replace(/\\/g,'/')),data:Buffer.from(content,'latin1')};
        else fields[nm[1]]=Buffer.from(content,'latin1').toString('utf8');
      }
      if(!uploaded)throw new Error('Choose a source file to upload.');
      return {fields,uploaded};
    };
    const ocPostRoutes = [
      '/oxcontroller/maintenance','/oxcontroller/lockdown','/oxcontroller/lockdown/clear',
      '/oxcontroller/update','/oxcontroller/webhook/test',
      '/oxcontroller/bot-code/upload','/oxcontroller/bot-code/save',
      '/oxcontroller/bot-code/new','/oxcontroller/bot-code/delete'
    ];
    const ocBotWriteRoutes = new Set([
      '/oxcontroller/webhook/test','/oxcontroller/bot-code/upload',
      '/oxcontroller/bot-code/save','/oxcontroller/bot-code/new','/oxcontroller/bot-code/delete'
    ]);

    if (req.method === 'GET' && pathname === '/oxcontroller/bot-code/download') {
      const a = auth(req);
      if (!a) { redirect(res,'/login'); return; }
      if (!isOwner(a.admin)) { res.writeHead(403);res.end('Owner access required.');return; }
      const relative = ocSafeBotRelative(url.searchParams.get('botfile'));
      const target = relative && ocBotPath(relative,false);
      if (!target || !fs.existsSync(target)) { res.writeHead(404);res.end('Source file not found.');return; }
      const st=fs.statSync(target);
      if(st.size>1024*1024){res.writeHead(413);res.end('File exceeds the 1 MB editor limit.');return;}
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${path.basename(relative).replace(/"/g,'')}"`,'Cache-Control':'no-store'});
      fs.createReadStream(target).pipe(res); return;
    }

    if (req.method === 'POST' && ocPostRoutes.includes(pathname)) {
      const a = auth(req);
      if (!a) { redirect(res,'/login'); return; }
      if (ocBotWriteRoutes.has(pathname)) {
        if (!isOwner(a.admin)) { res.writeHead(403);res.end('Owner access required.');return; }
      } else if (!requirePermission(a.admin,res,'content.edit')) return;

      let sameOrigin=false;
      try { const origin=req.headers.origin||req.headers.referer; sameOrigin=!!origin && new URL(origin).host===req.headers.host; } catch {}
      if(!sameOrigin){res.writeHead(403);res.end('Same-origin request required.');return;}

      let form, upload=null;
      try {
        if(pathname==='/oxcontroller/bot-code/upload') { const parsed=await ocParseMultipart(req);form=parsed.fields;upload=parsed.uploaded; }
        else form=querystring.parse(await readBody(req));
      } catch(e) { res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Request failed: '+String(e.message||e).replace(/[<>]/g,''));return; }
      if(!checkCsrf(req,res,form))return;

      const state=ocReadState();
      const now=new Date().toISOString();
      const backTo = relative => redirect(res, adminUrl('/oxcontroller')+(relative?'?botfile='+encodeURIComponent(relative):''));

      if(pathname==='/oxcontroller/maintenance') {
        const mode=String(form.mode||'');
        if(!['on','off'].includes(mode)){res.writeHead(400);res.end('Invalid maintenance mode.');return;}
        state.maintenance=mode==='on';state.updatedAt=now;
        ocSyncMaintenanceFlag(state);
        writeActivity('oxcontroller.maintenance.changed',{user:a.username,enabled:state.maintenance});
      } else if(pathname==='/oxcontroller/lockdown') {
        if(!isOwner(a.admin)){res.writeHead(403);res.end('Owner access required for emergency lockdown.');return;}
        const reason=String(form.reason||'').trim().slice(0,1000);
        if(reason.length<5){res.writeHead(400);res.end('Enter a reason of at least 5 characters.');return;}
        state.lockdown=true;state.reason=reason;
        const entry={type:'Emergency lockdown',message:reason,createdAt:now,author:a.username};
        state.updates.unshift(entry);state.updates=state.updates.slice(0,100);
        ocPublishUpdate(entry);ocSyncMaintenanceFlag(state);
        try {
          await ocSendWebhook({title:'Emergency Lockdown Activated',
            description:'An emergency lockdown has been activated for OxController.',
            reason,author:a.username,color:15158332});
          state.lastWebhookDelivery={success:true,at:now,message:'Lockdown alert delivered'};
        } catch(e) {
          state.lastWebhookDelivery={success:false,at:now,message:String(e.message||e).slice(0,180)};
          writeActivity('oxcontroller.lockdown.webhook_failed',{error:String(e.message||e).slice(0,180)});
        }
        writeActivity('oxcontroller.lockdown.enabled',{user:a.username,reason});
      } else if(pathname==='/oxcontroller/lockdown/clear') {
        if(!isOwner(a.admin)){res.writeHead(403);res.end('Owner access required.');return;}
        state.lockdown=false;state.reason='';
        const entry={type:'Lockdown cleared',message:'Emergency lockdown cleared by an administrator.',createdAt:now,author:a.username};
        state.updates.unshift(entry);state.updates=state.updates.slice(0,100);ocPublishUpdate(entry);
        ocSyncMaintenanceFlag(state);
        try {
          await ocSendWebhook({title:'Emergency Lockdown Cleared',description:'The emergency lockdown has been cleared for OxController.',author:a.username,color:3066993});
          state.lastWebhookDelivery={success:true,at:now,message:'Lockdown cleared alert delivered'};
        } catch(e) {
          state.lastWebhookDelivery={success:false,at:now,message:String(e.message||e).slice(0,180)};
          writeActivity('oxcontroller.lockdown.clear_webhook_failed',{error:String(e.message||e).slice(0,180)});
        }
        writeActivity('oxcontroller.lockdown.cleared',{user:a.username});
      } else if(pathname==='/oxcontroller/update') {
        const message=String(form.message||'').trim().slice(0,3000);
        if(!message){res.writeHead(400);res.end('Enter an incident update.');return;}
        const entry={type:'Incident update',message,createdAt:now,author:a.username};
        state.updates.unshift(entry);state.updates=state.updates.slice(0,100);ocPublishUpdate(entry);
        writeActivity('oxcontroller.incident.update',{user:a.username,message:message.slice(0,200)});
      } else if(pathname==='/oxcontroller/webhook/test') {
        try {
          await ocSendWebhook({title:'OxController Webhook Test',
            description:'The admin panel successfully sent a test notification.',
            author:a.username,color:3447003});
          state.lastWebhookTest={success:true,at:now,message:'Test notification delivered'};
        } catch(e) {
          state.lastWebhookTest={success:false,at:now,message:String(e.message||e).slice(0,180)};
        }
        writeActivity('oxcontroller.webhook.test',{user:a.username,success:Boolean(state.lastWebhookTest.success)});
      } else if(pathname==='/oxcontroller/bot-code/new') {
        const relative=ocSafeBotRelative(form.name);
        const target=relative&&ocBotPath(relative,true);
        if(!target){res.writeHead(400);res.end('Invalid source path or unsupported file extension.');return;}
        if(fs.existsSync(target)){res.writeHead(409);res.end('That source file already exists.');return;}
        fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,'','utf8');
        writeActivity('oxcontroller.bot_code.created',{user:a.username,file:relative});
        state.updatedAt=now;ocSaveState(state);return backTo(relative);
      } else if(pathname==='/oxcontroller/bot-code/upload') {
        const relative=ocSafeBotRelative(form.target||upload?.name);
        const target=relative&&ocBotPath(relative,true);
        if(!target){res.writeHead(400);res.end('Invalid target path or unsupported source file type.');return;}
        if(!upload || upload.data.length>1024*1024){res.writeHead(413);res.end('Choose a source file no larger than 1 MB.');return;}
        const content=upload.data.toString('utf8');
        if(content.includes('\0')){res.writeHead(400);res.end('Binary files are not supported.');return;}
        fs.mkdirSync(path.dirname(target),{recursive:true});
        ocSaveBotFile(target,content,relative);
        writeActivity('oxcontroller.bot_code.uploaded',{user:a.username,file:relative});
        state.updatedAt=now;ocSaveState(state);return backTo(relative);
      } else if(pathname==='/oxcontroller/bot-code/save') {
        const relative=ocSafeBotRelative(form.name);
        const target=relative&&ocBotPath(relative,false);
        if(!target || !fs.existsSync(target)){res.writeHead(404);res.end('Source file not found.');return;}
        const content=String(form.content||'');
        if(content.includes('\0')){res.writeHead(400);res.end('Binary content is not supported.');return;}
        ocSaveBotFile(target,content,relative);
        writeActivity('oxcontroller.bot_code.edited',{user:a.username,file:relative});
        state.updatedAt=now;ocSaveState(state);return backTo(relative);
      } else if(pathname==='/oxcontroller/bot-code/delete') {
        const relative=ocSafeBotRelative(form.name);
        const target=relative&&ocBotPath(relative,false);
        if(!target || !fs.existsSync(target)){res.writeHead(404);res.end('Source file not found.');return;}
        ocBackupBotFile(target,relative);fs.unlinkSync(target);
        writeActivity('oxcontroller.bot_code.deleted',{user:a.username,file:relative});
      }
      state.updatedAt=now;
      ocSaveState(state);
      return backTo('');
    }

    if (pathname === '/oxcontroller' && req.method === 'GET') {
      const a=auth(req);
      if(!a){redirect(res,'/login');return;}
      if(!requirePermission(a.admin,res,'dashboard.view'))return;
      const state=ocReadState();
      fs.mkdirSync(ocDir,{recursive:true});
      const [apiProbe,siteProbe]=await Promise.all([
        ocProbe(process.env.API_HEALTH_URL || 'http://oxcontroller-fresh:4000/'),
        ocProbe(process.env.PUBLIC_SITE_HEALTH_URL || 'http://oxy-info-site:8080/')
      ]);
      const webhookConfigured=Boolean(String(process.env.LOCKDOWN_WEBHOOK_URL||'').trim());
      const webhookStatus=state.lastWebhookTest||state.lastWebhookDelivery;
      let selected='';
      try { selected=ocSafeBotRelative(url.searchParams.get('botfile')); } catch {}
      let fileContent='';
      const selectedPath=selected&&ocBotPath(selected,false);
      if(selectedPath && fs.existsSync(selectedPath)) {
        try { const st=fs.statSync(selectedPath); if(st.size<=1024*1024)fileContent=fs.readFileSync(selectedPath,'utf8');else selected=''; } catch { selected=''; }
      } else selected='';
      const botFiles=ocListBotFiles();
      const csrfField=`<input type="hidden" name="csrf" value="${ocEsc(a.csrf)}">`;
      const canEditContent=hasPermission(a.admin,'content.edit');
      const isSiteLinked=ocSourceMountConfigured;
      const integrationCard=(title,result,details='')=>`<article class="integration-card"><div class="integration-heading"><span class="status-dot ${result.online?'good':result.configured?'bad':'neutral'}"></span><strong>${ocEsc(title)}</strong></div><div class="integration-value">${ocEsc(result.label)}</div><small>${ocEsc(details || (result.ms!==undefined?`${result.ms} ms`:''))}</small></article>`;
      const updates=state.updates.slice(0,10).map(e=>`<article class="incident-item"><div class="incident-top"><strong>${ocEsc(e.type||'Update')}</strong><small>${ocEsc(e.createdAt||'')} · ${ocEsc(e.author||'Admin')}</small></div><p>${ocEsc(e.message||'')}</p></article>`).join('')||'<div class="empty">No incident updates have been published.</div>';
      const fileLinks=botFiles.map(name=>`<a class="source-file ${selected===name?'active':''}" href="${adminUrl('/oxcontroller')}?botfile=${encodeURIComponent(name)}"><span class="file-glyph">{ }</span><span>${ocEsc(name)}</span></a>`).join('')||'<p class="muted">No source files found in the configured workspace.</p>';
      const webhookDelivery=webhookStatus?`<p class="inline-status ${webhookStatus.success?'success':'error'}">${webhookStatus.success?'Delivered':'Failed'} · ${ocEsc(webhookStatus.message||'')} · ${ocEsc(webhookStatus.at||'')}</p>`:'';
      const sourceNotice=isSiteLinked
        ? `<div class="alert success">Bot source mount is configured. Writes affect the host directory supplied in <code>BOT_SOURCE_HOST_DIR</code>. Every overwrite creates a backup.</div>`
        : `<div class="alert warning"><strong>Workspace mode.</strong> The uploader/editor currently uses the isolated <code>/data/bot-source</code> workspace. It is not the running bot’s source until <code>BOT_SOURCE_HOST_DIR</code> is set to the actual source directory on the VPS. No Docker socket or live container filesystem editing is used.</div>`;
      const botEditor=isOwner(a.admin)?`
        <section class="panel source-workbench">
          <div class="section-header"><div><span class="eyebrow">Owner only</span><h2>Bot source workbench</h2><p>Upload source, edit files, create files and download the current file. Saving does not execute code or restart the live bot.</p></div><div class="workbench-count">${botFiles.length} files</div></div>
          ${sourceNotice}
          <div class="source-layout"><aside class="source-sidebar"><label>Filter files<input type="search" id="oc-source-filter" placeholder="Search source files"></label><nav class="source-file-list" id="oc-source-files">${fileLinks}</nav></aside><div class="source-main">
            <form method="POST" enctype="multipart/form-data" action="${adminUrl('/oxcontroller/bot-code/upload')}" class="upload-row">${csrfField}<label>Upload source file<input type="file" name="file" required accept=".txt,.md,.json,.js,.cjs,.mjs,.ts,.tsx,.jsx,.css,.html,.xml,.yml,.yaml,.conf,.py,.sql,.toml,.sh,.properties"></label><label>Target path (optional)<input name="target" placeholder="src/handlers/example.js"></label><button class="primary" type="submit">Upload</button></form>
            <form method="POST" action="${adminUrl('/oxcontroller/bot-code/new')}" class="new-file-row">${csrfField}<label>Create new source file<input name="name" required placeholder="src/new-module.js"></label><button class="button secondary" type="submit">Create file</button></form>
            ${selected?`<div class="editor-toolbar"><div><strong>${ocEsc(selected)}</strong><span id="oc-editor-state" class="editor-state">Loaded</span></div><div class="action-row"><a class="button secondary" href="${adminUrl('/oxcontroller/bot-code/download')}?botfile=${encodeURIComponent(selected)}">Download</a><button class="button danger" form="oc-bot-code-delete" type="submit">Delete</button></div></div>
              <form id="oc-bot-code-delete" method="POST" action="${adminUrl('/oxcontroller/bot-code/delete')}" onsubmit="return confirm('Delete this source file? A backup will be kept.')">${csrfField}<input type="hidden" name="name" value="${ocEsc(selected)}"></form>
              <form id="oc-bot-code-save" method="POST" action="${adminUrl('/oxcontroller/bot-code/save')}">${csrfField}<input type="hidden" name="name" value="${ocEsc(selected)}"><textarea id="oc-code-editor" name="content" class="code-editor" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" maxlength="1048576">${ocEsc(fileContent)}</textarea><div class="editor-footer"><span>Ctrl + S to save · Max 1 MB · Autosave disabled</span><button class="primary" type="submit">Save source file</button></div></form>`:'<div class="editor-empty"><span class="file-glyph">{ }</span><h3>Select a source file</h3><p>Choose a file from the left, or upload/create one to begin editing.</p></div>'}
          </div></div>
        </section>
        <script>(()=>{const editor=document.getElementById('oc-code-editor'),form=document.getElementById('oc-bot-code-save'),state=document.getElementById('oc-editor-state');if(editor&&form){const original=editor.value;const paint=()=>{if(state){const dirty=editor.value!==original;state.textContent=dirty?'Unsaved changes':'Saved copy loaded';state.classList.toggle('dirty',dirty);}};editor.addEventListener('input',paint);document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&editor){e.preventDefault();form.requestSubmit();}});window.addEventListener('beforeunload',e=>{if(editor.value!==original){e.preventDefault();e.returnValue='';}});}const search=document.getElementById('oc-source-filter'),list=document.getElementById('oc-source-files');if(search&&list)search.addEventListener('input',()=>{const q=search.value.toLowerCase();list.querySelectorAll('a').forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(q));});document.querySelectorAll('textarea[data-counter]').forEach(ta=>{const counter=document.getElementById(ta.dataset.counter);const update=()=>{if(counter)counter.textContent=String(ta.value.length)+'/'+String(ta.maxLength);};ta.addEventListener('input',update);update();});})();</script>
      `:`<section class="panel"><h2>Bot source workbench</h2><p>Only the Owner role can upload, edit, create or delete bot source files.</p></section>`;
      const body=`<section class="ops-hero"><div><span class="eyebrow">Operations centre</span><h2>OxController overview</h2><p>Service reachability, emergency controls, webhook delivery and source tools in one place.</p></div><a class="button secondary" href="${adminUrl('/')}" >Admin dashboard</a></section>
        <section class="integration-grid">${integrationCard('OxController API',apiProbe,'Configured API endpoint')}${integrationCard('Public information site',siteProbe,'Configured info-site endpoint')}${integrationCard('Lockdown webhook',{configured:webhookConfigured,online:webhookConfigured,label:webhookConfigured?'Configured':'Not configured'},'Secret value is never displayed')}${integrationCard('Bot source mount',{configured:true,online:isSiteLinked,label:isSiteLinked?'Host source linked':'Isolated workspace'},isSiteLinked?'Host path mapped into the editor':'Configure BOT_SOURCE_HOST_DIR to link live source')}</section>
        <section class="ops-grid"><article class="panel"><div class="panel-head"><div><span class="eyebrow">Service controls</span><h2>Maintenance</h2><p>Public maintenance flag is shared with the information site.</p></div><span class="pill ${state.maintenance?'warning':'neutral'}">${state.maintenance?'ACTIVE':'OFF'}</span></div><div class="action-row">${canEditContent?`<form method="POST" action="${adminUrl('/oxcontroller/maintenance')}">${csrfField}<button class="primary" name="mode" value="on" type="submit">Enable maintenance</button></form><form method="POST" action="${adminUrl('/oxcontroller/maintenance')}">${csrfField}<button class="button secondary" name="mode" value="off" type="submit">Disable maintenance</button></form>`:'<p>Content edit permission is required to change maintenance.</p>'}</div></article>
        <article class="panel emergency-panel"><div class="panel-head"><div><span class="eyebrow">Critical action</span><h2>Emergency lockdown</h2><p>Enables maintenance, publishes an incident update and sends a Discord alert.</p></div><span class="pill ${state.lockdown?'danger':'neutral'}">${state.lockdown?'ACTIVE':'OFF'}</span></div>${state.lockdown?`<p class="reason-box"><strong>Active reason</strong><br>${ocEsc(state.reason)}</p>`:''}${isOwner(a.admin)?`${!state.lockdown?`<form method="POST" action="${adminUrl('/oxcontroller/lockdown')}" onsubmit="return confirm('Activate emergency lockdown and notify Discord?')">${csrfField}<label>Required reason<textarea class="ops-textbox" name="reason" required minlength="5" maxlength="1000" rows="4" placeholder="Describe what happened, the affected services, and why lockdown is necessary." data-counter="oc-lockdown-counter"></textarea><small class="ops-field-hint"><span id="oc-lockdown-counter">0/1000</span> · Be clear and factual. This reason is included in the Discord alert.</small></label><button class="button danger" type="submit">Activate emergency lockdown</button></form>`:`<form method="POST" action="${adminUrl('/oxcontroller/lockdown/clear')}" onsubmit="return confirm('Clear the emergency lockdown?')">${csrfField}<button class="button secondary" type="submit">Clear lockdown</button></form>`}`:'<p>Owner role required for emergency lockdown.</p>'}</article></section>
        <section class="panel"><div class="panel-head"><div><span class="eyebrow">Discord integration</span><h2>Lockdown webhook</h2><p>Send a test notification without exposing the webhook URL.</p></div><span class="pill ${webhookConfigured?'success':'warning'}">${webhookConfigured?'CONFIGURED':'MISSING'}</span></div>${webhookDelivery}${isOwner(a.admin)?`<form method="POST" action="${adminUrl('/oxcontroller/webhook/test')}">${csrfField}<button class="button secondary" type="submit" ${webhookConfigured?'':'disabled'}>Send test notification</button></form>`:''}</section>
        <section class="panel"><div class="panel-head"><div><span class="eyebrow">Incident communications</span><h2>Publish update</h2><p>Updates are written to the admin state and the information site's <code>updates.json</code>.</p></div></div>${canEditContent?`<form method="POST" action="${adminUrl('/oxcontroller/update')}">${csrfField}<label>Update message<textarea class="ops-textbox" name="message" required maxlength="3000" rows="5" placeholder="Write a clear incident update for your users." data-counter="oc-update-counter"></textarea><small class="ops-field-hint"><span id="oc-update-counter">0/3000</span> · This update is published to the information site's incident feed.</small></label><button class="primary" type="submit">Publish incident update</button></form>`:'<p>Content edit permission is required to publish updates.</p>'}<div class="incident-feed"><h3>Recent updates</h3>${updates}</div></section>
        ${botEditor}
        <footer class="ops-footer">Last checked ${ocEsc(new Date().toISOString())} · Refresh the page to rerun service checks. Bot code saves create a backup and never auto-restart services.</footer>`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(layout('OxController Management',body,a.username,'oxcontroller-management'));
      return;
    }
    // OC_MGMT_END

    if (pathname === '/message-builder' && req.method === 'GET') {
      if (!requirePermission(a.admin, res, 'dashboard.view')) return;
      const body = `<div id="msg-builder" class="message-builder-page">
        <div class="mb-pagebar">
          <div><span class="eyebrow">Components V2</span><h2>Message Builder</h2><p>Build a Discord Components V2 message for tickets, panels and other Oxy interactions.</p></div>
          <div class="mb-page-actions"><button class="button secondary" data-reset>Reset</button><button class="button secondary" data-download>Export JSON</button><button class="button secondary" data-copy>Copy JSON</button><button class="primary" data-fullscreen>Fullscreen</button></div>
        </div>
        <div class="mb-builder-grid">
          <aside class="mb-panel mb-library"><div class="mb-panel-head"><div><strong>Components</strong><small>Drag into the canvas</small></div></div><div data-msg-library></div></aside>
          <main class="mb-panel mb-workspace"><div class="mb-workspace-head"><div><strong>Container</strong><span class="mb-limit">1 container · <span data-count-text>0/3</span> text · <span data-count-interactions>0/10</span> interactions</span></div><div class="mb-workspace-tools"><label>Mode<select data-mode><option value="buttons">Buttons</option><option value="select">Select menu</option></select></label></div></div><div class="mb-canvas-scroller"><div data-msg-canvas></div></div></main>
          <aside class="mb-panel mb-inspector"><div class="mb-panel-head"><div><strong>Inspector</strong><small>Edit selected component</small></div></div><div class="mb-inspector-body" data-msg-inspector></div></aside>
        </div>
        <section class="mb-settings-row"><div class="mb-panel mb-settings-panel"><div class="mb-panel-head"><div><strong>Message settings</strong><small>These settings affect the container and ticket panel</small></div></div><div class="mb-settings-grid"><label>Message title<input data-title value="Ticket Support"></label><label>Accent colour<div class="mb-color"><input type="color" data-accent value="#5865F2"><input data-accent-text value="#5865F2"></div></label><label class="mb-check"><input type="checkbox" data-watermark checked> Add Oxy watermark</label><label class="wide">Watermark text<input data-watermark-text value="-# Powered by Oxy Controller"></label></div><div class="mb-help"><span>Components V2 uses the <code>IS_COMPONENTS_V2</code> flag and structured components instead of legacy content/embeds.</span><span>Buttons are limited to 10 here. Select menus are limited to 15 options here.</span></div></div><div class="mb-panel mb-json-panel"><div class="mb-panel-head"><div><strong>Payload</strong><small>Ready for your bot's send/edit handler</small></div></div><textarea data-msg-json readonly spellcheck="false"></textarea></div></section>
        <div class="mb-mobile-actions"><button class="button secondary" data-add-text>Add text</button><button class="primary" data-add-interaction>Add interaction</button></div>
      </div><script src="${ADMIN_BASE}/message-builder.js?v=1"></script>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout('Message Builder', body, a.username, 'messagebuilder')); return;
    }
    if (pathname === '/ai' && req.method === 'POST') {
      const a = auth(req);
      if (!a) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Not authenticated.'})); return; }
      if (!requirePermission(a.admin,res,'ai.use')) return;
      const body = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Invalid JSON.'})); return; }
      if (!payload.csrf || payload.csrf !== a.csrf) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Invalid CSRF token.'})); return; }
      const task = String(payload.task || '');
      const permission = task === 'summarize' ? 'ai.summarize' : 'ai.format';
      if (!hasPermission(a.admin, 'ai.use') || !hasPermission(a.admin, permission)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:`You do not have permission to use ${permission}.`})); return; }
      try {
        const result = await callAI({task, content:String(payload.content || ''), context:'This is admin-authored Oxy Controller documentation or release content.'});
        writeActivity('ai.' + task, {user:a.username, chars:result.length, model:runtimeAIConfig().model, ip:getClientIP(req)});
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,result}));
      } catch (e) {
        res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:e.message || 'AI request failed.'}));
      }
      return;
    }
    if (pathname === '/logout' && req.method === 'POST') { const a=auth(req); if(a){sessions.delete(a.token); writeActivity('logout',{user:a.username});} clearSession(res); redirect(res,'/login'); return; }

    const a = requireAuth(req, res); if (!a) return;
    const csrf = a.csrf;

    if (pathname === '/account' && req.method === 'GET') {
      const admin = getAdminAny(a.username);
      if (!admin) { res.writeHead(404); res.end('Account not found'); return; }
      const roleNames = (admin.roleIds || []).map(id => getRole(id)?.name || id).filter(Boolean);
      const environmentButton = isOwner(a.admin) ? `<div class="editor-actions" style="margin-top:12px"><a class="button secondary" href="${ADMIN_BASE}/account/environment/">Environment configuration</a></div>` : '';
      const loginHistory = recentActivity(500).filter(e => (e.type === 'login' || e.type === 'login.failed') && e.user === admin.username).slice(0,20);
      const loginHistoryHtml = `<section class="panel" style="margin-top:16px"><div class="panel-head"><div><span class="eyebrow">Security</span><h2>Recent sign-ins</h2><p>Your most recent successful and failed login attempts.</p></div></div><div class="table">${loginHistory.map(e=>`<div class="row"><div><strong>${e.type === 'login' ? 'Successful login' : 'Failed login'}</strong><small>${new Date(e.at).toLocaleString('en-GB')}</small></div><div class="mono">${htmlEscape(e.ip || 'IP unavailable')}</div></div>`).join('') || '<div class="empty">No login history yet.</div>'}</div></section>`;

      const body = `<section class="panel">
        <div class="panel-head"><div><span class="eyebrow">Your account</span><h2>Account settings</h2><p>Update your password without affecting anyone else's account.</p></div></div>
        <div class="meta-grid"><div><span class="eyebrow">Username</span><strong>${htmlEscape(admin.username)}</strong></div><div><span class="eyebrow">Roles</span><strong>${htmlEscape(roleNames.join(', ') || 'No roles')}</strong></div></div>
        <form method="post" action="${ADMIN_BASE}/account/password/" class="editor-form" style="margin-top:20px">
          <input type="hidden" name="csrf" value="${attr(csrf)}">
          <label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label>
          <div class="meta-grid"><label>New password<input type="password" name="newPassword" autocomplete="new-password" required></label><label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" required></label></div>
          <div class="editor-help"><strong>Password requirements</strong><span>No minimum or maximum length is enforced.</span><span>Use a unique password you do not reuse elsewhere.</span></div>
          <div class="editor-actions"><button class="primary" type="submit">Change password</button></div>
        </form>
        ${loginHistoryHtml}
        ${environmentButton}
      </section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(layout('My Account', body, a.username, 'account'));
      return;
    }

    if (pathname === '/account/password' && req.method === 'POST') {
      const body = querystring.parse(await readBody(req));
      if (!checkCsrf(req, res, body)) return;
      const admin = getAdminAny(a.username);
      if (!admin) { res.writeHead(404); res.end('Account not found'); return; }
      const current = String(body.currentPassword || '');
      const next = String(body.newPassword || '');
      const confirm = String(body.confirmPassword || '');
      if (!passwordVerify(current, admin.passwordHash)) {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Password change failed', `<section class="panel"><div class="alert error">Current password is incorrect.</div><p><a class="text-link" href="${ADMIN_BASE}/account/">Back to account</a></p></section>`, a.username, 'account'));
        return;
      }
      if (next !== confirm) {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Password change failed', `<section class="panel"><div class="alert error">The new passwords do not match.</div><p><a class="text-link" href="${ADMIN_BASE}/account/">Back to account</a></p></section>`, a.username, 'account'));
        return;
      }
      if (passwordVerify(next, admin.passwordHash)) {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Password change failed', `<section class="panel"><div class="alert error">Choose a different password from your current password.</div><p><a class="text-link" href="${ADMIN_BASE}/account/">Back to account</a></p></section>`, a.username, 'account'));
        return;
      }
      const admins = loadAdmins();
      const saved = admins.find(x => x.username === a.username);
      if (!saved) { res.writeHead(404); res.end('Account not found'); return; }
      saved.passwordHash = passwordHash(next);
      saved.passwordChangedAt = new Date().toISOString();
      saveAdmins(admins);
      writeActivity('admin.password_changed', {user:a.username});
      const bodyHtml = `<section class="panel"><div class="alert success">Your password has been changed successfully.</div><p>Your current session remains signed in.</p><div class="editor-actions"><a class="button" href="${ADMIN_BASE}/account/">Back to account</a></div></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(layout('Password updated', bodyHtml, a.username, 'account'));
      return;
    }

    if (pathname === '/account/logout-all' && req.method === 'POST') {
      if (!isOwner(a.admin)) {
        res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Owner access required.'); return;
      }
      const body = querystring.parse(await readBody(req)); if (!checkCsrf(req,res,body)) return;
      const count = sessions.size;
      sessions.clear();
      writeActivity('sessions.logout_all',{user:a.username,count});
      clearSession(res);
      redirect(res,'/login');
      return;
    }

    if (pathname === '/account/environment/rotate-session' && req.method === 'POST') {
      if (!isOwner(a.admin)) {
        res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Owner access required.'); return;
      }
      const body = querystring.parse(await readBody(req)); if (!checkCsrf(req,res,body)) return;
      const nextSecret = crypto.randomBytes(48).toString('base64url');
      let envText = readEnvFile();
      envText = upsertEnvValue(envText, 'ADMIN_SESSION_SECRET', nextSecret);
      writeEnvText(envText);
      SESSION_SECRET = nextSecret;
      const count = sessions.size;
      sessions.clear();
      writeActivity('sessions.secret_rotated',{user:a.username,count});
      clearSession(res);
      redirect(res,'/login');
      return;
    }

    if (pathname === '/account/environment' && req.method === 'GET') {
      if (!isOwner(a.admin)) {
        res.writeHead(403, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Forbidden', `<section class="panel"><h2>403</h2><p>Only the Owner account can edit environment configuration.</p></section>`, a.username, 'account'));
        return;
      }
      const ensured = ensureRequiredEnvFile();
      const envText = ensured.text;
      const exists = fs.existsSync(ENV_FILE);
      const status = envConfigStatus(ensured.parsed);
      const statusHtml = status.map(x => `<div class="env-status-row"><span>${htmlEscape(x.label)}</span><strong class="${x.ok?'ok':'missing'}">${x.ok?'✓ Configured':'⚠ Needs configuration'}</strong></div>`).join('');
      const autoMessage = ensured.added ? `<div class="alert success"><strong>Configuration updated.</strong> Missing environment variables were added automatically with safe defaults. Existing values were preserved.</div>` : '';
      const sessionSecurity = `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><span class="eyebrow">Security</span><h3>Session security</h3><p>Rotate the session secret or invalidate every active admin session.</p></div></div><div class="editor-actions"><form method="post" action="${ADMIN_BASE}/account/environment/rotate-session/" style="display:inline" onsubmit="return confirm('Rotate the session secret and sign out every active admin session?')"><input type="hidden" name="csrf" value="${attr(csrf)}"><button class="primary" type="submit">Rotate session secret</button></form><form method="post" action="${ADMIN_BASE}/account/logout-all/" style="display:inline" onsubmit="return confirm('Sign out every active admin session?')"><input type="hidden" name="csrf" value="${attr(csrf)}"><button class="button secondary" type="submit">Log out all sessions</button></form></div></div>`;
      const body = `<section class="panel">
        <div class="panel-head"><div><span class="eyebrow">Owner only</span><h2>Environment configuration</h2><p>Edit the admin service <code>.env</code> file directly from your account.</p></div><a class="button secondary" href="${ADMIN_BASE}/account/">Back to account</a></div>
        ${autoMessage}
        ${sessionSecurity}
        <div class="alert warning"><strong>Be careful.</strong> This file can contain API keys, passwords, session secrets and other sensitive configuration. Changes are backed up before saving. Existing values are never replaced by the automatic configuration check.</div>
        <div class="env-status"><div class="panel-head"><div><h3>Configuration check</h3><p>Oxy checks the variables required by the admin service and adds missing ones automatically.</p></div></div>${statusHtml}</div>
        <form method="post" action="${ADMIN_BASE}/account/environment/save/" class="editor-form">
          <input type="hidden" name="csrf" value="${attr(csrf)}">
          <label>Environment file<textarea class="markdown env-editor" name="env" spellcheck="false" autocomplete="off">${htmlEscape(envText)}</textarea></label>
          <div class="editor-help"><strong>File:</strong> <code>${htmlEscape(ENV_FILE)}</code><span>${exists ? 'Loaded.' : 'File does not currently exist; saving will create it.'}</span></div>
          <div class="editor-actions"><button class="primary" type="submit">Save environment</button><a class="button secondary" href="${ADMIN_BASE}/settings/">Settings</a></div>
        </form>
      </section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});res.end(layout('Environment',body,a.username,'account'));return;
    }

    if (pathname === '/account/environment/save' && req.method === 'POST') {
      if (!isOwner(a.admin)) {
        res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'});res.end('Owner access required.');return;
      }
      const body = querystring.parse(await readBody(req)); if (!checkCsrf(req,res,body)) return;
      const envText = String(body.env || '');
      if (envText.length > 200000) { res.writeHead(413); res.end('Environment file is too large.'); return; }
      const invalid = envText.split(/\r?\n/).some(line => {
        const t=line.trim();
        return t && !t.startsWith('#') && !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t);
      });
      if (invalid) {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Environment save failed', `<section class="panel"><div class="alert error">Invalid .env line detected. Use <code>KEY=value</code> or comments beginning with <code>#</code>.</div><p><a class="text-link" href="${ADMIN_BASE}/account/environment/">Back</a></p></section>`, a.username, 'account'));return;
      }
      // Keep required keys present even if the editor accidentally omits them.
      const beforeSave = parseEnvFile(envText);
      for (const [key, value, description] of requiredEnvDefinitions()) {
        if (!Object.prototype.hasOwnProperty.call(beforeSave, key)) {
          envText = upsertEnvValue(envText, key, key === 'ADMIN_SESSION_SECRET' ? crypto.randomBytes(48).toString('base64url') : value);
          beforeSave[key] = value;
        }
      }
      if (!beforeSave.ADMIN_SESSION_SECRET || /^CHANGE_ME(?:_TO_A_LONG_RANDOM_VALUE)?$/i.test(beforeSave.ADMIN_SESSION_SECRET)) {
        envText = upsertEnvValue(envText, 'ADMIN_SESSION_SECRET', crypto.randomBytes(48).toString('base64url'));
      }
      writeEnvText(envText);
      writeActivity('environment.updated',{user:a.username,file:ENV_FILE});
      const bodyHtml = `<section class="panel"><div class="alert success">Environment configuration saved.</div><p>AI settings are reloaded from the file automatically. Other startup-only settings may require the admin container to be recreated.</p><div class="editor-actions"><a class="button" href="${ADMIN_BASE}/account/environment/">Back to environment</a><a class="button secondary" href="${ADMIN_BASE}/account/">My account</a></div></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});res.end(layout('Environment updated',bodyHtml,a.username,'account'));return;
    }


    if (pathname === '/roadmap' && req.method === 'GET') {
      if (!requirePermission(a.admin, res, 'roadmap.edit')) return;
      const roadmap = readJson(ROADMAP_FILE, DEFAULT_ROADMAP);
      const body = `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Website content</span><h2>Edit public roadmap</h2><p>Changes are saved to shared content and appear on the public roadmap immediately.</p></div><a class="button secondary" href="${ADMIN_BASE}/">Dashboard</a></div><div class="alert warning">Edit the JSON below. Keep the same structure: title, eyebrow, intro, notice, and sections. Each section contains a title, description and items. Every item needs a title and detail.</div><form method="post" action="${ADMIN_BASE}/roadmap/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><label>Roadmap content<textarea class="markdown" name="roadmapJson" rows="32" spellcheck="false" autocomplete="off" required>${htmlEscape(JSON.stringify(roadmap, null, 2))}</textarea></label><div class="editor-help">The page is public at <a href="/roadmap" target="_blank" rel="noreferrer">oxcontroller.app/roadmap</a>. No release dates are promised automatically.</div><div class="editor-actions"><button class="primary" type="submit">Save roadmap</button><a class="button secondary" href="/roadmap" target="_blank" rel="noreferrer">Preview public roadmap</a></div></form></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(layout('Edit roadmap', body, a.username, 'roadmap'));
      return;
    }

    if (pathname === '/roadmap/save' && req.method === 'POST') {
      if (!requirePermission(a.admin, res, 'roadmap.edit')) return;
      const body = querystring.parse(await readBody(req));
      if (!checkCsrf(req, res, body)) return;

      let input;
      try {
        input = JSON.parse(String(body.roadmapJson || ''));
      } catch {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Roadmap not saved', '<section class="panel"><h2>Invalid JSON</h2><p>Fix the JSON syntax and try again.</p></section>', a.username, 'roadmap'));
        return;
      }

      const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
      if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.sections) || input.sections.length > 20) {
        res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
        res.end(layout('Roadmap not saved', '<section class="panel"><h2>Invalid roadmap structure</h2><p>The roadmap must be a JSON object with a sections array of no more than 20 sections.</p></section>', a.username, 'roadmap'));
        return;
      }

      const clean = {
        title: text(input.title, 120) || 'Roadmap',
        eyebrow: text(input.eyebrow, 120),
        intro: text(input.intro, 2000),
        notice: text(input.notice, 2000),
        sections: []
      };

      for (const section of input.sections) {
        if (!section || typeof section !== 'object' || Array.isArray(section) || !Array.isArray(section.items) || section.items.length > 50) {
          res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
          res.end(layout('Roadmap not saved', '<section class="panel"><h2>Invalid section</h2><p>Every section needs an items array containing no more than 50 items.</p></section>', a.username, 'roadmap'));
          return;
        }
        clean.sections.push({
          title: text(section.title, 120) || 'Roadmap items',
          description: text(section.description, 1000),
          items: section.items.map(item => ({
            title: text(item?.title, 160),
            detail: text(item?.detail, 2000)
          })).filter(item => item.title)
        });
      }

      if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > 150000) {
        res.writeHead(413); res.end('Roadmap is too large.'); return;
      }

      writeJson(ROADMAP_FILE, clean);
      writeActivity('roadmap.updated', {user:a.username, sections:clean.sections.length});
      redirect(res, `${ADMIN_BASE}/roadmap/`);
      return;
    }

    if (pathname === '/roles' && req.method === 'GET') {
      if (!requirePermission(a.admin, res, 'roles.view')) return;
      const roles = loadRoles();
      const id = String(url.searchParams.get('id') || '');
      const role = id ? getRole(id) : null;
      const editor = id === 'new' ? {id:'',name:'',description:'',permissions:[],system:false} : role;
      let body;
      if (editor) {
        const checks = PERMISSIONS.map(p=>{const info=PERMISSION_INFO[p]||{label:p,description:'Controls access to this capability.'};return `<label title="${attr(info.description)}" style="display:flex;gap:10px;align-items:flex-start;margin:10px 0;break-inside:avoid"><input type="checkbox" name="permission" value="${attr(p)}" ${(editor.permissions||[]).includes('*')||(editor.permissions||[]).includes(p)?'checked':''} style="margin-top:4px"><span><strong style="display:block">${htmlEscape(info.label)}</strong><small style="display:block;color:var(--muted);font-size:12px;line-height:1.4;margin-top:3px">${htmlEscape(info.description)}</small></span></label>`}).join('');
        body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Roles</span><h2>${htmlEscape(editor.name||'New role')}</h2><p>Create an editable permission set.</p></div><a class="button secondary" href="${ADMIN_BASE}/roles/">Back</a></div><form method="post" action="${ADMIN_BASE}/roles/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="id" value="${attr(editor.id)}"><div class="meta-grid"><label>Name<input name="name" value="${attr(editor.name||'')}" required ${editor.system?'readonly':''}></label><label>Description<input name="description" value="${attr(editor.description||'')}" ${editor.system?'readonly':''}></label></div><div class="panel" style="margin-top:16px"><strong>Permissions</strong><div style="columns:2;margin-top:10px">${checks}</div></div><div class="editor-actions"><button class="primary" type="submit">Save role</button></div></form></section>`;
      } else {
        body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Roles & Permissions</span><h2>Roles</h2><p>Create roles with granular permissions and assign them to admin accounts.</p></div><a class="primary button" href="${ADMIN_BASE}/roles/?id=new">New role</a></div><div class="table">${roles.map(r=>`<div class="row"><div><strong>${htmlEscape(r.name)}</strong><small>${htmlEscape(r.description||'')}</small></div><div><span class="badge">${r.permissions?.includes('*')?'Full access':`${(r.permissions||[]).length} permissions`}</span></div><div class="mono">${htmlEscape(r.id)}</div><div><a class="text-link" href="${ADMIN_BASE}/roles/?id=${encodeURIComponent(r.id)}">Edit</a></div></div>`).join('')}</div></section>`;
      }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout(editor?'Edit role':'Roles',body,a.username,'roles'));return;
    }

    if (pathname === '/roles/save' && req.method === 'POST') {
      if (!requirePermission(a.admin,res,url.searchParams.get('id')?'roles.edit':'roles.create')) return;
      const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;
      const id=String(body.id||'').trim();const roles=loadRoles();let role=id?roles.find(x=>x.id===id):null;
      if(id&& !role){res.writeHead(404);res.end('Role not found');return;}
      if(!role){const clean=String(body.name||'New Role').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||newId();role={id:clean,name:'New Role',description:'',permissions:[],system:false};while(roles.some(x=>x.id===role.id))role.id=`${clean}-${crypto.randomBytes(3).toString('hex')}`;roles.push(role);}
      if(role.system){role.permissions=['*'];}
      else{role.name=String(body.name||'Unnamed Role').trim().slice(0,80);role.description=String(body.description||'').trim().slice(0,240);const selected=Array.isArray(body.permission)?body.permission:[body.permission].filter(Boolean);role.permissions=selected.filter(p=>PERMISSIONS.includes(p));}
      saveRoles(roles);writeActivity(id?'role.updated':'role.created',{user:a.username,roleId:role.id});redirect(res,`/roles/?id=${encodeURIComponent(role.id)}`);return;
    }

    if (pathname === '/roles/delete' && req.method === 'POST') {
      if(!requirePermission(a.admin,res,'roles.delete'))return;const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;const id=String(body.id||'');const role=getRole(id);if(!role){res.writeHead(404);res.end('Role not found');return;}if(role.system){res.writeHead(400);res.end('System roles cannot be deleted.');return;}if(loadAdmins().some(x=>(x.roleIds||[]).includes(id))){res.writeHead(409);res.end('Role is still assigned to an administrator.');return;}saveRoles(loadRoles().filter(x=>x.id!==id));writeActivity('role.deleted',{user:a.username,roleId:id});redirect(res,'/roles');return;
    }

    if (pathname === '/admins' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'admins.view'))return;const username=url.searchParams.get('username');const editing=username&&username!=='new'?getAdminAny(username):null;const target=editing||{username:'',roleIds:['viewer'],enabled:true,system:false};
      const roleChecks=loadRoles().map(r=>`<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" name="roleId" value="${attr(r.id)}" ${(target.roleIds||[]).includes(r.id)?'checked':''} ${r.id==='owner'&&target.system?'disabled':''}><span>${htmlEscape(r.name)}</span></label>`).join('');
      let body;
      if(username){body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Administrator</span><h2>${editing?'Edit account':'Create account'}</h2></div><a class="button secondary" href="${ADMIN_BASE}/admins/">Back</a></div><form method="post" action="${ADMIN_BASE}/admins/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalUsername" value="${attr(editing?.username||'')}"><div class="meta-grid"><label>Username<input name="username" value="${attr(target.username)}" required ${target.system?'readonly':''}></label><label>Password<input type="password" name="password" placeholder="${editing?'Leave blank to keep current password':'Set a password'}" ${editing?'':'required'}></label><label class="check-field"><input type="checkbox" name="enabled" ${target.enabled!==false?'checked':''} ${target.system?'disabled':''}> Account enabled</label></div><div class="panel" style="margin-top:16px"><strong>Roles</strong><div style="margin-top:10px">${roleChecks}</div></div><div class="editor-actions"><button class="primary" type="submit">Save account</button></div></form></section>`;}
      else{const admins=loadAdmins();body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Administrators</span><h2>Admin accounts</h2><p>Set usernames, passwords, roles and account status without editing files.</p></div><a class="primary button" href="${ADMIN_BASE}/admins/?username=new">Add administrator</a></div><div class="table">${admins.map(ad=>`<div class="row"><div><strong>${htmlEscape(ad.username)}</strong><small>${(ad.roleIds||[]).map(id=>htmlEscape(getRole(id)?.name||id)).join(', ')}</small></div><div><span class="badge">${ad.enabled===false?'Disabled':'Active'}</span></div><div>${ad.system?'System owner':''}</div><div class="actions"><a class="text-link" href="${ADMIN_BASE}/admins/?username=${encodeURIComponent(ad.username)}">Edit</a>${ad.system||ad.username===a.username||ad.username===ADMIN_USERNAME?' <span class="muted">Protected</span>':` <form method="post" action="${ADMIN_BASE}/admins/delete/" style="display:inline" onsubmit="return confirm('Delete ${attr(ad.username)}? This cannot be undone.')"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="username" value="${attr(ad.username)}"><button class="text-link danger-link" type="submit">Delete</button></form>`}</div></div>`).join('')}</div></section>`;}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout(username?'Edit administrator':'Administrators',body,a.username,'admins'));return;
    }

    if (pathname === '/admins/save' && req.method === 'POST') {
      const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;const original=String(body.originalUsername||'').trim();const username=String(body.username||'').trim();let admin=original?getAdminAny(original):null;const creating=!admin;
      if(!requirePermission(a.admin,res,creating?'admins.create':'admins.edit'))return;if(!username){res.writeHead(400);res.end('Username is required');return;}
      const admins=loadAdmins();if(admins.some(x=>x.username===username&&(!admin||x!==admin))){res.writeHead(409);res.end('Username already exists');return;}if(admin && admin.username===a.username && username!==a.username){res.writeHead(400,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Account update blocked', `<section class="panel"><div class="alert error">You cannot change your own username from the administrator manager. Use My Account for personal settings.</div><p><a class="text-link" href="${ADMIN_BASE}/admins/">Back to administrators</a></p></section>`, a.username, 'admins'));return;}if(!admin){admin={username,passwordHash:'',roleIds:['viewer'],enabled:true,system:false,createdAt:new Date().toISOString()};admins.push(admin);}if(!admin.system)admin.username=username;
      const password=String(body.password||'');if(password)admin.passwordHash=passwordHash(password);if(!admin.passwordHash){res.writeHead(400);res.end('Password is required for a new account.');return;}
      let roleIds=Array.isArray(body.roleId)?body.roleId:[body.roleId].filter(Boolean);roleIds=roleIds.filter(id=>getRole(id));if(admin.system||admin.username===ADMIN_USERNAME)roleIds=['owner'];if(!roleIds.length)roleIds=['viewer'];admin.roleIds=roleIds;admin.enabled=(admin.system||admin.username===ADMIN_USERNAME)?true:(body.enabled==='on');saveAdmins(admins);writeActivity(creating?'admin.created':'admin.updated',{user:a.username,target:admin.username,roles:roleIds,enabled:admin.enabled});redirect(res,'/admins');return;
    }

    if (pathname === '/admins/delete' && req.method === 'POST') {
      if(!requirePermission(a.admin,res,'admins.delete'))return;const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;const username=String(body.username||'');const target=getAdminAny(username);if(!target){res.writeHead(404);res.end('Administrator not found');return;}if(target.system||username===a.username||username===ADMIN_USERNAME){res.writeHead(400);res.end('This administrator cannot be deleted.');return;}saveAdmins(loadAdmins().filter(x=>x.username!==username));writeActivity('admin.deleted',{user:a.username,target:username});redirect(res,'/admins');return;
    }

    if (pathname === '/' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'dashboard.view'))return;
      const guides=listGuides(); const recent=guides.slice().sort((x,y)=>y.modified.localeCompare(x.modified)).slice(0,6); const analyticsData=analytics();
      const body = `<section class="grid four"><div class="stat"><span>Guides</span><strong>${guides.length}</strong><small>Markdown files</small></div><div class="stat"><span>Docs</span><strong>${listDocs().length}</strong><small>Markdown files</small></div><div class="stat"><span>Words</span><strong>${guides.reduce((n,g)=>n+g.wordCount,0).toLocaleString()}</strong><small>Across all guides</small></div><div class="stat"><span>24h views</span><strong>${analyticsData.last24h}</strong><small>From Nginx access logs</small></div><div class="stat"><span>7d views</span><strong>${analyticsData.last7d}</strong><small>From Nginx access logs</small></div><div class="stat"><span>Releases</span><strong>${listChangelogs().length}</strong><small>Published changelog entries</small></div></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">Content</span><h2>Recently changed</h2></div><div class="actions">${hasPermission(a.admin,'roadmap.edit') ? `<a class="button" href="${ADMIN_BASE}/roadmap/">Edit roadmap</a>` : ''}<a class="button secondary" href="${ADMIN_BASE}/docs/">Manage docs</a>${hasPermission(a.admin,'content.edit') ? `<a class="button" href="${ADMIN_BASE}/editor/">Edit website content</a>` : ''}</div></div><div class="table">${recent.map(g=>`<div class="row"><div><strong>${htmlEscape(g.title||g.file)}</strong><small>${htmlEscape(g.category||'Uncategorised')} · ${g.wordCount} words</small></div><div class="mono">${htmlEscape(g.id||'no-id')}</div><div><a class="text-link" href="${ADMIN_BASE}/editor/?file=${encodeURIComponent(g.file)}">Edit</a></div></div>`).join('') || '<div class="empty">No Markdown guides found.</div>'}</div></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout('Dashboard',body,a.username,'dashboard')); return;
    }

    if (pathname === '/editor' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'docs.view'))return;
      const guides=listGuides(); const selected=url.searchParams.get('file'); const chosen=selected?getGuide(selected):null;
      const editBody = chosen ? (()=>{const raw=fs.readFileSync(chosen.path,'utf8'); const parsed=parseFrontmatter(raw); return `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Editing</span><h2>${htmlEscape(chosen.title||chosen.file)}</h2><small class="mono">${htmlEscape(chosen.path)}</small></div><div class="actions"><a class="button secondary" href="${ADMIN_BASE}/editor/">Close</a><form method="post" action="${ADMIN_BASE}/guide/delete/" onsubmit="return confirm('Delete this guide?')"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="file" value="${attr(chosen.file)}"><button class="button danger" type="submit">Delete</button></form></div></div><form method="post" action="${ADMIN_BASE}/guide/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value="${attr(chosen.file)}"><div class="meta-grid"><label>ID<input name="id" value="${attr(chosen.id||'')}" required></label><label>Title<input name="title" value="${attr(chosen.title||'')}" required></label><label>Slug<input name="slug" value="${attr(chosen.slug||'')}" required></label><label>Category<input name="category" value="${attr(chosen.category||'')}" required></label><label>Difficulty<input name="difficulty" value="${attr(chosen.difficulty||'Beginner')}" required></label><label>Time<input name="time" value="${attr(chosen.time||'')}" placeholder="10 min"></label><label class="wide">Description<input id="ai-summary" name="description" value="${attr(chosen.description||'')}"></label></div>${visualBuilder(parsed.body,'ai-content')}</label><div class="ai-toolbar"><button type="button" class="button secondary" onclick="runOxyAI('format','ai-content',null,'ai-status')">AI Format</button><button type="button" class="button secondary" onclick="runOxyAI('improve','ai-content',null,'ai-status')">AI Improve</button><button type="button" class="button secondary" onclick="runOxyAI('summarize','ai-content','ai-summary','ai-status')">AI Summary</button><span id="ai-status" class="ai-status">AI tools</span></div><div class="editor-help"><strong>Supported blocks</strong><code>:::warning</code><code>:::danger</code><code>:::note</code><code>:::tip</code><code>:::info</code><code>:::container</code><code>:::steps</code></div><div class="editor-actions"><button class="primary" type="submit">Save guide</button><a class="button secondary" target="_blank" href="${ADMIN_BASE}/preview/?file=${encodeURIComponent(chosen.file)}">Preview</a></div></form></section>`;})() : `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Guide library</span><h2>Markdown guides</h2><p>Every guide is a real .md file. No page builder required.</p></div><a class="primary button" href="${ADMIN_BASE}/guide/new/">New guide</a></div><div class="table">${guides.map(g=>`<div class="row"><div><strong>${htmlEscape(g.title||g.file)}</strong><small>${htmlEscape(g.file)} · ${g.wordCount} words</small></div><div><span class="badge">${htmlEscape(g.category||'Guides')}</span></div><div class="mono">${htmlEscape(g.id||'missing')}</div><div><a class="text-link" href="${ADMIN_BASE}/editor/?file=${encodeURIComponent(g.file)}">Edit</a></div></div>`).join('') || '<div class="empty">No guides yet. Create your first Markdown guide.</div>'}</div></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout(chosen?'Edit guide':'Guides',editBody,a.username,'guides')); return;
    }

    if (pathname === '/guide/new' && req.method === 'GET') {
      const id=newId(); const title='New Guide'; const slug='new-guide';
      const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">New guide</span><h2>Create Markdown guide</h2><p>Every new guide gets a generated 16-character ID.</p></div></div><form method="post" action="${ADMIN_BASE}/guide/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value=""><div class="meta-grid"><label>ID<input name="id" value="${id}" required></label><label>Title<input name="title" value="${attr(title)}" required></label><label>Slug<input name="slug" value="${attr(slug)}" required></label><label>Category<input name="category" value="Guides" required></label><label>Difficulty<input name="difficulty" value="Beginner" required></label><label>Time<input name="time" value="10 min"></label><label class="wide">Description<input id="ai-summary" name="description" value=""></label></div><label>Markdown content${visualBuilder(`# New Guide\n\nWrite your guide here.\n\n:::note\nHelpful information goes here.\n:::\n\n:::warning\nImportant information goes here.\n:::` ,'ai-content')}</label><div class="ai-toolbar"><button type="button" class="button secondary" onclick="runOxyAI('format','ai-content',null,'ai-status')">AI Format</button><button type="button" class="button secondary" onclick="runOxyAI('improve','ai-content',null,'ai-status')">AI Improve</button><button type="button" class="button secondary" onclick="runOxyAI('summarize','ai-content','ai-summary','ai-status')">AI Summary</button><span id="ai-status" class="ai-status">AI tools</span></div><div class="editor-help"><strong>Supported blocks</strong><code>:::warning</code><code>:::danger</code><code>:::note</code><code>:::tip</code><code>:::info</code><code>:::container</code><code>:::steps</code></div><button class="primary" type="submit">Create guide</button></form></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout('New guide',body,a.username,'guides')); return;
    }

    if (pathname === '/guide/save' && req.method === 'POST') {
      const body=querystring.parse(await readBody(req)); if(!checkCsrf(req,res,body))return;
      const id=String(body.id||'').trim(); const title=String(body.title||'').trim(); const slug=slugify(body.slug||title); if(!/^[a-f0-9]{16}$/.test(id)||!title){res.writeHead(400);res.end('Invalid guide metadata');return;}
      const fileName=`${id}-${slug}.md`; const original=String(body.originalFile||''); const target=path.join(GUIDE_DIR,fileName);
      if(original && original!==fileName){ const old=path.join(GUIDE_DIR,path.basename(original)); if(fs.existsSync(old)) fs.renameSync(old,target); }
      fs.writeFileSync(target,composeGuide({id,title,description:String(body.description||''),category:String(body.category||'Guides'),difficulty:String(body.difficulty||'Beginner'),time:String(body.time||''),slug},String(body.body||'')),'utf8');
      writeActivity(original?'guide.updated':'guide.created',{user:a.username,id,title,file:fileName}); redirect(res, `${ADMIN_BASE}/editor/?file=${encodeURIComponent(fileName)}`); return;
    }
    if (pathname === '/guide/delete' && req.method === 'POST') {
      if(!requirePermission(a.admin,res,'docs.delete'))return;
      const body=querystring.parse(await readBody(req)); if(!checkCsrf(req,res,body))return; const file=path.basename(String(body.file||'')); const full=path.join(GUIDE_DIR,file); if(!file.endsWith('.md')||!fs.existsSync(full)){res.writeHead(404);res.end('Guide not found');return;} fs.unlinkSync(full); writeActivity('guide.deleted',{user:a.username,file}); redirect(res,'/editor'); return;
    }
    if (pathname === '/preview' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'docs.view'))return;
      const g=getGuide(url.searchParams.get('file')||''); if(!g){res.writeHead(404);res.end('Not found');return;} const raw=fs.readFileSync(g.path,'utf8'); const parsed=parseFrontmatter(raw); const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Preview</span><h2>${htmlEscape(g.title||g.file)}</h2></div><a class="button secondary" href="${ADMIN_BASE}/editor/?file=${encodeURIComponent(g.file)}">Back to editor</a></div>${renderMarkdownLite(parsed.body)}</section>`; res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Preview',body,a.username,'guides'));return;
    }


    if (pathname === '/changelog' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'changelog.view'))return;
      const releases=listChangelogs();
      const selected=url.searchParams.get('file');
      const chosen=selected?getChangelog(selected):null;
      const body = chosen ? (()=>{
        const raw=fs.readFileSync(chosen.path,'utf8'); const parsed=parseChangelogMarkdown(raw);
        return `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Editing</span><h2>${htmlEscape(chosen.version||chosen.file)}</h2><small class="mono">${htmlEscape(chosen.path)}</small></div><div class="actions"><a class="button secondary" href="${ADMIN_BASE}/changelog/">Close</a><form method="post" action="${ADMIN_BASE}/changelog/delete/" onsubmit="return confirm('Delete this release?')"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="file" value="${attr(chosen.file)}"><button class="button danger" type="submit">Delete</button></form></div></div><form method="post" action="${ADMIN_BASE}/changelog/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value="${attr(chosen.file)}"><div class="meta-grid"><label>Version<input name="version" value="${attr(chosen.version||'')}" required></label><label>Date<input name="date" type="date" value="${attr(chosen.date||'')}" required></label><label class="wide">Title<input name="title" value="${attr(chosen.title||'')}" required></label><label class="wide">Summary<input id="ai-summary" name="summary" value="${attr(chosen.summary||'')}"></label></div>${visualBuilder(parsed.body,'ai-content')}<div class="ai-toolbar"><button type="button" class="button secondary" onclick="runOxyAI('format','ai-content',null,'ai-status')">AI Format</button><button type="button" class="button secondary" onclick="runOxyAI('improve','ai-content',null,'ai-status')">AI Improve</button><button type="button" class="button secondary" onclick="runOxyAI('summarize','ai-content','ai-summary','ai-status')">AI Summary</button><span id="ai-status" class="ai-status">Uses your configured AI provider</span></div><div class="editor-help"><strong>Changelog sections</strong><code>## Added</code><code>## Improved</code><code>## Fixed</code><code>## Developer</code><code>## Templates</code><span class="mono">Then use - bullet points under each heading.</span></div><div class="editor-actions"><button class="primary" type="submit">Save release</button></div></form></section>`;
      })() : `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Release library</span><h2>Changelog</h2><p>Create and maintain public release notes without editing the website source.</p></div><a class="primary button" href="${ADMIN_BASE}/changelog/new/">New release</a></div><div class="table">${releases.map(r=>`<div class="row"><div><strong>${htmlEscape(r.version||r.file)} · ${htmlEscape(r.title||'Untitled')}</strong><small>${htmlEscape(r.date||'No date')} · ${(r.items||[]).length} changes</small></div><div><span class="badge">${htmlEscape(r.file)}</span></div><div><a class="text-link" href="${ADMIN_BASE}/changelog/?file=${encodeURIComponent(r.file)}">Edit</a></div></div>`).join('') || '<div class="empty">No changelog releases yet.</div>'}</div></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout(chosen?'Edit release':'Changelog',body,a.username,'changelog')); return;
    }
    if (pathname === '/changelog/new' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'changelog.create'))return;
      const today=new Date().toISOString().slice(0,10);
      const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">New release</span><h2>Create changelog entry</h2><p>Write normal Markdown with grouped change sections.</p></div></div><form method="post" action="${ADMIN_BASE}/changelog/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value=""><div class="meta-grid"><label>Version<input name="version" placeholder="5.1.0" required></label><label>Date<input name="date" type="date" value="${today}" required></label><label class="wide">Title<input name="title" placeholder="What changed in this release" required></label><label class="wide">Summary<input id="ai-summary" name="summary" placeholder="Short overview shown on the public changelog"></label></div><label>Markdown content<textarea class="markdown" id="ai-content" name="body" spellcheck="false">## Added

- New feature

## Improved

- Improvement

## Fixed

- Bug fix

## Developer

- Developer-facing change

## Templates

- Template-related change
</textarea></label><div class="editor-help"><strong>Use headings</strong><code>## Added</code><code>## Improved</code><code>## Fixed</code><code>## Developer</code><code>## Templates</code></div><button class="primary" type="submit">Create release</button></form></section>`;
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout('New release',body,a.username,'changelog')); return;
    }
    if (pathname === '/changelog/save' && req.method === 'POST') {
      const body=querystring.parse(await readBody(req)); if(!checkCsrf(req,res,body))return;
      const version=String(body.version||'').trim(); const date=String(body.date||'').trim(); const title=String(body.title||'').trim(); const summary=String(body.summary||'').trim();
      if(!version || !date || !title){res.writeHead(400);res.end('Version, date, and title are required');return;}
      const fileName=changelogFilename(version,title); const original=String(body.originalFile||''); const target=path.join(CHANGELOG_DIR,fileName);
      if(original && original!==fileName){ const old=path.join(CHANGELOG_DIR,path.basename(original)); if(fs.existsSync(old)) fs.renameSync(old,target); }
      fs.writeFileSync(target,composeChangelog({version,date,title,summary},String(body.body||'')),'utf8');
      writeActivity(original?'changelog.updated':'changelog.created',{user:a.username,version,title,file:fileName}); redirect(res, `${ADMIN_BASE}/changelog/?file=${encodeURIComponent(fileName)}`); return;
    }
    if (pathname === '/changelog/delete' && req.method === 'POST') {
      if(!requirePermission(a.admin,res,'changelog.delete'))return;
      const body=querystring.parse(await readBody(req)); if(!checkCsrf(req,res,body))return; const file=path.basename(String(body.file||'')); const full=path.join(CHANGELOG_DIR,file); if(!file.endsWith('.md')||!fs.existsSync(full)){res.writeHead(404);res.end('Release not found');return;} fs.unlinkSync(full); writeActivity('changelog.deleted',{user:a.username,file}); redirect(res,'/changelog'); return;
    }


    if (pathname === '/docs' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'docs.view'))return;
      const docs=listDocs();
      const selected=url.searchParams.get('file');
      const chosen=selected?getDoc(selected):null;
      const body=chosen ? (()=>{
        const raw=fs.readFileSync(chosen.path,'utf8');
        const parsed=parseFrontmatter(raw);
        return `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Docs editor</span><h2>${htmlEscape(chosen.title||chosen.file)}</h2><small class="mono">${htmlEscape(chosen.path)}</small></div><div class="actions"><a class="button secondary" href="${ADMIN_BASE}/docs/">Close</a><form method="post" action="${ADMIN_BASE}/doc/delete/" onsubmit="return confirm('Delete this document?')"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="file" value="${attr(chosen.file)}"><button class="button danger" type="submit">Delete</button></form></div></div><form method="post" action="${ADMIN_BASE}/doc/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value="${attr(chosen.file)}"><div class="meta-grid"><label>Document ID<input name="id" value="${attr(chosen.id||'')}" readonly></label><label>Title<input name="title" value="${attr(chosen.title||'')}" required></label><label class="wide">Description<input id="ai-summary" name="description" value="${attr(chosen.description||'')}" required></label><label>Section<input name="section" value="${attr(chosen.section||'')}" required></label><label>Order<input name="order" value="${attr(chosen.order||'')}" inputmode="numeric"></label><label>Slug<input name="slug" value="${attr(chosen.slug||'')}" required></label></div>${visualBuilder(parsed.body,'ai-content')}<div class="ai-toolbar"><button type="button" class="button secondary" onclick="runOxyAI('format','ai-content',null,'ai-status')">AI Format</button><button type="button" class="button secondary" onclick="runOxyAI('improve','ai-content',null,'ai-status')">AI Improve</button><button type="button" class="button secondary" onclick="runOxyAI('summarize','ai-content','ai-summary','ai-status')">AI Summary</button><span id="ai-status" class="ai-status">AI tools</span></div><div class="editor-help"><strong>Markdown</strong><code># Heading</code><code>## Section</code><code>:::note</code><code>:::warning</code><code>- List</code><code>Code blocks</code></div><div class="editor-actions"><button class="primary" type="submit">Save document</button><a class="button secondary" href="${ADMIN_BASE}/doc/preview/?file=${encodeURIComponent(chosen.file)}">Preview</a></div></form></section>`;
      })() : `<section class="panel"><div class="panel-head"><div><span class="eyebrow">Documentation</span><h2>Docs editor</h2><p>Create and maintain Markdown documentation separately from the public site's source code.</p></div><a class="primary button" href="${ADMIN_BASE}/doc/new/">New document</a></div><div class="table">${docs.map(d=>`<div class="row"><div><strong>${htmlEscape(d.title||d.file)}</strong><small>${htmlEscape(d.section||'Uncategorised')} · ${d.wordCount} words</small></div><div class="badge">${htmlEscape(d.slug||d.file)}</div><div class="mono">${htmlEscape(d.id||'no-id')}</div><div><a class="text-link" href="${ADMIN_BASE}/docs/?file=${encodeURIComponent(d.file)}">Edit</a></div></div>`).join('') || '<div class="empty">No Markdown docs found.</div>'}</div></section>`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout(chosen?'Edit document':'Docs',body,a.username,'docs'));return;
    }
    if (pathname === '/doc/new' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'docs.create'))return;
      const id=newId();
      const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">New document</span><h2>Create documentation</h2><p>Write a Markdown document with searchable metadata.</p></div><a class="button secondary" href="${ADMIN_BASE}/docs/">Back</a></div><form method="post" action="${ADMIN_BASE}/doc/save/" class="editor-form"><input type="hidden" name="csrf" value="${attr(csrf)}"><input type="hidden" name="originalFile" value=""><div class="meta-grid"><label>Document ID<input name="id" value="${attr(id)}" readonly></label><label>Title<input name="title" placeholder="Getting started" required></label><label class="wide">Description<input id="ai-summary" name="description" placeholder="Short description shown in documentation listings" required></label><label>Section<input name="section" placeholder="Getting Started" required></label><label>Order<input name="order" value="1" inputmode="numeric"></label><label>Slug<input name="slug" placeholder="getting-started" required></label></div><label>Markdown content${visualBuilder(`# Getting started\n\nWrite your documentation here.\n\n## Next steps\n\nAdd the relevant instructions for this topic.` ,'ai-content')}</label><div class="ai-toolbar"><button type="button" class="button secondary" onclick="runOxyAI('format','ai-content',null,'ai-status')">AI Format</button><button type="button" class="button secondary" onclick="runOxyAI('improve','ai-content',null,'ai-status')">AI Improve</button><button type="button" class="button secondary" onclick="runOxyAI('summarize','ai-content','ai-summary','ai-status')">AI Summary</button><span id="ai-status" class="ai-status">AI tools</span></div><div class="editor-actions"><button class="primary" type="submit">Create document</button></div></form></section>`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('New document',body,a.username,'docs'));return;
    }
    if (pathname === '/doc/save' && req.method === 'POST') {
      const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;
      const original=String(body.originalFile||'').trim();
      if(original){if(!requirePermission(a.admin,res,'docs.edit'))return;}else{if(!requirePermission(a.admin,res,'docs.create'))return;}
      const id=String(body.id||'').trim();const title=String(body.title||'').trim();const description=String(body.description||'').trim();const section=String(body.section||'').trim();const slug=slugify(body.slug||title);const order=String(body.order||'').trim();
      if(!/^[a-f0-9]{16}$/.test(id)||!title||!description||!section||!slug){res.writeHead(400);res.end('Invalid document metadata');return;}
      const fileName=docFilename(slug,title);const target=path.join(DOC_DIR,fileName);if(original && path.basename(original)!==fileName){const old=path.join(DOC_DIR,path.basename(original));if(fs.existsSync(old))fs.renameSync(old,target);}fs.writeFileSync(target,composeDoc({id,title,description,section,order,slug},String(body.body||'')),'utf8');writeActivity(original?'doc.updated':'doc.created',{user:a.username,id,title,file:fileName});redirect(res,`${ADMIN_BASE}/docs/?file=${encodeURIComponent(fileName)}`);return;
    }
    if (pathname === '/doc/delete' && req.method === 'POST') {
      if(!requirePermission(a.admin,res,'docs.delete'))return;
      const body=querystring.parse(await readBody(req));if(!checkCsrf(req,res,body))return;const file=path.basename(String(body.file||''));const full=path.join(DOC_DIR,file);if(!file.endsWith('.md')||!fs.existsSync(full)){res.writeHead(404);res.end('Document not found');return;}fs.unlinkSync(full);writeActivity('doc.deleted',{user:a.username,file});redirect(res,'/docs');return;
    }
    if (pathname === '/doc/preview' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'docs.view'))return;
      const d=getDoc(url.searchParams.get('file')||'');if(!d){res.writeHead(404);res.end('Document not found');return;}const raw=fs.readFileSync(d.path,'utf8');const parsed=parseFrontmatter(raw);const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Preview</span><h2>${htmlEscape(d.title||d.file)}</h2></div><a class="button secondary" href="${ADMIN_BASE}/docs/?file=${encodeURIComponent(d.file)}">Back to editor</a></div><div class="md-preview">${renderMarkdownLite(parsed.body)}</div></section>`;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Docs preview',body,a.username,'docs'));return;
    }

    if (pathname === '/analytics' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'analytics.view'))return;
      const d=analytics(); const top=[...d.guides.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15); const body=`<section class="grid three"><div class="stat"><span>GET requests</span><strong>${d.total}</strong><small>Parsed from Nginx</small></div><div class="stat"><span>Last 24h</span><strong>${d.last24h}</strong><small>Public-site requests</small></div><div class="stat"><span>Last 7d</span><strong>${d.last7d}</strong><small>Public-site requests</small></div></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">Top guide routes</span><h2>Traffic</h2></div></div><div class="table">${top.map(([route,count])=>`<div class="row"><div><strong>${htmlEscape(route)}</strong></div><div class="mono">${count} views</div></div>`).join('')||'<div class="empty">No Nginx guide traffic is available yet.</div>'}</div></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">Responses</span><h2>Status codes</h2></div></div><div class="chips">${[...d.status.entries()].sort((a,b)=>b[1]-a[1]).map(([code,count])=>`<span class="chip"><b>${code}</b> ${count}</span>`).join('')||'<span class="empty">No log data.</span>'}</div></section>`; res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Analytics',body,a.username,'analytics'));return;
    }
    if (pathname === '/activity' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'activity.view'))return;
      const events=recentActivity(60); const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Audit trail</span><h2>Admin activity</h2></div></div><div class="table">${events.map(e=>`<div class="row"><div><strong>${htmlEscape(e.type)}</strong><small>${htmlEscape(e.user||'system')} · ${new Date(e.at).toLocaleString('en-GB')}</small></div><div class="mono">${e.ip?`IP ${htmlEscape(e.ip)}`:''}</div><div class="mono">${htmlEscape(e.id||e.file||'')}</div></div>`).join('')||'<div class="empty">No admin activity yet.</div>'}</div></section>`; res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Activity',body,a.username,'activity'));return;
    }
    if (pathname === '/settings' && req.method === 'GET') {
      if(!requirePermission(a.admin,res,'settings.view'))return;
      const body=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Configuration</span><h2>Settings</h2></div></div><div class="settings"><div><strong>Guide directory</strong><code>${htmlEscape(GUIDE_DIR)}</code></div><div><strong>Docs directory</strong><code>${htmlEscape(DOC_DIR)}</code></div><div><strong>Analytics source</strong><code>${htmlEscape(NGINX_LOG)}</code></div><div><strong>Admin base URL</strong><code>https://oxcontroller.app/admin/</code></div><div><strong>Session lifetime</strong><code>12 hours of inactivity</code></div><div><strong>AI provider</strong><code>${runtimeAIConfig().key ? `${htmlEscape(runtimeAIConfig().base)} · ${htmlEscape(runtimeAIConfig().model)}` : 'Not configured'}</code></div></div></section>`; res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(layout('Settings',body,a.username,'settings'));return;
    }

    res.writeHead(404, {'Content-Type':'text/html; charset=utf-8'}); res.end(layout('Not found','<section class="panel"><h2>404</h2><p>That admin page does not exist.</p></section>',a.username));
  } catch (err) {
    console.error(err);
    res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({status:500, message:'Internal admin error'}));
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Oxy Admin listening on :${PORT}`));
