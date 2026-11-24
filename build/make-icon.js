const { app, BrowserWindow } = require('electron'); const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 256, height: 256, useContentSize: true, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(path.join(__dirname, '../src/renderer/logo.svg'), 'utf8');
  await w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;overflow:hidden">${svg}</body>`));
  await new Promise((r) => setTimeout(r, 800));
  const img = await w.webContents.capturePage(); console.log(img.getSize());
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 256, height: 256 }).toPNG()); app.quit();
});
