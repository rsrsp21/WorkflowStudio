import { createHash, randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/src/storage/async-database';

export const SESSION_COOKIE = 'workflow_studio_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const USER_ROLES = ['builder', 'reviewer', 'administrator'] as const;
export type UserRole = typeof USER_ROLES[number];
export const DEFAULT_USER_POSITION = 'Developer';

export interface AuthUser { id: string; name: string; email: string; role: UserRole; position: string; createdAt: string }
type UserRow = { id: string; name: string; email: string; password_hash: string; role: UserRole; position: string; created_at: string };
type SessionUserRow = UserRow & { expires_at: string };

function sessionHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
function publicUser(row: UserRow): AuthUser { return { id: row.id, name: row.name, email: row.email, role: row.role, position: row.position || DEFAULT_USER_POSITION, createdAt: row.created_at }; }
function normalizeEmail(email: string) { return email.trim().toLowerCase(); }
function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password: string, storedHash: string) {
  const [salt, storedHex] = storedHash.split(':');
  if (!salt || !storedHex) return false;
  const stored = Buffer.from(storedHex, 'hex');
  const candidate = scryptSync(password, salt, stored.length);
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
const scryptAsync = promisify(scrypt);
async function passwordMatchesAsync(password: string, storedHash: string) {
  const [salt, storedHex] = storedHash.split(':');
  if (!salt || !storedHex) return false;
  const stored = Buffer.from(storedHex, 'hex');
  const candidate = await scryptAsync(password, salt, stored.length) as Buffer;
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export function validateSignup(input: { name?: unknown; email?: unknown; password?: unknown; position?: unknown }) {
  const errors: string[] = [];
  if (typeof input.name !== 'string' || input.name.trim().length < 2) errors.push('Name must contain at least 2 characters.');
  if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) errors.push('Enter a valid email address.');
  if (typeof input.password !== 'string' || input.password.length < 8) errors.push('Password must contain at least 8 characters.');
  if (typeof input.position !== 'string' || input.position.trim().length < 2 || input.position.trim().length > 80) errors.push('Position must contain between 2 and 80 characters.');
  return errors;
}

export function validateProfile(input: { name?: unknown; position?: unknown }) {
  const errors: string[] = [];
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 100) errors.push('Name must contain between 2 and 100 characters.');
  if (typeof input.position !== 'string' || input.position.trim().length < 2 || input.position.trim().length > 80) errors.push('Position must contain between 2 and 80 characters.');
  return errors;
}

export async function createUser(input: { name: string; email: string; password: string; role: UserRole; position?: string }): Promise<AuthUser | null> {
  const db = await getDatabase();
  const row: UserRow = { id: `user_${randomUUID()}`, name: input.name.trim(), email: normalizeEmail(input.email), password_hash: passwordHash(input.password), role: input.role, position: input.position?.trim() || DEFAULT_USER_POSITION, created_at: new Date().toISOString() };
  try {
    await db.run('INSERT INTO users (id, name, email, password_hash, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [row.id, row.name, row.email, row.password_hash, row.role, row.position, row.created_at]);
    return publicUser(row);
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return null;
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const row = await (await getDatabase()).get<UserRow>('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalizeEmail(email)]);
  if (!row) return null;
  return passwordMatches(password, row.password_hash) ? publicUser(row) : null;
}

export async function authenticateUserAsync(email: string, password: string): Promise<AuthUser | null> {
  const row = await (await getDatabase()).get<UserRow>('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalizeEmail(email)]);
  if (!row) {
    await scryptAsync(password, 'workflow-studio-unknown-user', 64);
    return null;
  }
  return await passwordMatchesAsync(password, row.password_hash) ? publicUser(row) : null;
}

export async function updateUserProfile(userId: string, input: { name: string; position: string }): Promise<AuthUser | null> {
  const db = await getDatabase();
  const result = await db.run('UPDATE users SET name = ?, position = ? WHERE id = ?', [input.name.trim(), input.position.trim(), userId]);
  if (!result.changes) return null;
  const row = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  return row ? publicUser(row) : null;
}

export function initialSignupRole(email: string): UserRole {
  const administrators = (process.env.WORKFLOW_STUDIO_BOOTSTRAP_ADMIN_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean);
  return administrators.includes(normalizeEmail(email)) ? 'administrator' : 'builder';
}

export async function listUsers(limit = 50, offset = 0): Promise<AuthUser[]> {
  return (await (await getDatabase()).all<UserRow>('SELECT * FROM users ORDER BY created_at LIMIT ? OFFSET ?', [Math.max(1, Math.min(2000, limit)), Math.max(0, offset)])).map(publicUser);
}

export async function countUsers() { return Number((await (await getDatabase()).get<{ count: number | string }>('SELECT COUNT(*) AS count FROM users'))?.count ?? 0); }

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const row = await (await getDatabase()).get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  return row ? publicUser(row) : null;
}

export async function setUserRole(userId: string, role: UserRole): Promise<AuthUser | null> {
  const db = await getDatabase();
  const result = await db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
  if (!result.changes) return null;
  const row = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  return row ? publicUser(row) : null;
}

export type PasswordChangeResult = 'updated' | 'invalid-current' | 'unchanged' | 'not-found';
export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string): Promise<PasswordChangeResult> {
  const db = await getDatabase();
  const row = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) return 'not-found';
  if (!passwordMatches(currentPassword, row.password_hash)) return 'invalid-current';
  if (passwordMatches(newPassword, row.password_hash)) return 'unchanged';
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash(newPassword), userId]);
  return 'updated';
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const db = await getDatabase();
  await db.transaction(async (tx) => {
    await tx.run('INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [sessionHash(token), userId, expiresAt.toISOString(), now.toISOString()]);
    await tx.run('DELETE FROM sessions WHERE expires_at <= ?', [now.toISOString()]);
    await tx.run('DELETE FROM sessions WHERE user_id = ? AND id_hash NOT IN (SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)', [userId, userId]);
  });
  return { token, expiresAt };
}

export async function deleteSession(token: string | undefined) {
  if (token) await (await getDatabase()).run('DELETE FROM sessions WHERE id_hash = ?', [sessionHash(token)]);
}

export async function userFromSessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const row = await (await getDatabase()).get<SessionUserRow>(`SELECT users.*, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id_hash = ?`, [sessionHash(token)]);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) { await deleteSession(token); return null; }
  return publicUser(row);
}

function cookieToken(cookieHeader: string | null) {
  const encoded = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return encoded ? decodeURIComponent(encoded) : undefined;
}

export function getRequestUser(request: Request) { return userFromSessionToken(cookieToken(request.headers.get('cookie'))); }
export async function getCurrentUser() { return await userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value); }
export async function requirePageUser() { const user = await getCurrentUser(); if (!user) redirect('/login'); return user; }

export const sessionCookieOptions = (expires: Date) => ({ httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', expires });
