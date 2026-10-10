function truncate(s, n = 1800) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 3) + '...' : s; }
function json(data, n = 3000) { const s = JSON.stringify(data, null, 2); return `\`\`\`json\n${truncate(s, n)}\n\`\`\``; }
function duration(seconds) {
  seconds = Math.max(0, Number(seconds || 0));
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}
module.exports = { truncate, json, duration };
