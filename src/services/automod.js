const fs = require('node:fs');
const path = require('node:path');
const db = require('../db/database');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config', 'automod');
const WORDS_FILE = path.join(CONFIG_DIR, 'words.txt');
const DEFAULTS_FILE = path.join(CONFIG_DIR, 'defaults.json');

const DEFAULTS = {
  enabled: true,
  deleteMessages: true,
  logActions: true,
  logChannelId: null,
  bypassAdmins: true,
  defaultAction: 'delete_warn',
  modules: {
    words: true,
    spam: true,
    duplicate: true,
    mentions: true,
    links: true,
    invites: true,
    caps: true,
    emojis: true
  },
  thresholds: {
    spamMessages: 6,
    spamWindowMs: 8000,
    duplicate: 3,
    mentions: 8,
    capsRatio: 0.75,
    capsMinimum: 12,
    emojis: 15
  },
  escalation: {
    enabled: true,
    threshold: 3,
    action: 'timeout',
    duration: 300
  }
};

const recent = new Map();
const lastMessage = new Map();

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function ensureFiles() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(WORDS_FILE)) {
    fs.writeFileSync(WORDS_FILE, '# Oxy Controller AutoMod word list\n# Format: word, category\n\n');
  }
  if (!fs.existsSync(DEFAULTS_FILE)) {
    fs.writeFileSync(DEFAULTS_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
  }
}

function mergeConfig(base, incoming) {
  const out = cloneDefaults();
  Object.assign(out, base || {});
  Object.assign(out, incoming || {});
  out.modules = { ...DEFAULTS.modules, ...(base?.modules || {}), ...(incoming?.modules || {}) };
  out.thresholds = { ...DEFAULTS.thresholds, ...(base?.thresholds || {}), ...(incoming?.thresholds || {}) };
  out.escalation = { ...DEFAULTS.escalation, ...(base?.escalation || {}), ...(incoming?.escalation || {}) };
  return out;
}

function loadDefaults() {
  ensureFiles();
  try {
    const file = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
    return mergeConfig(DEFAULTS, {
      ...file,
      enabled: process.env.AUTOMOD_ENABLED !== 'false',
      deleteMessages: process.env.AUTOMOD_DELETE_MESSAGES !== 'false',
      logActions: process.env.AUTOMOD_LOGGING !== 'false',
      bypassAdmins: process.env.AUTOMOD_BYPASS_ADMINS !== 'false'
    });
  } catch {
    return mergeConfig(DEFAULTS, {
      enabled: process.env.AUTOMOD_ENABLED !== 'false',
      deleteMessages: process.env.AUTOMOD_DELETE_MESSAGES !== 'false',
      logActions: process.env.AUTOMOD_LOGGING !== 'false',
      bypassAdmins: process.env.AUTOMOD_BYPASS_ADMINS !== 'false'
    });
  }
}

function loadWords() {
  ensureFiles();
  return fs.readFileSync(WORDS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#')) return null;
      const comma = clean.indexOf(',');
      if (comma === -1) return null;
      const word = clean.slice(0, comma).trim();
      const category = clean.slice(comma + 1).trim().toLowerCase();
      return word && category ? { word, category, line: index + 1 } : null;
    })
    .filter(Boolean);
}

function saveWords(words) {
  ensureFiles();
  fs.writeFileSync(WORDS_FILE, [
    '# Oxy Controller AutoMod word list',
    '# Format: word, category',
    '',
    ...words.map(x => `${x.word}, ${x.category}`),
    ''
  ].join('\n'));
}

function categories() { return [...new Set(loadWords().map(x => x.category))].sort(); }
function addWord(word, category) { const words = loadWords(); words.push({ word: word.trim(), category: category.trim().toLowerCase() }); saveWords(words); return true; }
function removeWord(word) { const words = loadWords(); const next = words.filter(x => x.word.toLowerCase() !== word.trim().toLowerCase()); saveWords(next); return next.length !== words.length; }
function updateWord(oldWord, word, category) { const words = loadWords(); const item = words.find(x => x.word.toLowerCase() === oldWord.trim().toLowerCase()); if (!item) return false; item.word = word.trim(); item.category = category.trim().toLowerCase(); saveWords(words); return true; }

function detect(content) {
  const t = String(content || '').toLowerCase();
  return loadWords().filter(x => {
    const w = String(x.word || '').trim().toLowerCase();
    if (!w) return false;
    if (w.includes(' ')) return t.includes(w);
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
    return new RegExp(`(^|[^\p{L}\p{N}])${escaped}($|[^\p{L}\p{N}])`, 'u').test(t);
  });
}

function guildConfig(guildId) {
  const row = db.getGuildConfig(guildId);
  let settings = {};
  try { settings = JSON.parse(row.settings_json || '{}'); } catch {}
  return mergeConfig(loadDefaults(), settings.automod || {});
}

function inspect(message, suppliedConfig = null) {
  const cfg = suppliedConfig ? mergeConfig(loadDefaults(), suppliedConfig) : guildConfig(message.guildId);
  if (!cfg.enabled) return [];

  const out = [];
  const text = message.content || '';
  const now = Date.now();
  const key = `${message.guildId}:${message.author.id}`;

  const list = (recent.get(key) || []).filter(x => now - x < cfg.thresholds.spamWindowMs);
  list.push(now);
  recent.set(key, list);
  if (cfg.modules.spam && list.length >= cfg.thresholds.spamMessages) {
    out.push({ category: 'spam', reason: 'message rate' });
  }

  const prev = lastMessage.get(key);
  if (cfg.modules.duplicate && prev && prev.text === text) {
    prev.count++;
    if (prev.count >= cfg.thresholds.duplicate) out.push({ category: 'duplicate', reason: 'repeated message' });
  } else {
    lastMessage.set(key, { text, count: 1 });
  }

  if (cfg.modules.words) out.push(...detect(text).map(x => ({ category: x.category, reason: 'blocked word', word: x.word })));
  if (cfg.modules.mentions && message.mentions.users.size >= cfg.thresholds.mentions) out.push({ category: 'mentions', reason: 'mention spam' });

  const letters = text.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (cfg.modules.caps && letters.length >= cfg.thresholds.capsMinimum && upper / letters.length >= cfg.thresholds.capsRatio) {
    out.push({ category: 'caps', reason: 'excessive caps' });
  }

  const emojis = (text.match(/<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu) || []).length;
  if (cfg.modules.emojis && emojis >= cfg.thresholds.emojis) out.push({ category: 'emojis', reason: 'emoji spam' });

  const urls = (text.match(/https?:\/\/[^\s]+/gi) || []);
  if (cfg.modules.links && urls.length) out.push({ category: 'links', reason: 'link detected' });
  if (cfg.modules.invites && /(discord\.gg|discord(?:app)?\.com\/invite)\//i.test(text)) out.push({ category: 'invites', reason: 'Discord invite' });

  return [...new Map(out.map(x => [`${x.category}:${x.reason}:${x.word || ''}`, x])).values()];
}

module.exports = {
  WORDS_FILE,
  DEFAULTS_FILE,
  DEFAULTS,
  loadDefaults,
  loadGuildConfig: guildConfig,
  loadWords,
  categories,
  addWord,
  removeWord,
  updateWord,
  detect,
  inspect
};
