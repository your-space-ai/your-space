import { app, BrowserWindow, dialog, ipcMain, Menu, autoUpdater as nativeUpdater, powerMonitor, session, shell } from 'electron';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launcherTheme } from './appearance.mjs';
import { createLocalSetup, localSetupError } from './local-setup.mjs';
import { createQuitControl, stopTimeouts } from './quit.mjs';
import { createUpdates } from './updates.mjs';
import { checkFailedDetail, chooseChannel, updateMenu, upToDateMessage } from './update-menu.mjs';
import { checkWorkspace, createSavedConnections, linkTarget, mostRecent, ownerDestination, savedName, webDestination, WorkspaceError, workspaceOrigin, workspacePartition } from './workspace.mjs';
import { connectionMenu } from './connection-menu.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const launcherURL = pathToFileURL(join(desktop, 'renderer/index.html')).href;
const openingURL = pathToFileURL(join(desktop, 'renderer/opening.html')).href;
const stoppingURL = pathToFileURL(join(desktop, 'renderer/stopping.html')).href;
const preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true, navigateOnDragDrop: false };
app.setName('Your Space');
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'ai.your-space.desktop'));
}
const local = createLocalSetup({
  folder: join(app.getPath('userData'), 'local'),
  cli: app.isPackaged ? { program: join(process.resourcesPath, 'bin/your-space'), args: [] } :
    { program: '/usr/bin/env', args: ['node', resolve(desktop, '../cli/dist/your-space.cjs')] },
  releaseDir: app.isPackaged ? join(process.resourcesPath, 'release') :
    resolve(process.env.YS_DESKTOP_RELEASE_DIR || join(desktop, 'dist/release')),
  version: app.getVersion(),
  versionFile: join(app.getPath('userData'), 'local-version.json'),
});
// One window per workspace address, each in that address's own session. Closing one hides it, so the
// Connections menu and the Dock icon show it again as it was.
const windows = new Map();
// Saved connections: a name and an address each. connection.json held the one address earlier versions kept.
const savedConnections = createSavedConnections({
  file: join(app.getPath('userData'), 'connections.json'),
  legacyFile: join(app.getPath('userData'), 'connection.json'),
  onChange: list => {
    // A hidden window whose connection was removed from the list can't be shown again.
    for (const [origin, win] of windows) {
      if (!list.some(entry => entry.origin === origin) && !win.isDestroyed() && !win.isVisible()) win.destroy();
    }
    buildMenu();
  },
});
let launcher;
// The workspace window used last, which the Dock icon shows when no window is visible.
let primary;
// What the launcher shows the next time it asks: the list, the address form, or a saved connection to open.
let launcherRequest;
let busy = false;

// A sheet on a visible window when there is one: on macOS a message box without a parent window
// runs synchronously and can't be closed by its signal.
function message(options, parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find(win => win.isVisible())) {
  const settings = { type: 'info', buttons: ['OK'], ...options };
  return parent ? dialog.showMessageBox(parent, settings) : dialog.showMessageBox(settings);
}

// Quitting stops the local workspace this app started; closing a window doesn't (quit.mjs).
const quitControl = createQuitControl({
  needsStop: () => local.mayBeRunning(),
  stop: signal => local.stop({ timeout: stopTimeouts.quit, signal }),
  // A downloaded update the owner put off, of the channel followed now, installs once the app has quit.
  pendingUpdate: () => updates.installsAtQuit,
  stageUpdate: signal => updates.stageAtQuit(signal),
  onStopping: () => {
    busy = true;
    for (const win of BrowserWindow.getAllWindows()) if (win !== launcher) win.hide();
    showLauncher(stoppingURL);
    launcher.setProgressBar(2);
  },
  onFailed: async (error, timedOut, signal) => {
    // On the stopping window, shown again if the owner closed it, so logout can close the sheet.
    showLauncher(stoppingURL);
    await message({
      signal,
      type: 'warning', message: 'Your Space could not stop the local workspace',
      detail: (timedOut ? `It was still stopping after ${stopTimeouts.quit / 60_000} minutes. ` : '') +
        'Your Space quits anyway, and the workspace and its apps may still be running in Docker. ' +
        'To stop them, open Your Space and quit it again.',
      buttons: ['Quit'],
    }, launcher);
  },
  quit: () => app.quit(),
});

const updates = createUpdates({
  // Only the packaged app carries the updater and the app-update.yml it reads (package-macos.sh).
  load: () => app.isPackaged ? createRequire(import.meta.url)(join(desktop, 'vendor/electron-updater.cjs')).autoUpdater : null,
  settingsFile: join(app.getPath('userData'), 'updates.json'),
  version: app.getVersion(),
  beforeInstall: install => quitControl.beforeInstall(install),
  squirrel: nativeUpdater,
  ui: {
    unavailable: () => message({ message: 'Updates work only in the installed app',
      detail: 'This copy of Your Space runs from its source, so it doesn’t check for new versions.' }),
    upToDate: channel => message(upToDateMessage(app.getVersion(), channel)),
    busy: () => message({ message: 'Your Space is already checking for updates' }),
    failed: (error, stage, channel) => message({
      type: 'warning',
      message: {check: 'Your Space could not check for updates', download: 'Your Space could not download the update',
        install: 'Your Space could not install the update'}[stage],
      detail: ({install: 'macOS didn’t accept the downloaded version. Download Your Space again from its GitHub releases.',
        check: checkFailedDetail(channel)}[stage] ??
        'Check your internet connection, then try again from Your Space › Check for Updates…') +
        (typeof error?.code === 'string' && /^ERR_[A-Z_]+$/.test(error.code) ? ` (${error.code})` : ''),
    }),
    available: async info => (await message({
      message: `Your Space ${info.version} is available`,
      detail: `You have version ${app.getVersion()}. Download it now? Your Space installs it when you restart or quit.`,
      buttons: ['Download', 'Not Now'], defaultId: 0, cancelId: 1,
    })).response === 0,
    downloaded: async info => (await message({
      message: `Your Space ${info.version} is ready to install`,
      detail: local.mayBeRunning() ?
        'Restarting stops your local workspace, updates Your Space, then opens the workspace you used last. If that is This Mac, it starts again on the new version.' :
        'Restart Your Space to finish updating, or it updates when you quit.',
      buttons: ['Restart Now', 'Later'], defaultId: 0, cancelId: 1,
    })).response === 0,
    progress: fraction => {
      const win = launcher && !launcher.isDestroyed() ? launcher : BrowserWindow.getAllWindows()[0];
      win?.setProgressBar(fraction);
    },
  },
});

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

function showLauncher(page = launcherURL, request) {
  // While the app stops its local workspace to quit, the launcher shows only that.
  if (quitControl.stopping && page !== stoppingURL) return;
  if (request) launcherRequest = request;
  if (launcher && !launcher.isDestroyed()) {
    // A loaded launcher asks for its list again, and for any request; a reloaded one asks as it loads.
    if (launcher.webContents.getURL() !== page) void launcher.loadURL(page).catch(() => {});
    else if (page === launcherURL) launcher.webContents.send('launcher:refresh');
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

// The address of a workspace's own window, if `win` is one.
function workspaceOf(win) {
  return [...windows].find(([, open]) => open === win)?.[0];
}

// Shows the window already open for an address, if there is one.
function focusWorkspace(origin) {
  const win = windows.get(origin);
  if (!win || win.isDestroyed()) return false;
  win.show();
  win.focus();
  primary = win;
  return true;
}

// The Connections menu's choice of a saved connection: its open window, or the launcher opening it,
// which shows its progress and any problem.
function switchConnection(origin) {
  if (quitControl.stopping) return;
  if (focusWorkspace(origin)) {
    void savedConnections.opened(origin).catch(() => {});
    return;
  }
  showLauncher(launcherURL, {open: origin});
}

// Opening an address that is saved updates its entry; any other address is added to the list.
async function openWorkspace(value, {ownerLink, localInstall = false, name} = {}) {
  const origin = workspaceOrigin(value);
  savedName(name, origin, localInstall);
  if (!ownerLink && focusWorkspace(origin)) {
    await savedConnections.opened(origin, {name, local: localInstall});
    launcher?.hide();
    return {state: 'ready', origin};
  }
  const url = ownerLink ? ownerDestination(origin, ownerLink) : origin;
  const browser = secureSession(workspacePartition(origin), origin);
  await checkWorkspace(origin, browser.fetch.bind(browser));
  const win = workspaceWindow(browser, origin);
  try {
    await win.loadURL(url);
    if (new URL(win.webContents.getURL()).origin !== origin) throw new Error();
    await savedConnections.opened(origin, {name, local: localInstall});
  } catch {
    win.destroy();
    throw new WorkspaceError('open_failed', 'Could not open this workspace. Check the connection and try again.');
  }
  if (quitControl.stopping) {
    win.destroy();
    throw new WorkspaceError('open_failed', 'Your Space is quitting.');
  }
  // Only the owner link opens an address again while its window is open; it replaces that window.
  const previous = windows.get(origin);
  windows.set(origin, win);
  if (previous && !previous.isDestroyed()) previous.destroy();
  primary = win;
  win.on('close', event => {
    // A connection that is no longer saved can't be shown again, so its window closes for good.
    if (quitControl.quitting || windows.get(origin) !== win || !savedConnections.current().some(entry => entry.origin === origin)) return;
    // Closing the window keeps the app, and any local workspace, running, as on any Mac.
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    if (windows.get(origin) === win) windows.delete(origin);
    if (primary === win) primary = undefined;
    buildMenu();
  });
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

// A saved connection chosen in the launcher. This Mac starts the local workspace with its saved engine,
// as on launch; a server is opened at its address.
async function openSaved(value) {
  const origin = workspaceOrigin(value);
  const entry = (await savedConnections.list()).find(item => item.origin === origin);
  if (!entry) throw new WorkspaceError('not_saved', 'This connection is no longer in your list.');
  if (!entry.local || windows.has(origin)) return openWorkspace(origin);
  const {saved: engine} = await local.engines();
  if (!engine) throw localSetupError('engine_missing');
  return startLocal({engine: engine.name, expectedSocket: engine.socket});
}


// Renaming or removing changes only the list file, so a failure says that, not what local setup says.
async function changeSaved(change) {
  try { await change(); } catch (error) {
    throw error instanceof WorkspaceError ? error : new WorkspaceError('save_failed', 'Your Space could not save your connections. Try again.');
  }
  return {connections: await savedState()};
}

async function savedState() {
  const running = local.mayBeRunning();
  return (await savedConnections.list()).map(entry => ({...entry, running: entry.local && running}));
}

// The list for the launcher, with what it was asked to show, once.
async function launcherState() {
  const request = launcherRequest;
  launcherRequest = undefined;
  let connections;
  try { connections = await savedState(); } catch {
    throw new WorkspaceError('read_failed', 'Your Space could not read your saved connections. Try again.');
  }
  return request ? {connections, request} : {connections};
}

async function reopen() {
  // Nothing starts while the app stops its local workspace to quit or update.
  const quitting = () => quitControl.stopping || quitControl.quitting;
  if (busy || quitting()) return;
  busy = true;
  let openingLocal = false;
  try {
    // The connection used last opens on launch.
    const last = mostRecent(await savedConnections.list());
    if (!last) return showLauncher();
    if (!last.local) return await openWorkspace(last.origin);
    // Local Docker startup can take minutes. Show progress while reconnecting on launch.
    openingLocal = true;
    showLauncher(openingURL);
    launcher.setProgressBar(2);
    const {saved} = await local.engines();
    if (saved && !quitting()) {
      const result = await startLocal({engine: saved.name, expectedSocket: saved.socket});
      if (result.state === 'ready') return;
    }
  } catch { /* The launcher lets the owner retry local setup or enter an address. */ }
  finally {
    busy = false;
    if (openingLocal && launcher && !launcher.isDestroyed() && !quitControl.stopping) {
      launcher.setProgressBar(-1);
      await launcher.loadURL(launcherURL).catch(() => {});
    }
  }
  showLauncher();
}

function installHandlers() {
  const actions = {
    appearance: launcherTheme,
    engines: () => local.engines(),
    start: startLocal,
    createOwner: async input => {
      const result = await local.createOwner({name: input?.name, username: input?.username});
      return openWorkspace(result.origin, {ownerLink: result.url === result.origin ? undefined : result.url, localInstall: true});
    },
    connect: input => openWorkspace(input?.url, {name: input?.name}),
    connections: launcherState,
    open: input => openSaved(input?.origin),
    rename: input => changeSaved(() => savedConnections.rename(input?.origin, input?.name)),
    // Forgets a saved connection: a hidden window for it closes, and one on screen stays until it is
    // closed. This Mac's installation keeps running, and quitting still stops it.
    remove: input => changeSaved(() => savedConnections.remove(input?.origin)),
    openDockerGuide: () => shell.openExternal('https://docs.docker.com/desktop/setup/install/mac-install/'),
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle('launcher:' + name, async (event, input) => {
      const frame = event.senderFrame;
      if (!launcher || launcher.isDestroyed() || !frame || event.sender !== launcher.webContents ||
          frame !== launcher.webContents.mainFrame || frame.url !== launcherURL) {
        return {error: {code: 'forbidden', message: 'Open the desktop launcher to continue.'}};
      }
      const exclusive = ['start', 'createOwner', 'connect', 'open'].includes(name);
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

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: app.name, submenu: [
      {role: 'about'},
      ...updateMenu({
        automatic: updates.automatic, channel: updates.channel, version: app.getVersion(), installing: updates.installing,
        check: () => void updates.check(),
        setAutomatic: automatic => void updates.setAutomatic(automatic).catch(() => {}).finally(buildMenu),
        // A radio item shows the choice before it is made, so the menu is rebuilt from the setting either way.
        choose: channel => void chooseChannel(channel, {
          current: updates.channel, version: app.getVersion(),
          ask: async options => (await message(options)).response,
          setChannel: choice => updates.setChannel(choice),
        }).catch(() => {}).finally(buildMenu),
      }),
      {type: 'separator'}, {role: 'services'},
      {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'},
      {type: 'separator'}, {role: 'quit'},
    ]},
    {label: 'Connections', submenu: connectionMenu({
      saved: savedConnections.current(),
      frontmost: workspaceOf(BrowserWindow.getFocusedWindow()),
      open: switchConnection,
      addServer: () => showLauncher(launcherURL, {view: 'remote'}),
      manage: () => showLauncher(launcherURL, {view: 'list'}),
    })},
    {role: 'editMenu'}, {role: 'windowMenu'},
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady() && !quitControl.stopping) showLauncher(); });
  // The menu's check follows the frontmost workspace, and goes when its window hides. The connection
  // used last is the one whose window came to the front last: the Dock icon shows it, and launch opens it.
  // While the app quits, windows hide or close one by one and bring others to the front; that isn't use.
  app.on('browser-window-focus', (event, win) => {
    const origin = workspaceOf(win);
    if (origin) {
      primary = win;
      if (!quitControl.stopping && !quitControl.quitting) void savedConnections.used(origin).catch(() => {});
    }
    buildMenu();
  });
  app.on('browser-window-blur', () => buildMenu());
  app.on('activate', () => {
    if (!app.isReady() || quitControl.stopping || BrowserWindow.getAllWindows().some(win => win.isVisible())) return;
    if (primary && !primary.isDestroyed()) primary.show();
    else if (!busy) showLauncher();
  });
  // Without this handler Electron quits when the last window closes. On a Mac, the app stays open.
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => quitControl.beforeQuit(event));
  app.whenReady().then(async () => {
    installHandlers();
    // Logout, restart and shutdown stop the local workspace with a short bound and no dialog.
    powerMonitor.on('shutdown', () => quitControl.systemEnding());
    await updates.start().catch(() => {});
    await savedConnections.list().catch(() => {});
    buildMenu();
    void reopen();
  });
}
