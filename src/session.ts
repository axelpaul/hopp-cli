import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export type Session = { accessToken: string; refreshToken?: string; userId?: string; projectId?: string };
export function configDir(): string {
  return process.env.HOPP_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'hopp-cli');
}
export function validateSession(input: unknown): Session {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Session must be an object');
  const value = input as Record<string, unknown>;
  const session: Partial<Session> = {};
  for (const key of ['accessToken', 'refreshToken', 'userId', 'projectId'] as const) {
    const field = value[key];
    if (field === undefined && key !== 'accessToken') continue;
    if (typeof field !== 'string' || !field.trim() || /[\x00-\x1f\x7f]/.test(field)) throw new Error(`Invalid session field: ${key}`);
    session[key] = field;
  }
  return session as Session;
}
// Reject existing symbolic links anywhere in the config path, including parent directories.
export async function safeDirectory(create: boolean): Promise<string> {
  const dir = resolve(configDir());
  let current = parse(dir).root;
  for (const part of dir.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (create) await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe config directory');
  }
  if (create) await chmod(dir, 0o700);
  else {
    const stat = await lstat(dir);
    if (stat.mode & 0o077) throw new Error('Unsafe config directory permissions');
  }
  return dir;
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
export async function loadSession(): Promise<Session | null> {
  if (process.env.HOPP_ACCESS_TOKEN !== undefined) return validateSession({ accessToken: process.env.HOPP_ACCESS_TOKEN });
  try {
    const dir = await safeDirectory(false);
    const handle = await open(join(dir, 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o077) || stat.nlink !== 1) throw new Error('Unsafe session file');
      return validateSession(JSON.parse(await handle.readFile('utf8')) as unknown);
    } finally { await handle.close(); }
  } catch (error: unknown) {
    if (missing(error)) return null;
    throw new Error('Saved session unavailable; check permissions or import again');
  }
}
const heldLock = new AsyncLocalStorage<string>();
export async function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  const dir = await safeDirectory(true);
  if (heldLock.getStore() === dir) return action();
  const lockPath = join(dir, 'session.lock');
  let lock;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error('Session change already in progress (or stale session.lock); no request sent'); }
  try { return await heldLock.run(dir, action); }
  finally { await lock.close(); await unlink(lockPath); }
}
export async function importSession(input: unknown): Promise<{ stored: true }> {
  const session = validateSession(input);
  return withSessionLock(() => writeSession(session));
}
async function writeSession(input: unknown): Promise<{ stored: true }> {
  const session = validateSession(input);
  const dir = await safeDirectory(true);
  const file = join(dir, 'auth.json');
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe session file');
  } catch (error: unknown) { if (!missing(error)) throw error; }
  const temporary = join(dir, `.auth-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(session)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
  return { stored: true };
}
export async function sessionStatus(): Promise<{ sessionStored: boolean; source: 'environment' | 'file' | 'none' }> {
  const sessionStored = !!(await loadSession());
  return { sessionStored, source: !sessionStored ? 'none' : process.env.HOPP_ACCESS_TOKEN !== undefined ? 'environment' : 'file' };
}
// Local only: does not revoke a remote session or unset environment credentials.
export async function logout(): Promise<{ removed: boolean }> {
  return withSessionLock(removeLocalSession);
}
async function removeLocalSession(): Promise<{ removed: boolean }> {
  try { const dir = await safeDirectory(false); await unlink(join(dir, 'auth.json')); return { removed: true }; }
  catch (error: unknown) { if (missing(error)) return { removed: false }; throw new Error('Could not remove local session'); }
}
