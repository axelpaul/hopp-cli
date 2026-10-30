import { createHash } from 'node:crypto';
import { importSession, loadSession, withSessionLock, type Session } from './session.ts';

const ORIGIN = 'https://api.hopp.bike';
export type Send = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(public status: number, public revoked = false) {
    super(revoked ? 'Session revoked by Hopp; use a fresh SMS login. No automatic SMS sent.' : `Hopp request failed (HTTP ${status}).`);
  }
}
export function expiryHint(token: string): number | null {
  try { const v = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); return typeof v.exp === 'number' ? v.exp : null; } catch { return null; }
}
export function requestId(phone: string, timestamp = String(Date.now())): string {
  const digest = createHash('sha256').update('9.10.0' + timestamp + phone + '401').digest('hex');
  return Buffer.from(digest + ':' + timestamp).toString('base64');
}
export async function http(path: string, body: unknown, token?: string, send: Send = fetch, phone?: string): Promise<any> {
  if (!['/api','/user/token','/user/request-pin-app','/user/pin'].includes(path)) throw new Error('Unsupported endpoint');
  const headers: Record<string,string> = {'accept':'application/json','content-type':'application/json','x-user-agent':'HoppApp/9.10.0 (android/35) App/9.10.0 Build/401'};
  if (token) headers.authorization = 'Bearer ' + token;
  if (phone) { headers['hopp-request-id'] = requestId(phone); headers['accept-language'] = 'en'; }
  let response: Response;
  try { response = await send(ORIGIN + path, {method:'POST', headers, body:JSON.stringify(body),redirect:'error', signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error('Transport failed; request outcome may be unknown. Check state before repeating a write.'); }
  const reader = response.body?.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  if (reader) for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) {await reader.cancel(); throw new Error('Response exceeds size limit');} chunks.push(value); }
  let payload: any;
  try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error(`Invalid Hopp response (HTTP ${response.status}); no raw response disclosed`); }
  if (!response.ok) throw new ApiError(response.status, /another device|logged out/i.test(String(payload.message ?? '')));
  return payload;
}
export async function refresh(send: Send = fetch): Promise<Session> {
  const original = await loadSession();
  if (!original?.refreshToken) throw new Error('No saved refresh token; SMS login required');
  return withSessionLock(async () => {
    const latest = await loadSession();
    if (!latest) throw new Error('Session changed or was removed; no refresh sent');
    if (latest.accessToken !== original.accessToken || latest.refreshToken !== original.refreshToken) return latest;
    const result = await http('/user/token', {refreshToken: original.refreshToken}, undefined, send);
    if (typeof result.token !== 'string' || !result.token) throw new Error('Refresh did not return an access token');
    const next = {accessToken:result.token, refreshToken:result.refreshToken ?? original.refreshToken};
    await importSession(next);
    return next;
  });
}
export async function graphql(query: string, operationName: string, variables: Record<string,unknown>, write: boolean, send: Send = fetch): Promise<any> {
  let session = await loadSession();
  if (!session) throw new Error('No saved session; use login');
  const exp = expiryHint(session.accessToken);
  if (exp !== null && exp < Date.now()/1000 + 60 && session.refreshToken && !process.env.HOPP_ACCESS_TOKEN) session = await refresh(send);
  let payload;
  try { payload = await http('/api', {query, operationName, variables}, session.accessToken, send); }
  catch (error) {
    // Reads only may be replayed after one refresh. Never replay a mutation.
    if (error instanceof ApiError && error.status === 401 && !error.revoked && !write && session.refreshToken && !process.env.HOPP_ACCESS_TOKEN) {
      session = await refresh(send);
      payload = await http('/api', {query,operationName,variables}, session.accessToken, send);
    } else throw error;
  }
  if (payload.errors?.length) throw new Error('GraphQL operation rejected; no server error payload disclosed. Check state before repeating writes.');
  if (payload.data === undefined) throw new Error('Missing GraphQL result');
  return payload.data;
}
