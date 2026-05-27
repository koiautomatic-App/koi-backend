const crypto = require('crypto');
const config = require('../config');

const ENC_KEY = Buffer.from(config.ENCRYPTION_KEY.slice(0, 32), 'utf8');

const encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
};

const decrypt = (payload) => {
  try {
    const parts = payload.split(':');
    const ivHex = parts[0];
    const tagHex = parts[1];
    const encHex = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
};

module.exports = { encrypt, decrypt };
