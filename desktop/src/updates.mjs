// The packaged app updates itself from GitHub Releases with electron-updater. Checking is the only
// automatic outbound request, and the owner can turn it off; downloading and installing wait for the
// owner. The updater is loaded only in the packaged app, so a copy run from source never checks.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const checkInterval = 24 * 60 * 60_000;
export const firstCheckDelay = 30_000;
// How long Squirrel.Mac may take to unpack, verify and stage a downloaded update.
export const stagingTimeout = 5 * 60_000;

/** Applies the launcher's policy to electron-updater's updater and returns it. */
export function configureUpdater(updater) {
  updater.autoDownload = false;
  // A downloaded update also installs when the app quits, if the owner chose Later.
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.fullChangelog = false;
  // electron-updater keeps a random ID per installation in userData/.updaterId and sends it to GitHub
  // with every request (x-user-staging-id) for staged rollouts. Your Space sends no identifier: it
  // never reads or creates that file, and the header is removed.
  updater.stagingUserIdPromise = { value: Promise.resolve(null) };
  const finalHeaders = updater.computeFinalHeaders.bind(updater);
  updater.computeFinalHeaders = headers => {
    const result = finalHeaders(headers);
    delete result['x-user-staging-id'];
    return result;
  };
  return updater;
}

export async function readUpdateSettings(file) {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return { automatic: saved?.automatic !== false };
  } catch {
    return { automatic: true };
  }
}

async function saveUpdateSettings(file, settings) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * @param {object} options
 * @param {() => unknown} options.load   electron-updater's autoUpdater, or null when the app runs from source
 * @param {string} options.settingsFile
 * @param {(install: () => void) => Promise<void>} options.beforeInstall   stops the local workspace, then installs
 * @param {object} options.ui   unavailable(), upToDate(), busy(), failed(error, 'check' | 'download' | 'install'),
 *   available(info, manual) → boolean,
 *   downloaded(info) → boolean (restart now), progress(fraction or -1)
 * @param {import('node:events').EventEmitter} [options.squirrel]   Electron's own autoUpdater, which stages the
 *   update after electron-updater hands it over and emits update-downloaded, or error when the signature fails
 */
export function createUpdates({ load, settingsFile, beforeInstall, ui, squirrel, timers = globalThis, delay = firstCheckDelay,
  interval = checkInterval, staging = stagingTimeout }) {
  let settings = { automatic: true };
  // Saves run one after another, so the file ends with the owner's last choice.
  let saving = Promise.resolve();
  let loaded;
  let updater;
  let phase = 'idle'; // idle → checking → (downloading → ready)
  let ready;
  let first;
  let repeat;
  // Versions the owner put off this session; an automatic check doesn't ask about them again.
  const declined = new Set();
  let staged = !squirrel;
  squirrel?.on('update-downloaded', () => { staged = true; });

  // Only offer the restart once Squirrel.Mac has accepted the update, so a rejected one never stops
  // the workspace for an install that can't happen.
  function whenStaged() {
    if (staged) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = () => finish();
      const failed = error => finish(error instanceof Error ? error : new Error(String(error)));
      const finish = error => {
        timers.clearTimeout(timer);
        squirrel.off('update-downloaded', ready);
        squirrel.off('error', failed);
        if (error) reject(error); else resolve();
      };
      const timer = timers.setTimeout(() => failed(new Error('The update was not ready in time.')), staging);
      squirrel.on('update-downloaded', ready);
      squirrel.on('error', failed);
    });
  }

  function get() {
    loaded ??= Promise.resolve().then(load).then(value => {
      if (!value) return null;
      updater = configureUpdater(value);
      updater.on('download-progress', progress => ui.progress(Math.max(0, Math.min(1, progress.percent / 100))));
      return updater;
    }, error => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  }

  function schedule() {
    timers.clearTimeout(first);
    timers.clearInterval(repeat);
    first = repeat = undefined;
    if (!settings.automatic) return;
    const automatic = () => check(false).catch(() => {});
    first = timers.setTimeout(automatic, delay);
    repeat = timers.setInterval(automatic, interval);
  }

  async function offerRestart() {
    if (await ui.downloaded(ready)) await beforeInstall(() => updater.quitAndInstall());
  }

  async function check(manual) {
    if (!manual && !settings.automatic) return;
    if (phase === 'ready') {
      if (manual) await offerRestart();
      return;
    }
    if (phase !== 'idle') {
      if (manual) await ui.busy();
      return;
    }
    phase = 'checking';
    let result;
    try {
      if (!(await get())) {
        phase = 'idle';
        if (manual) await ui.unavailable();
        return;
      }
      result = await updater.checkForUpdates();
    } catch (error) {
      phase = 'idle';
      if (manual) await ui.failed(error, 'check');
      return;
    }
    const info = result?.updateInfo;
    if (!result?.isUpdateAvailable || !info || (!manual && declined.has(info.version))) {
      phase = 'idle';
      if (manual && !result?.isUpdateAvailable) await ui.upToDate();
      return;
    }
    // Still busy while the owner decides: another check would replace the update the library downloads.
    phase = 'asking';
    let accepted = false;
    try {
      accepted = await ui.available(info, manual);
    } finally {
      if (!accepted) phase = 'idle';
    }
    if (!accepted) {
      declined.add(info.version);
      return;
    }
    phase = 'downloading';
    let failure;
    let stage = 'download';
    try {
      await updater.downloadUpdate();
      stage = 'install';
      await whenStaged();
    } catch (error) {
      failure = error;
    } finally {
      ui.progress(-1);
    }
    if (failure) {
      phase = 'idle';
      await ui.failed(failure, stage);
      return;
    }
    phase = 'ready';
    ready = info;
    await offerRestart();
  }

  return {
    /** Reads the owner's choice and, if checks are on, checks shortly after launch and then daily. */
    async start() {
      settings = await readUpdateSettings(settingsFile);
      schedule();
    },
    /** Check for Updates…, which works whether or not automatic checks are on. */
    check: () => check(true),
    setAutomatic(automatic) {
      settings = { automatic: automatic === true };
      schedule();
      const snapshot = { ...settings };
      const save = saving.then(() => saveUpdateSettings(settingsFile, snapshot));
      saving = save.catch(() => {});
      return save;
    },
    get automatic() { return settings.automatic; },
    stop() {
      timers.clearTimeout(first);
      timers.clearInterval(repeat);
    },
  };
}
