const crypto = require('node:crypto');

function getEncryptionKey() {
  const raw = String(process.env.ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(raw, 'hex');
}

function encryptSecret(value) {
  if (value == null || value === '') return value;
  const key = getEncryptionKey();
  if (!key) return String(value);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  if (value == null || value === '') return value;
  const raw = String(value);
  if (!raw.startsWith('enc:v1:')) return raw;

  const key = getEncryptionKey();
  if (!key) throw new Error('ENCRYPTION_KEY is required to decrypt stored secrets.');

  const [, version, ivRaw, tagRaw, dataRaw] = raw.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted secret.');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
