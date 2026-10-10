const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db/database');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function websiteCorsOrigins() {
  return String(process.env.WEBSITE_API_CORS_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function websiteAuth(req, res, next) {
  const configured = String(process.env.WEBSITE_API_KEY || '').trim();
  if (!configured) {
    return res.status(503).json({
      error: 'Website API authentication is not configured.',
      code: 'WEBSITE_API_NOT_CONFIGURED'
    });
  }

  const token = String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!token || !safeEqual(token, configured)) {
    return res.status(401).json({
      error: 'Invalid website API key.',
      code: 'INVALID_WEBSITE_API_KEY'
    });
  }

  req.websiteApiAuthenticated = true;
  next();
}

function publicTemplate(row) {
  if (!row) return null;
  let definition = {};
  try { definition = JSON.parse(row.definition_json || '{}'); } catch {}

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    source: row.source,
    status: row.status,
    definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: row.status === 'published' ? `/v1/website/template/${row.creator_slug || `creator-${String(row.created_by).slice(-6)}`}/${row.id}/download` : null
  };
}

function loadFeatures() {
  const file = path.resolve(__dirname, '../../dashboard/features.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : (data.features || data);
  } catch {
    return [];
  }
}

function attachWebsiteApi(app) {
  if (String(process.env.WEBSITE_API_ENABLED || 'true') !== 'true') return;

  const router = require('express').Router();
  const origins = websiteCorsOrigins();

  router.use((req, res, next) => {
    const origin = String(req.headers.origin || '');
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'false');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  router.get('/', (req, res) => {
    res.json({
      ok: true,
      service: 'oxy-controller-website-api',
      version: require('../../package.json').version,
      endpoints: {
        health: '/v1/website/health',
        status: '/v1/website/status',
        features: '/v1/website/features',
        templates: '/v1/website/templates',
        template: '/v1/website/templates/:slug',
        submitTemplate: 'POST /v1/website/templates'
      }
    });
  });

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'oxy-controller-website-api',
      version: require('../../package.json').version,
      uptime: process.uptime(),
      time: new Date().toISOString()
    });
  });

  router.get('/status', (req, res) => {
    const info = global.__oxBotInfo || {};
    res.json({
      ok: true,
      bot: {
        online: Boolean(info.ok),
        guilds: Number(info.guilds || global.__oxManagerGuilds || 0),
        members: Number(info.members || 0),
        uptime: process.uptime()
      },
      services: {
        dashboard: String(process.env.DASHBOARD_ENABLED || 'true') === 'true' ? 'operational' : 'disabled'
      },
      time: new Date().toISOString()
    });
  });

  router.get('/features', (req, res) => {
    res.json({ ok: true, features: loadFeatures() });
  });

  router.get('/templates', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const category = String(req.query.category || '').trim().toLowerCase();
    let templates = db.listTemplates('published', limit * 2).map(publicTemplate);
    if (category) templates = templates.filter(t => String(t.category).toLowerCase() === category);
    res.json({ ok: true, templates: templates.slice(0, limit), total: templates.length });
  });

  router.get('/template/:creator/:id', (req, res) => {
    const creator = String(req.params.creator || '').trim().toLowerCase();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    const row = db.getTemplate(id);
    if (!row || row.status !== 'published') return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    const expected = String(row.creator_slug || `creator-${String(row.created_by).slice(-6)}`).toLowerCase();
    if (expected !== creator) return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    const versions = db.listTemplateVersions(row.id, 50);
    res.json({ ok: true, template: publicTemplate(row), changelog: versions });
  });

  router.get('/template/:creator/:id/download', (req, res) => {
    const creator = String(req.params.creator || '').trim().toLowerCase();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).send('Template not found.');
    const row = db.getTemplate(id);
    if (!row || row.status !== 'published') return res.status(404).send('Template not found.');
    const expected = String(row.creator_slug || `creator-${String(row.created_by).slice(-6)}`).toLowerCase();
    if (expected !== creator) return res.status(404).send('Template not found.');
    const service = require('../services/templates');
    const body = service.serverLayoutText(row);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${service.templateFilename(row)}"`);
    res.send(body);
  });

  router.get('/template/:creator/:id/versions/:version', (req, res) => {
    const creator = String(req.params.creator || '').trim().toLowerCase();
    const id = Number(req.params.id);
    const version = Number(req.params.version);
    const row = db.getTemplate(id);
    if (!row || row.status !== 'published') return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    const expected = String(row.creator_slug || `creator-${String(row.created_by).slice(-6)}`).toLowerCase();
    if (expected !== creator) return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    const v = db.getTemplateVersion(id, version);
    if (!v) return res.status(404).json({ error: 'Template version not found.', code: 'TEMPLATE_VERSION_NOT_FOUND' });
    let definition = {}; try { definition = JSON.parse(v.definition_json || '{}'); } catch {}
    res.json({ ok: true, version: { id:v.id, version:v.version, name:v.name, description:v.description, changeLog:v.change_log, changedBy:v.changed_by, createdAt:v.created_at, definition } });
  });

  router.get('/templates/:slug', (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const rows = db.listTemplates('published', 100).filter(row => row.slug === slug);
    if (!rows.length) return res.status(404).json({ error: 'Template not found.', code: 'TEMPLATE_NOT_FOUND' });
    res.json({ ok: true, template: publicTemplate(rows[0]) });
  });

  router.post('/templates', websiteAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = String(req.body?.category || 'community').trim().slice(0, 60);
    const createdBy = String(req.body?.created_by || '').trim();
    const definition = req.body?.definition;

    if (!name || name.length > 100) return res.status(400).json({ error: 'Template name is required and must be 100 characters or fewer.', code: 'INVALID_TEMPLATE_NAME' });
    if (!description || description.length > 500) return res.status(400).json({ error: 'Template description is required and must be 500 characters or fewer.', code: 'INVALID_TEMPLATE_DESCRIPTION' });
    if (!createdBy || createdBy.length > 128) return res.status(400).json({ error: 'created_by is required.', code: 'INVALID_CREATOR' });
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return res.status(400).json({ error: 'definition must be a JSON object.', code: 'INVALID_TEMPLATE_DEFINITION' });

    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45) || 'community-template';
    const slug = `${slugBase}-${Date.now().toString(36)}`;
    const template = db.createTemplate({
      slug,
      name,
      description,
      category,
      version: 1,
      source: 'community',
      status: 'pending',
      createdBy,
      creatorNote: 'Submitted through the Oxy Controller website API.',
      definition,
      prompt: null
    });

    res.status(201).json({ ok: true, template: publicTemplate(template) });
  });

  app.use('/v1/website', router);
}

module.exports = { attachWebsiteApi };
