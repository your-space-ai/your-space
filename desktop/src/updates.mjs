// The packaged app updates itself with electron-updater from the feed of the channel it follows,
// Alpha or Canary (spec 016). Checking is the only automatic outbound request, and the owner can turn
// it off; downloading and installing wait for the owner. The updater is loaded only in the packaged
// app, so a copy run from source never checks.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const checkInterval = 24 * 60 * 60_000;
export const firstCheckDelay = 30_000;
// How long Squirrel.Mac may take to unpack, verify and stage a downloaded update.
export const stagingTimeout = 5 * 60_000;

export const CHANNELS = Object.freeze(['alpha', 'canary']);
const releases = 'https://github.com/your-space-ai/your-space/releases/download/';

// Semantic Versioning 2.0.0's own pattern, as cli/src/version.ts has it.
const IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?` +
  '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$');

/** True for a canary build of main, whose version has a `canary` prerelease identifier, such as 0.1.0-alpha.2.canary.20261201.60. */
export function isCanaryBuild(version) {
  return SEMVER.exec(String(version))?.[4]?.split('.').includes('canary') ?? false;
}

/** The channel a build starts on: Canary for a canary build, Alpha for a release. */
export function buildChannel(version) {
  return isCanaryBuild(version) ? 'canary' : 'alpha';
}

/**
 * A channel's feed at its fixed address, the rolling release tagged with its name, read with the
 * generic provider: Alpha's latest-mac.yml, Canary's canary-mac.yml. The channel goes in the feed's
 * options. Setting the updater's own `channel` would turn on allowDowngrade, and it can't be unset.
 */
export function channelFeed(channel) {
  return { provider: 'generic', url: `${releases}${channel}/`, channel: channel === 'canary' ? 'canary' : undefined };
}

/** Applies the launcher's policy to electron-updater's updater and returns it. */
export function configureUpdater(updater) {
  updater.autoDownload = false;
  // electron-updater would hand a downloaded update to Squirrel.Mac at once, which stages it to
  // install when the app quits, and a staged update can't be taken back. The app stages one itself,
  // when the owner restarts into it or quits, so an update from a channel the owner left never installs.
  updater.autoInstallOnAppQuit = false;
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

/**
 * The owner's choices in updates.json: automatic checks, on unless turned off, and the channel, once
 * one is stored. A file that is there but can't be read, or names a channel this build doesn't know,
 * is `unreadable`; if it can't be read at all, automatic checks count as off.
 */
export async function readUpdateSettings(file) {
  let saved;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { automatic: true };
    return { automatic: false, unreadable: true };
  }
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return { automatic: false, unreadable: true };
  const automatic = saved.automatic !== false;
  if (!('channel' in saved)) return { automatic };
  return CHANNELS.includes(saved.channel) ? { automatic, channel: saved.channel } : { automatic, unreadable: true };
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

function installingError() {
  return Object.assign(new Error('An update is being installed, so the channel can’t change now.'), { code: 'installing' });
}

/**
 * @param {object} options
 * @param {() => unknown} options.load   electron-updater's autoUpdater, or null when the app runs from source
 * @param {string} options.settingsFile
 * @param {string} options.version   the app's own, whose channel is stored when none is yet
 * @param {(install: () => void) => Promise<void>} options.beforeInstall   stops the local workspace, then installs
 * @param {object} options.ui   unavailable(), upToDate(channel), busy(), failed(error, 'check' | 'download' | 'install', channel),
 *   available(info, manual) → boolean, downloaded(info) → boolean (restart now), dropped(info) when the
 *   owner accepted an update of the channel just left, progress(fraction, 2 while staging, or -1 to clear)
 * @param {import('node:events').EventEmitter & {checkForUpdates(): void}} [options.squirrel]   Electron's own
 *   autoUpdater. Its checkForUpdates() stages the update electron-updater downloaded; it then emits
 *   update-downloaded, or error when the signature fails
 */
export function createUpdates({ load, settingsFile, version, beforeInstall, ui, squirrel, timers = globalThis,
  delay = firstCheckDelay, interval = checkInterval, staging = stagingTimeout }) {
  let settings = { automatic: true, channel: buildChannel(version) };
  // Saves run one after another, so the file ends with the owner's last choice.
  let saving = Promise.resolve();
  let loaded;
  let updater;
  let phase = 'idle'; // idle → checking → asking → downloading → ready
  let ready;
  let first;
  let repeat;
  // Changing the channel starts a new generation. Whatever a check or download of an earlier one
  // finds afterwards is dropped: it is neither offered nor installed.
  let generation = 0;
  // The download in flight, cancelled when the channel changes.
  let token;
  // The last call into electron-updater, settled. While a call runs, the library hands the same
  // promise to the next caller, so a check after a change of channel waits out one from before it.
  let settled = Promise.resolve();
  // Versions the owner put off this session; an automatic check doesn't ask about them again.
  const declined = new Set();
  let staged = !squirrel;
  // Set once the update is handed to Squirrel.Mac, which installs a staged update when the app quits
  // and can't take it back; from then on the channel stays. Only Squirrel's refusal clears it.
  let handed = false;
  let stagingPromise;
  squirrel?.on('update-downloaded', () => { staged = true; });

  function track(call) {
    settled = Promise.resolve(call).then(() => {}, () => {});
    return call;
  }

  // Hands the downloaded update to Squirrel.Mac, which unpacks it, checks that it meets this app's
  // designated requirement and stages it. Resolves once it is staged; rejects if Squirrel refuses it.
  function stage() {
    if (staged) return Promise.resolve();
    stagingPromise ??= new Promise((resolve, reject) => {
      const done = () => finish();
      const failed = error => finish(error instanceof Error ? error : new Error(String(error)));
      const finish = error => {
        squirrel.off('update-downloaded', done);
        squirrel.off('error', failed);
        stagingPromise = undefined;
        if (!error) return resolve();
        handed = false;
        phase = 'idle';
        ready = undefined;
        reject(error);
      };
      squirrel.on('update-downloaded', done);
      squirrel.on('error', failed);
      handed = true;
      try { squirrel.checkForUpdates(); } catch (error) { failed(error); }
    });
    return stagingPromise;
  }

  // Waits for staging, at most `staging` milliseconds or until the signal aborts, with a progress
  // bar on the Dock icon meanwhile. A timeout doesn't release the channel: Squirrel may still stage
  // the update, and then installs it at quit.
  function whenStaged(signal) {
    if (staged) return Promise.resolve();
    let timer;
    let abort;
    const limit = new Promise((resolve, reject) => {
      timer = timers.setTimeout(() => reject(Object.assign(new Error('The update was not ready in time.'), { code: 'ERR_YS_STAGING_TIMEOUT' })), staging);
      abort = () => reject(new Error('Staging the update was stopped.'));
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
    });
    ui.progress(2);
    return Promise.race([stage(), limit]).finally(() => {
      timers.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      ui.progress(-1);
    });
  }

  function get() {
    loaded ??= Promise.resolve().then(load).then(value => {
      if (!value) return null;
      updater = configureUpdater(value);
      // A download cancelled by a change of channel may report progress after it; that isn't shown.
      updater.on('download-progress', progress => {
        if (phase === 'downloading') ui.progress(Math.max(0, Math.min(1, progress.percent / 100)));
      });
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

  function save() {
    const snapshot = { ...settings };
    const saved = saving.then(() => saveUpdateSettings(settingsFile, snapshot));
    saving = saved.catch(() => {});
    return saved;
  }

  // Restart Now stages the update first, so one Squirrel refuses never stops the workspace for an
  // install that can't happen, then stops the workspace and installs.
  async function offerRestart() {
    const run = generation;
    const info = ready;
    const restart = await ui.downloaded(info);
    if (run !== generation) {
      // The owner changed the channel while asked: the update is dropped, and Restart Now says so.
      if (restart) await ui.dropped(info);
      return;
    }
    if (!restart || phase !== 'ready') return;
    try {
      await whenStaged();
    } catch (error) {
      await ui.failed(error, 'install', settings.channel);
      return;
    }
    await beforeInstall(() => updater.quitAndInstall());
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
    const run = generation;
    const current = () => run === generation;
    const { channel } = settings;
    phase = 'checking';
    let result;
    try {
      const value = await get();
      if (!current()) return;
      if (!value) {
        phase = 'idle';
        if (manual) await ui.unavailable();
        return;
      }
      await settled;
      if (!current()) return;
      // Every check reads the stored channel's feed, whatever an earlier check read.
      updater.setFeedURL(channelFeed(channel));
      result = await track(updater.checkForUpdates());
    } catch (error) {
      if (!current()) return;
      phase = 'idle';
      if (manual) await ui.failed(error, 'check', channel);
      return;
    }
    if (!current()) return;
    const info = result?.updateInfo;
    // Alpha's feed never names a canary and Canary's only canaries; a feed that does can't be used.
    // Nor can one whose version isn't plain SemVer, such as v0.1.0 or one with spaces around it,
    // which electron-updater still reads but this check couldn't place on a channel.
    if (info && (!SEMVER.test(String(info.version)) || isCanaryBuild(info.version) !== (channel === 'canary'))) {
      phase = 'idle';
      if (manual) await ui.failed(Object.assign(new Error(`The ${channel} feed names ${info.version}.`), { code: 'ERR_YS_CHANNEL_MISMATCH' }), 'check', channel);
      return;
    }
    if (!result?.isUpdateAvailable || !info || (!manual && declined.has(info.version))) {
      phase = 'idle';
      if (manual && !result?.isUpdateAvailable) await ui.upToDate(channel);
      return;
    }
    // Still busy while the owner decides: another check would replace the update the library downloads.
    phase = 'asking';
    let accepted = false;
    try {
      accepted = await ui.available(info, manual);
    } finally {
      if (!accepted && current()) phase = 'idle';
    }
    if (!current()) {
      // The owner changed the channel while asked: nothing downloads, and Download says so.
      if (accepted) await ui.dropped(info);
      return;
    }
    if (!accepted) {
      declined.add(info.version);
      return;
    }
    phase = 'downloading';
    token = result.cancellationToken;
    let failure;
    try {
      await track(updater.downloadUpdate(token));
    } catch (error) {
      failure = error;
    }
    if (!current()) return;
    token = undefined;
    ui.progress(-1);
    if (failure) {
      phase = 'idle';
      await ui.failed(failure, 'download', channel);
      return;
    }
    phase = 'ready';
    ready = info;
    await offerRestart();
  }

  return {
    /**
     * Reads the owner's choices and, if checks are on, checks shortly after launch and then daily.
     * With no channel stored yet, as in a new installation or one updated from alpha.1, it stores this
     * build's own at once, so the channel stays the same through updates until the owner changes it.
     * A file it can't read is left as it is: the session follows Alpha, which offers no canary, and
     * only the owner's next choice in the menu replaces the file.
     */
    async start() {
      const saved = await readUpdateSettings(settingsFile);
      settings = { automatic: saved.automatic, channel: saved.channel ?? (saved.unreadable ? 'alpha' : buildChannel(version)) };
      schedule();
      if (!saved.channel && !saved.unreadable) await save();
    },
    /** Check for Updates…, which works whether or not automatic checks are on. */
    check: () => check(true),
    setAutomatic(automatic) {
      settings = { ...settings, automatic: automatic === true };
      schedule();
      return save();
    },
    /**
     * Follows another channel from the next check. A check in progress, and an update found or
     * downloaded from the other channel's feed, are dropped: neither offered nor installed, not even
     * at quit. Refused once an update has gone to Squirrel.Mac.
     */
    setChannel(channel) {
      if (!CHANNELS.includes(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
      if (handed) return Promise.reject(installingError());
      if (channel !== settings.channel) {
        settings = { ...settings, channel };
        generation++;
        token?.cancel();
        token = undefined;
        if (phase === 'downloading') ui.progress(-1);
        phase = 'idle';
        ready = undefined;
      }
      return save();
    },
    /** For quitting: whether a downloaded update of the channel followed now waits to be staged. */
    get installsAtQuit() { return phase === 'ready' && !staged; },
    /**
     * At quit: stages a downloaded update of the channel followed now, which Squirrel.Mac then
     * installs once the app has quit. Settles when it is staged, refused, timed out or the signal
     * aborts, and never rejects.
     */
    async stageAtQuit(signal) {
      if (phase !== 'ready' || staged) return;
      await whenStaged(signal).catch(() => {});
    },
    get automatic() { return settings.automatic; },
    get channel() { return settings.channel; },
    /** True once an update has gone to Squirrel.Mac: the channel can't change. */
    get installing() { return handed; },
    stop() {
      timers.clearTimeout(first);
      timers.clearInterval(repeat);
    },
  };
}
