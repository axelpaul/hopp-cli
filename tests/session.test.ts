import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDir, importSession, loadSession, logout, sessionStatus, validateSession } from '../src/session.ts';
let root: string;
let previous: Record<string, string | undefined>;
const keys = ['HOPP_CONFIG_DIR', 'HOPP_ACCESS_TOKEN', 'XDG_CONFIG_HOME'];
beforeEach(async () => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  root = await mkdtemp(join(tmpdir(), 'hopp-synthetic-test-'));
  process.env.HOPP_CONFIG_DIR = join(root, 'config');
});
afterEach(async () => {
  for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  await rm(root, { recursive: true, force: true });
});
test('missing session is not authentication evidence', async () => {
  expect(await loadSession()).toBeNull();
  expect(await sessionStatus()).toEqual({ sessionStored: false, source: 'none' });
  expect(await logout()).toEqual({ removed: false });
});
test('allowlisted fields roundtrip privately and logout removes local file', async () => {
  const fixture = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', userId: 'synthetic-user', projectId: 'synthetic-project' };
  expect(await importSession({ ...fixture, extra: 'discard-me' })).toEqual({ stored: true });
  expect(await loadSession()).toEqual(fixture);
  expect((await lstat(configDir())).mode & 0o777).toBe(0o700);
  expect((await lstat(join(configDir(), 'auth.json'))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(configDir(), 'auth.json'), 'utf8')).not.toContain('discard-me');
  expect(await sessionStatus()).toEqual({ sessionStored: true, source: 'file' });
  expect(await logout()).toEqual({ removed: true });
  expect(await loadSession()).toBeNull();
});
test('rejects invalid fields without disclosing supplied secrets', () => {
  for (const fixture of [null, [], {}, { accessToken: '' }, { accessToken: 'synthetic\nsecret' }, { accessToken: 'synthetic-access', userId: 2 }, { accessToken: 'synthetic-access', projectId: ' ' }]) expect(() => validateSession(fixture)).toThrow();
  try { validateSession({ accessToken: 'synthetic\nsecret' }); } catch (error) { expect(String(error)).not.toContain('synthetic'); }
});
test('environment override is validated; logout never unsets environment', async () => {
  process.env.HOPP_ACCESS_TOKEN = 'synthetic-environment';
  expect(await loadSession()).toEqual({ accessToken: 'synthetic-environment' });
  expect(await sessionStatus()).toEqual({ sessionStored: true, source: 'environment' });
  await logout(); expect(await loadSession()).not.toBeNull();
  process.env.HOPP_ACCESS_TOKEN = '\n'; await expect(loadSession()).rejects.toThrow();
});
test('rejects permissive stored files', async () => {
  await importSession({ accessToken: 'synthetic-access' });
  await chmod(join(configDir(), 'auth.json'), 0o644);
  await expect(loadSession()).rejects.toThrow('Saved session unavailable');
});
test('rejects directory symlinks including parent components', async () => {
  const actual = join(root, 'actual'); await mkdir(actual, { mode: 0o700 });
  await symlink(actual, configDir());
  await expect(importSession({ accessToken: 'synthetic-access' })).rejects.toThrow('Unsafe config directory');
  process.env.HOPP_CONFIG_DIR = join(configDir(), 'nested');
  await expect(importSession({ accessToken: 'synthetic-access' })).rejects.toThrow('Unsafe config directory');
});
test('rejects session symlinks without touching target', async () => {
  await mkdir(configDir(), { mode: 0o700 });
  const target = join(root, 'synthetic-target'); await writeFile(target, 'synthetic-original', { mode: 0o600 });
  await symlink(target, join(configDir(), 'auth.json'));
  await expect(loadSession()).rejects.toThrow();
  await expect(importSession({ accessToken: 'synthetic-access' })).rejects.toThrow();
  expect(await readFile(target, 'utf8')).toBe('synthetic-original');
});
test('honors XDG configuration default', () => {
  delete process.env.HOPP_CONFIG_DIR; process.env.XDG_CONFIG_HOME = join(root, 'xdg');
  expect(configDir()).toBe(join(root, 'xdg', 'hopp-cli'));
});
