const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { managedPaths, findManagedUpdate, stageManagedUpdate, createManagedAppImageUpdater } = require('../desktop/managed-updates.cjs');
const digest = value => createHash('sha512').update(value).digest('base64');

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-managed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'download.AppImage'), userData = path.join(directory, 'profile');
  await writeFile(source, 'verified release');
  return { directory, source, userData };
}

test('a verified Linux release stages atomically and original launchers find the newer copy', async t => {
  const { source, userData } = await fixture(t);
  const executable = await stageManagedUpdate({ source, userData, version: '1.0.2', sha512: digest('verified release') });
  assert.equal(executable, managedPaths(userData).executable);
  assert.equal(await readFile(executable, 'utf8'), 'verified release');
  assert.equal((await stat(executable)).mode & 0o777, 0o755);
  assert.equal(findManagedUpdate(userData, '1.0.1'), executable);
  assert.equal(findManagedUpdate(userData, '1.0.2'), null);
  assert.equal(findManagedUpdate(userData, '1.1.0'), null);
  assert.equal(await readFile(source, 'utf8'), 'verified release', 'The original download is not consumed');
  await assert.rejects(stat(executable + '.pending'), { code: 'ENOENT' });
});

test('corrupt downloads do not replace a working copy or its version pointer', async t => {
  const { source, userData } = await fixture(t);
  const executable = await stageManagedUpdate({ source, userData, version: '1.0.2', sha512: digest('verified release') });
  await writeFile(source, 'truncated release');
  await assert.rejects(stageManagedUpdate({ source, userData, version: '1.0.3', sha512: digest('expected full release') }), /verification failed/);
  assert.equal(await readFile(executable, 'utf8'), 'verified release');
  assert.equal(JSON.parse(await readFile(managedPaths(userData).metadata, 'utf8')).version, '1.0.2');
  await assert.rejects(stat(executable + '.pending'), { code: 'ENOENT' });
  await assert.rejects(stageManagedUpdate({ source, userData, version: '../../other', sha512: digest('truncated release') }), /metadata/);
});

test('missing and damaged managed pointers do not prevent opening the original app', async t => {
  const { source, userData } = await fixture(t);
  assert.equal(findManagedUpdate(userData, '1.0.1'), null);
  await stageManagedUpdate({ source, userData, version: '1.0.2', sha512: digest('verified release') });
  const paths = managedPaths(userData);
  await writeFile(paths.metadata, '{broken'); assert.equal(findManagedUpdate(userData, '1.0.1'), null);
  await writeFile(paths.metadata, JSON.stringify({ version: '1.0.3', executable: '/tmp/other' }));
  assert.equal(findManagedUpdate(userData, '1.0.1'), paths.executable, 'A remote or metadata-supplied executable path is never used');
  await rm(paths.executable); assert.equal(findManagedUpdate(userData, '1.0.1'), null);
});

test('managed updater uses the standard verified download and relaunches without a browser or FUSE', async t => {
  const { source, userData } = await fixture(t);
  const calls = [];
  class BaseUpdater { executeDownload(task) { this.task = task; return 'standard verified download'; } }
  const app = { getPath: name => { assert.equal(name, 'userData'); return userData; }, relaunch: options => calls.push(options), quit: () => calls.push('quit') };
  const updater = createManagedAppImageUpdater(app, { BaseUpdater });
  const file = { url: new URL('https://github.com/example/release.AppImage'), info: { sha512: digest('verified release') } };
  const provider = { resolveFiles: () => [file] };
  assert.equal(await updater.doDownloadUpdate({ updateInfoAndProvider: { provider, info: { version: '1.0.2' } } }), 'standard verified download');
  assert.equal(updater.task.fileInfo, file);
  updater.downloadedUpdateHelper = { file: source, downloadedFileInfo: { sha512: digest('verified release') } };
  updater.updateInfoAndProvider = { info: { version: '1.0.2' } };
  assert.deepEqual(calls, []);
  await updater.quitAndInstall();
  assert.deepEqual(calls, [{ execPath: managedPaths(userData).executable, args: ['--appimage-extract-and-run'] }, 'quit']);
});

test('an asynchronous staging failure leaves the companion open', async t => {
  const { source, userData } = await fixture(t);
  let quit = false;
  const updater = createManagedAppImageUpdater({ getPath: () => userData, relaunch: () => assert.fail('Must not relaunch'), quit: () => { quit = true; } }, { BaseUpdater: class {} });
  updater.downloadedUpdateHelper = { file: source, downloadedFileInfo: { sha512: digest('different payload') } };
  updater.updateInfoAndProvider = { info: { version: '1.0.2' } };
  await assert.rejects(updater.quitAndInstall(), /verification failed/);
  assert.equal(quit, false);
});
