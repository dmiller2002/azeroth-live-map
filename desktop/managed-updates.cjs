const path = require('node:path');
const fs = require('node:fs');
const { mkdir, copyFile, chmod, rename, writeFile, rm } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const semver = require('semver');

function managedPaths(userData) {
  const directory = path.join(userData, 'companion-updates');
  return { directory, executable: path.join(directory, 'companion.AppImage'), metadata: path.join(directory, 'installed.json') };
}

function findManagedUpdate(userData, currentVersion) {
  const paths = managedPaths(userData);
  try {
    const info = JSON.parse(fs.readFileSync(paths.metadata, 'utf8'));
    fs.accessSync(paths.executable, fs.constants.X_OK);
    return semver.valid(info.version) && semver.gt(info.version, currentVersion) && fs.statSync(paths.executable).isFile() ? paths.executable : null;
  } catch { return null; }
}

async function stageManagedUpdate({ userData, source, version, sha512 }) {
  if (!semver.valid(version) || typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64) throw new Error('Invalid update metadata');
  const paths = managedPaths(userData), pending = paths.executable + '.pending';
  await mkdir(paths.directory, { recursive: true });
  try {
    await copyFile(source, pending);
    const hash = createHash('sha512');
    for await (const chunk of fs.createReadStream(pending)) hash.update(chunk);
    if (hash.digest('base64') !== sha512) throw new Error('Update verification failed');
    await chmod(pending, 0o755);
    await rename(pending, paths.executable);
    await writeFile(paths.metadata + '.pending', JSON.stringify({ version }) + '\n');
    await rename(paths.metadata + '.pending', paths.metadata);
    return paths.executable;
  } finally { await rm(pending, { force: true }); await rm(paths.metadata + '.pending', { force: true }); }
}

function createManagedAppImageUpdater(app, library = require('electron-updater')) {
  // Reuse electron-updater's provider, streamed download, cache, progress, and
  // SHA-512 verification. Only the install destination differs for tar builds.
  return new class extends library.BaseUpdater {
    async doDownloadUpdate(downloadUpdateOptions) {
      const { provider, info } = downloadUpdateOptions.updateInfoAndProvider;
      const fileInfo = provider.resolveFiles(info).find(file => file.url.pathname.toLowerCase().endsWith('.appimage'));
      if (!fileInfo) throw new Error('This release is missing the Linux AppImage');
      return this.executeDownload({ fileExtension: 'AppImage', fileInfo, downloadUpdateOptions,
        task: async (file, options) => { await this.httpExecutor.download(fileInfo.url, file, options); await chmod(file, 0o755); },
      });
    }
    async quitAndInstall() {
      const helper = this.downloadedUpdateHelper;
      if (!helper?.file || !helper.downloadedFileInfo) throw new Error('No verified update is ready');
      const executable = await stageManagedUpdate({ userData: app.getPath('userData'), source: helper.file,
        version: this.updateInfoAndProvider.info.version, sha512: helper.downloadedFileInfo.sha512 });
      app.relaunch({ execPath: executable, args: ['--appimage-extract-and-run'] });
      app.quit();
    }
  }();
}

module.exports = { managedPaths, findManagedUpdate, stageManagedUpdate, createManagedAppImageUpdater };
