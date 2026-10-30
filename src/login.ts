import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { open, rename, unlink, lstat } from 'node:fs/promises';
import { configDir, importSession, safeDirectory, withSessionLock } from './session.ts';
import { http } from './transport.ts';

const pendingPath = () => join(configDir(),'pending-login.json');
export async function loginRequest(phone: string, confirm: boolean) {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('Phone must use international +country format');
  if (!confirm) return {dryRun:true,action:'request SMS',phone:'[redacted]'};
  if (process.env.HOPP_AUTH_ENABLE_WRITES !== '1') throw new Error('Set HOPP_AUTH_ENABLE_WRITES=1 for SMS/login');
  return withSessionLock(async () => {
  // Pending auth uses the same secure config path checks as the session store.
  await safeDirectory(true);
  try {
    const stat = await lstat(pendingPath());
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error('Unsafe pending file');
    const pending = await Bun.file(pendingPath()).json();
    if (Date.now()-pending.createdAt < 600000) throw new Error('SMS already pending; verify it rather than requesting another');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = await http('/user/request-pin-app',{phone,channel:'sms'},undefined,fetch,phone);
  if (typeof result.token !== 'string' || !result.token) throw new Error('No request token returned; no pending login established');
  const temp = join(configDir(),'.pending-'+randomUUID());
  const file = await open(temp,'wx',0o600);
  try { await file.writeFile(JSON.stringify({phone,token:result.token,createdAt:Date.now()})); await file.sync(); } finally {await file.close();}
  await rename(temp,pendingPath());
  return {sent:true,pending:true};
  });
}
export async function loginVerify(code: string, confirm: boolean) {
  if (!/^\d{4}$/.test(code)) throw new Error('Expected four-digit SMS code');
  if (!confirm) return {dryRun:true,action:'verify SMS',code:'[redacted]'};
  if (process.env.HOPP_AUTH_ENABLE_WRITES !== '1') throw new Error('Set HOPP_AUTH_ENABLE_WRITES=1 for SMS/login');
  return withSessionLock(async () => {
  await safeDirectory(false);
  const stat = await lstat(pendingPath());
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077)) throw new Error('Unsafe pending file');
  const pending = await Bun.file(pendingPath()).json();
  if (Date.now()-pending.createdAt > 600000) throw new Error('Pending SMS is too old; request a fresh code explicitly');
  const result = await http('/user/pin',{phone:pending.phone,token:pending.token,pin:code,client:'app',locale:'en'},undefined,fetch,pending.phone);
  await importSession({accessToken:result.token,refreshToken:result.refreshToken});
  await unlink(pendingPath());
  return {stored:true};
  });
}
