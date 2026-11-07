// Exercise real Electron downloads against a local fixture server.
// The synthetic payload is hashed and staged but never executed.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createManagedAppImageUpdater, managedPaths, findManagedUpdate } = require('../desktop/managed-updates.cjs');
const { createUpdateController } = require('../desktop/updates.cjs');
const directory = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'companion-update-qa-'));
process.env.XDG_CACHE_HOME = path.join(directory, 'cache');
app.setPath('userData', path.join(directory, 'electron-profile'));
app.whenReady().then(async () => {
  let server;
  try {
    await fs.mkdir(directory, {recursive:true});
    const payload = Buffer.from('Synthetic test AppImage payload. Never executed.');
    const sha512 = createHash('sha512').update(payload).digest('base64');
    const version = '99.0.0';
    let corrupt = false, fileRequests = 0;
    server = http.createServer((request,response) => {
      if(request.url.split('?')[0] === '/latest-linux.yml') {
        response.end(`version: ${version}\nfiles:\n  - url: companion.AppImage\n    sha512: ${sha512}\n    size: ${payload.length}\npath: companion.AppImage\nsha512: ${sha512}\nreleaseDate: '2026-11-07T00:00:00.000Z'\n`);
      } else if(request.url.split('?')[0] === '/companion.AppImage') {
        fileRequests++;response.end(corrupt ? Buffer.from('Corrupt payload') : payload);
      } else { response.writeHead(404);response.end(); }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const userData = path.join(directory, 'companion-profile'), launches=[];
    const fakeApp = {getPath:()=>userData,relaunch:options=>launches.push(options),quit:()=>launches.push('quit')};
    async function setup(cacheName) {
      const updater = createManagedAppImageUpdater(fakeApp);
      const config = path.join(directory, cacheName+'.yml');
      await fs.writeFile(config,`provider: generic\nurl: http://127.0.0.1:${server.address().port}/\nupdaterCacheDirName: ${cacheName}\n`);
      updater.updateConfigPath = config;updater.forceDevUpdateConfig = true;updater.logger = null;
      const controller = createUpdateController({updater,version:app.getVersion(),supported:true,installation:'managed-appimage',openRelease:()=>assert.fail('No browser should open')});
      updater.setFeedURL({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`});
      return {updater,controller};
    }
    const {controller} = await setup('valid-download');
    assert.equal((await controller.check()).phase,'available');
    assert.equal(fileRequests,0);
    assert.equal((await controller.download()).phase,'downloaded');
    assert.equal(fileRequests,1);assert.deepEqual(launches,[]);
    assert.equal((await controller.install()).phase,'installing');
    assert.equal(await fs.readFile(managedPaths(userData).executable,'utf8'),payload.toString());
    assert.equal(findManagedUpdate(userData,'1.0.1'),managedPaths(userData).executable);
    assert.deepEqual(launches,[{execPath:managedPaths(userData).executable,args:['--appimage-extract-and-run']},'quit']);
    corrupt=true;
    const bad=await setup('corrupt-download');
    await bad.controller.check();
    assert.equal((await bad.controller.download()).phase,'error');
    await bad.controller.install();assert.equal(launches.length,2);
    console.log('PASS: real Electron HTTP download, SHA-512 verification, cached update, managed staging, original-launcher detection, and restart request; corrupted download blocked. Test payload was never executed.');
    server.close();await fs.rm(directory,{recursive:true,force:true});app.exit(0);
  }catch(error){console.error(error);server?.close();await fs.rm(directory,{recursive:true,force:true});app.exit(1);}
});
