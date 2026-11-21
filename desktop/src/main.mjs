import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launcherAppearance } from './appearance.mjs';
import { createLocalSetup, localSetupError } from './local-setup.mjs';
import { checkWorkspace, lastWorkspace, linkTarget, ownerDestination, rememberWorkspace, webDestination, WorkspaceError, workspaceOrigin, workspacePartition } from './workspace.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const launcherURL = pathToFileURL(join(desktop, 'renderer/index.html')).href;
const preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true, navigateOnDragDrop: false };
app.setName('Your Space');
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'org.your-space.desktop'));
}
const local = createLocalSetup({
  folder: join(app.getPath('userData'), 'local'),
  cli: app.isPackaged ? { program: join(process.resourcesPath, 'bin/your-space'), args: [] } :
    { program: '/usr/bin/env', args: ['node', resolve(desktop, '../cli/dist/your-space.cjs')] },
  releaseDir: app.isPackaged ? join(process.resourcesPath, 'release') :
    resolve(process.env.YS_DESKTOP_RELEASE_DIR || join(desktop, 'dist/release')),
});
const savedFile = join(app.getPath('userData'), 'connection.json');
const appearance = launcherAppearance(join(app.getPath('userData'), 'launcher-theme.json'));
let launcher;
let busy = false;

function secureSession(partition, origin) {
  const browser = session.fromPartition(partition);
  // Only the workspace's main frame may copy text. Reads and child-frame clipboard access stay denied.
  const canCopy = (contents, permission, address, main) =>
    !!origin && main === true && permission === 'clipboard-sanitized-write' &&
    webDestination(address) && new URL(address).origin === origin &&
    contents && webDestination(contents.getURL()) && new URL(contents.getURL()).origin === origin;
  browser.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(Boolean(canCopy(contents, permission, details.requestingUrl, details.isMainFrame))));
  browser.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    Boolean(canCopy(contents, permission, requestingOrigin, details.isMainFrame)));
  browser.setDevicePermissionHandler(() => false);
  return browser;
}

function showLauncher(page = launcherURL) {
  if (typeof page !== 'string') page = launcherURL;
  if (launcher && !launcher.isDestroyed()) {
    if (launcher.webContents.getURL() !== page) void launcher.loadURL(page).catch(() => {});
    launcher.show();
    launcher.focus();
    return;
  }
  launcher = new BrowserWindow({
    width: 890, height: 720, minWidth: 580, minHeight: 580, title: 'Your Space',
    webPreferences: { ...preferences, session: secureSession('launcher'), preload: join(desktop, 'src/preload.cjs') },
  });
  launcher.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  launcher.webContents.on('will-frame-navigate', event => event.preventDefault());
  launcher.webContents.on('will-redirect', event => event.preventDefault());
  launcher.on('closed', () => { launcher = undefined; });
  void launcher.loadURL(page).catch(() => {});
}

function workspaceWindow(browser, origin, workspace = origin, enableLinks = true) {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 560, minHeight: 440, show: false,
    webPreferences: { ...preferences, session: browser, safeDialogs: true },
  });
  const contents = win.webContents;
  const allowNavigation = event => {
    if (!webDestination(event.url) || (event.isMainFrame && ![origin, workspace].includes(new URL(event.url).origin))) event.preventDefault();
  };
  contents.on('will-frame-navigate', allowNavigation);
  contents.on('will-redirect', allowNavigation);
  let confirmingLink = false;
  contents.setWindowOpenHandler(({url}) => {
    if (!enableLinks) return {action: 'deny'};
    const target = linkTarget(url, workspace);
    if (target === 'workspace') {
      const child = workspaceWindow(browser, new URL(url).origin, workspace, false);
      child.loadURL(url).then(() => child.show(), () => child.destroy());
    } else if (target === 'browser' && !confirmingLink) {
      // External app and provider origins open in the system browser after owner confirmation.
      confirmingLink = true;
      void dialog.showMessageBox(win, {
        type: 'question', message: 'Open this link in your browser?',
        detail: new URL(url).origin, buttons: ['Cancel', 'Open in Browser'],
        defaultId: 0, cancelId: 0,
      }).then(({response}) => response === 1 && shell.openExternal(url))
        .catch(() => {}).finally(() => { confirmingLink = false; });
    }
    return {action: 'deny'};
  });
  return win;
}

async function openWorkspace(value, {ownerLink, localInstall = false} = {}) {
  const origin = workspaceOrigin(value);
  const url = ownerLink ? ownerDestination(origin, ownerLink) : origin;
  const browser = secureSession(workspacePartition(origin), origin);
  await checkWorkspace(origin, browser.fetch.bind(browser));
  const win = workspaceWindow(browser, origin);
  try {
    await win.loadURL(url);
    if (new URL(win.webContents.getURL()).origin !== origin) throw new Error();
    await rememberWorkspace(savedFile, origin, localInstall);
  } catch {
    win.destroy();
    throw new WorkspaceError('open_failed', 'Could not open this workspace. Check the connection and try again.');
  }
  win.show();
  launcher?.hide();
  return {state: 'ready', origin};
}

async function startLocal(input) {
  const result = await local.start({engine: input?.engine, expectedSocket: input?.expectedSocket});
  if (result.state === 'ready') return openWorkspace(result.origin, {localInstall: true});
  const origin = workspaceOrigin(result.origin);
  const browser = secureSession(workspacePartition(origin), origin);
  if (await checkWorkspace(origin, browser.fetch.bind(browser))) return openWorkspace(origin, {localInstall: true});
  return {state: 'owner-needed', origin};
}

async function reopen() {
  if (busy) return;
  busy = true;
  let openingLocal = false;
  try {
    const last = await lastWorkspace(savedFile);
    if (!last) return showLauncher();
    if (!last.local) return await openWorkspace(last.origin);
    // Local Docker startup can take minutes. Show progress while reconnecting on launch.
    openingLocal = true;
    showLauncher(pathToFileURL(join(desktop, 'renderer/opening.html')).href);
    launcher.setProgressBar(2);
    const {saved} = await local.engines();
    if (saved) {
      const result = await startLocal({engine: saved.name, expectedSocket: saved.socket});
      if (result.state === 'ready') return;
    }
  } catch { /* The launcher lets the owner retry local setup or enter an address. */ }
  finally {
    busy = false;
    if (openingLocal && launcher && !launcher.isDestroyed()) {
      launcher.setProgressBar(-1);
      await launcher.loadURL(launcherURL).catch(() => {});
    }
  }
  showLauncher();
}

function installHandlers() {
  const actions = {
    appearance: appearance.get,
    previewTheme: appearance.preview,
    saveTheme: appearance.save,
    engines: () => local.engines(),
    start: startLocal,
    createOwner: async input => {
      const result = await local.createOwner({name: input?.name, username: input?.username});
      return openWorkspace(result.origin, {ownerLink: result.url === result.origin ? undefined : result.url, localInstall: true});
    },
    connect: input => openWorkspace(input?.url),
    openDockerGuide: () => shell.openExternal('https://docs.docker.com/desktop/setup/install/mac-install/'),
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle('launcher:' + name, async (event, input) => {
      const frame = event.senderFrame;
      if (!launcher || launcher.isDestroyed() || !frame || event.sender !== launcher.webContents ||
          frame !== launcher.webContents.mainFrame || frame.url !== launcherURL) {
        return {error: {code: 'forbidden', message: 'Open the desktop launcher to continue.'}};
      }
      const exclusive = ['start', 'createOwner', 'connect'].includes(name);
      if (exclusive && busy) return {error: {code: 'busy', message: 'Wait for the current setup to finish.'}};
      if (exclusive) busy = true;
      try { return await action(input); }
      catch (error) {
        const safe = error instanceof WorkspaceError ? error : localSetupError(error?.code);
        return {error: {code: safe.code, message: safe.message}};
      } finally { if (exclusive) busy = false; }
    });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) showLauncher(); });
  app.on('activate', () => {
    if (app.isReady() && !BrowserWindow.getAllWindows().some(win => win.isVisible()) && !busy) showLauncher();
  });
  app.whenReady().then(() => {
    installHandlers();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {role: 'appMenu'},
      {label: 'Workspace', submenu: [
        {label: 'Choose a workspace…', accelerator: 'CmdOrCtrl+Shift+O', click: showLauncher},
        {label: 'Reopen last workspace', click: () => void reopen()},
        {type: 'separator'}, {role: 'close'},
      ]},
      {role: 'editMenu'}, {role: 'windowMenu'},
    ]));
    void reopen();
  });
}
