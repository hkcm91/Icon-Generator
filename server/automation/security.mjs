import { createHmac, timingSafeEqual } from 'node:crypto';
import { coded } from './recipe.mjs';

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

function secret() {
  return process.env.ICON_AUTOMATION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'icon-generator-local-development');
}

function signature(value) {
  const key = secret();
  if (!key) throw coded('AUTOMATION_NOT_CONFIGURED', 'ICON_AUTOMATION_SECRET is required in production.');
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function signPayload(payload) {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

export function verifyPayload(token) {
  const [encoded, supplied] = String(token ?? '').split('.');
  if (!encoded || !supplied) throw coded('INVALID_TOKEN', 'The signed token is malformed.');
  const expected = signature(encoded);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw coded('INVALID_TOKEN', 'The signed token is invalid.');
  let payload;
  try { payload = JSON.parse(decode(encoded)); } catch { throw coded('INVALID_TOKEN', 'The signed token payload is invalid.'); }
  if (payload.expires_at && Date.now() > payload.expires_at) throw coded('EXPIRED_TOKEN', 'The plan has expired; create a fresh plan.');
  return payload;
}

export function webhookToken(jobId, itemId) {
  return signPayload({ kind: 'replicate-webhook', job_id: jobId, item_id: itemId });
}

export function verifyWebhook(token, jobId, itemId) {
  const payload = verifyPayload(token);
  return payload.kind === 'replicate-webhook' && payload.job_id === jobId && payload.item_id === itemId;
}

export function ownerFromRequest(request) {
  const configuredToken = process.env.ICON_MCP_BEARER_TOKEN;
  if (!configuredToken) {
    const production = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
    return { ok: !production, ownerKey: 'default' };
  }
  const header = String(request.headers?.authorization ?? '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(configuredToken);
  return {
    ok: a.length === b.length && timingSafeEqual(a, b),
    ownerKey: 'default',
  };
}
