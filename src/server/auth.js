import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db, { nowIso } from './db.js';
import { readCookie, sessionCookie } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'iris_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, key] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const attempted = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), attempted);
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationName: user.organization_name,
    providerType: user.provider_type,
    createdAt: user.created_at
  };
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, tokenHash, expires, nowIso());

  return {
    token,
    cookie: sessionCookie(token, SESSION_TTL_SECONDS)
  };
}

export function destroySession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function getAuthenticatedUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const user = db.prepare(`
    SELECT users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
    LIMIT 1
  `).get(hashToken(token), nowIso());

  return user || null;
}
