// Ventana de escritorio para YOUPOS. No reescribe nada de la app real (todo
// sigue siendo el mismo backend Node + frontend HTML/CSS/JS de siempre) —
// este archivo solo:
//   1. Arranca el backend (en desarrollo, corriendo el código fuente
//      directo con Node; ya empacado, corriendo el mismo MiPOS.exe
//      autocontenido de siempre, como proceso en segundo plano).
//   2. Espera a que el servidor conteste.
//   3. Abre una ventana propia apuntando a ese servidor — sin barra de
//      direcciones, sin menú de navegador, con su propio ícono — para que
//      se sienta como un programa normal y no como "una página abierta en
//      Chrome".
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 3000;
const isPackaged = app.isPackaged;

let backendProcess = null;
let mainWindow = null;
let shuttingDown = false;

// Solo una ventana/instancia a la vez — dos backends peleándose por el
// mismo puerto y la misma base de datos sería un desastre.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function backendCommand() {
  if (!isPackaged) {
    // Desarrollo: corre el código fuente tal cual está en el repo, con el
    // Node de verdad instalado en esta máquina (NO process.execPath, que
    // aquí sería electron.exe — su Node interno no trae node:sqlite) — así
    // cada cambio se ve sin tener que reempacar nada.
    const entry = path.join(__dirname, '..', 'app', 'backend', 'src', 'index.js');
    return { command: 'node', args: [entry], cwd: path.dirname(entry) };
  }
  // Empacado: el mismo .exe autocontenido (Node SEA) que ya se usaba antes
  // de tener esta ventana — no necesita Node instalado en el equipo del
  // cliente. Va como "extraResource" junto a la carpeta "app" que espera
  // encontrar al lado (ver sea-entry.cjs).
  const exePath = path.join(process.resourcesPath, 'backend', 'MiPOS.exe');
  return { command: exePath, args: [], cwd: path.dirname(exePath) };
}

function startBackend() {
  const { command, args, cwd } = backendCommand();
  backendProcess = spawn(command, args, {
    cwd,
    env: { ...process.env, POS_NO_OPEN_BROWSER: '1' },
    windowsHide: true,
  });
  backendProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on('exit', (code) => {
    backendProcess = null;
    if (!shuttingDown) {
      dialog.showErrorBox('YOUPOS', `El servidor se cerró inesperadamente (código ${code}). La aplicación se va a cerrar.`);
      app.quit();
    }
  });
}

function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get(`http://localhost:${PORT}/`, () => resolve());
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('El servidor no respondió a tiempo.'));
          return;
        }
        setTimeout(attempt, 200);
      });
    })();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'YOUPOS',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#14181a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  await mainWindow.loadURL(`http://localhost:${PORT}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    startBackend();
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox('YOUPOS', `No se pudo iniciar el sistema:\n${err.message}`);
    app.quit();
    return;
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  shuttingDown = true;
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

app.on('window-all-closed', () => {
  shutdown();
  app.quit();
});
app.on('before-quit', shutdown);
