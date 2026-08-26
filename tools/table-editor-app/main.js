const { app, BrowserWindow } = require('electron');
const path = require('path');

// Dev-Modus: laedt die ECHTE Editor-Quelle direkt (tools/table-editor/
// index.html) -- also genau die Datei, die auch im Browser genutzt wird und
// in der Claude Code normalerweise Aenderungen speichert. Kein Kopier-/
// Sync-Schritt noetig, deren relative Bildpfade (../../images/...) loesen
// beim direkten Laden ganz normal gegen das echte Repo-images/-Verzeichnis
// auf. Gepackter Build (.exe) laedt weiterhin die eigene, mitgepackte Kopie
// (app/index.html mit angepassten Pfaden) -- siehe package.json "files".
const DEV_INDEX = path.join(__dirname, '..', 'table-editor', 'index.html');
const PACKAGED_INDEX = path.join(__dirname, 'app', 'index.html');

// Live-Reload NUR im Dev-Modus (app.isPackaged ist in der fertigen .exe
// immer true) -- der gepackte Build bekommt dadurch garantiert KEINEN
// File-Watcher, bleibt also unveraendert stabil/schlank. Beobachtet sowohl
// den eigentlichen Editor-Ordner (tools/table-editor/, siehe DEV_INDEX
// oben) als auch main.js selbst (tools/table-editor-app/) -- Aenderungen an
// main.js erfordern electron-reload zufolge zwar einen manuellen Neustart
// von "npm run dev" fuer volle Main-Process-Aenderungen, aber die Watch-
// Liste deckt trotzdem beide im Auftrag genannten Ordner ab.
if (!app.isPackaged) {
  require('electron-reload')(
    [path.join(__dirname, '..', 'table-editor'), __filename],
    {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit',
    }
  );
}

// Auto-Update NUR im gepackten Build (im Dev-Modus gibt es weder eine
// installierte Version noch die von electron-builder generierte
// app-update.yml, aus der electron-updater den Update-Feed liest -- siehe
// "publish" in package.json, das electron-updater automatisch einbettet,
// kein manuelles setFeedURL() noetig). Feed ist ein einfacher Ordner im
// Repo selbst (tools/table-editor-app/releases/, ueber
// raw.githubusercontent.com), dorthin wird nach jedem Patch der frisch
// gebaute NSIS-Installer + latest.yml committet/gepusht -- kein GitHub-
// Token/Release-Publish-Schritt noetig. Laeuft komplett im Hintergrund:
// laedt ein gefundenes Update automatisch herunter (autoDownload, Default)
// und installiert es beim naechsten Beenden der App (autoInstallOnAppQuit)
// -- kein erzwungener Neustart waehrend der laufenden Nutzung.
if (app.isPackaged) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.error('[auto-updater]', err));
  autoUpdater.checkForUpdatesAndNotify();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'TABLE_LAYOUT Editor',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(app.isPackaged ? PACKAGED_INDEX : DEV_INDEX);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
