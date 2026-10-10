function cleanUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function csv(value) {
  return String(value || '')
    .split(/[|\n]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function urlFromOrigins(value) {
  const first = String(value || '').split(',').map(v => v.trim()).find(Boolean);
  return cleanUrl(first);
}

function websiteUrl() {
  return cleanUrl(process.env.WEBSITE_URL) || urlFromOrigins(process.env.WEBSITE_API_CORS_ORIGINS);
}

function dashboardUrl() {
  if (cleanUrl(process.env.DASHBOARD_URL)) return cleanUrl(process.env.DASHBOARD_URL);
  const redirect = cleanUrl(process.env.DASHBOARD_REDIRECT_URI);
  if (redirect) {
    try { return new URL(redirect).origin; } catch {}
  }
  return '';
}

function publicApiUrl() {
  return cleanUrl(process.env.PUBLIC_API_URL) || cleanUrl(process.env.API_PUBLIC_URL);
}

function websiteMessages() {
  const values = csv(process.env.WEBSITE_STATUS_MESSAGES);
  return values.length ? values : ['Website message not configured.'];
}

function dashboardMessages() {
  const values = csv(process.env.DASHBOARD_STATUS_MESSAGES);
  return values.length ? values : ['Dashboard message not configured.'];
}

function rotationMs(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1000 ? value : 5000;
}

function rotatingMessage(messages, interval) {
  const list = Array.isArray(messages) && messages.length ? messages : [''];
  const ms = Number(interval) >= 1000 ? Number(interval) : 5000;
  return list[Math.floor(Date.now() / ms) % list.length];
}

function websiteMessage() {
  return rotatingMessage(websiteMessages(), rotationMs('WEBSITE_MESSAGE_ROTATION_MS'));
}

function dashboardMessage() {
  return rotatingMessage(dashboardMessages(), rotationMs('DASHBOARD_MESSAGE_ROTATION_MS'));
}

function redirectUri() {
  if (cleanUrl(process.env.DASHBOARD_REDIRECT_URI)) return process.env.DASHBOARD_REDIRECT_URI;
  const base = dashboardUrl();
  return base ? `${base}/auth/callback` : '/auth/callback';
}

module.exports = {
  websiteUrl,
  dashboardUrl,
  publicApiUrl,
  websiteMessages,
  dashboardMessages,
  rotationMs,
  websiteMessage,
  dashboardMessage,
  redirectUri
};
