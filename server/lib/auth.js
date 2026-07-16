// Lösenordsskydd: scrypt-hashat lösenord + sessionscookies (HMAC-tokens).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dagar
const COOKIE_NAME = 'solvakt_session';

function load() {
  try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return { sessions: {} }; }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function hasPassword() {
  return Boolean(load().hash);
}

export function setPassword(password) {
  if (!password || password.length < 8) throw new Error('Lösenordet måste vara minst 8 tecken');
  const data = load();
  data.salt = crypto.randomBytes(16).toString('hex');
  data.hash = hashPassword(password, data.salt);
  data.sessions = {}; // logga ut alla vid lösenordsbyte
  save(data);
}

export function verifyPassword(password) {
  const data = load();
  if (!data.hash) return false;
  const candidate = Buffer.from(hashPassword(password, data.salt), 'hex');
  const stored = Buffer.from(data.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function createSession() {
  const data = load();
  const token = crypto.randomBytes(32).toString('hex');
  data.sessions ||= {};
  // Städa utgångna sessioner
  for (const [t, exp] of Object.entries(data.sessions)) {
    if (exp < Date.now()) delete data.sessions[t];
  }
  data.sessions[token] = Date.now() + SESSION_TTL_MS;
  save(data);
  return token;
}

export function destroySession(token) {
  const data = load();
  if (data.sessions?.[token]) {
    delete data.sessions[token];
    save(data);
  }
}

function isValidSessionToken(token) {
  if (!token) return false;
  const exp = load().sessions?.[token];
  return Boolean(exp && exp > Date.now());
}

export function isAuthenticated(req) {
  return isValidSessionToken(getCookie(req));
}

function getCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=');
  }
  return null;
}

export function sessionCookie(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function middleware(req, res, next) {
  // Öppna vägar: auth-endpoints + statiska filer (SPA:n visar login-skärm själv)
  if (!req.path.startsWith('/api') || req.path.startsWith('/api/auth/')) return next();
  if (!hasPassword()) return next(); // första körningen: inget lösenord satt ännu
  if (isValidSessionToken(getCookie(req))) return next();
  res.status(401).json({ error: 'UNAUTHORIZED' });
}

export function currentToken(req) {
  return getCookie(req);
}
