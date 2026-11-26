// The update items of the Your Space menu: Check for Updates…, Check for Updates Automatically, and
// Update Channel, with Alpha and Canary as radio items (spec 016), and what the app says about the
// channel. It imports nothing from Electron, so the template and the messages can be tested on their own.
import { CHANNELS, isCanaryBuild } from './updates.mjs';

export const CHANNEL_NAMES = Object.freeze({ alpha: 'Alpha', canary: 'Canary' });

// On a canary build set to Alpha, nothing is offered until an alpha newer than the build is published.
export const leavingCanary = 'You’ll move to Alpha with the next alpha';

/** The warning shown before following Canary. Cancel is the default. */
export const canaryWarning = Object.freeze({
  type: 'warning',
  message: 'Follow canary builds?',
  detail: 'Canary builds are made from Your Space’s newest code before it is released. They aren’t supported, ' +
    'and a canary may change your data in ways the next alpha doesn’t expect. Your Space can’t go back to an ' +
    'earlier version, so choosing Alpha later waits for an alpha newer than your canary.',
  buttons: ['Cancel', 'Use Canary'],
  defaultId: 0,
  cancelId: 0,
});

/**
 * @param {object} options
 * @param {boolean} options.automatic   whether the app checks by itself
 * @param {'alpha' | 'canary'} options.channel   the channel stored
 * @param {string} options.version   the app's own
 * @param {boolean} options.installing   an update has gone to Squirrel.Mac, so the channel can't change
 * @param {() => void} options.check   Check for Updates…
 * @param {(automatic: boolean) => void} options.setAutomatic
 * @param {(channel: 'alpha' | 'canary') => void} options.choose   the owner chose a channel
 */
export function updateMenu({ automatic, channel, version, installing, check, setAutomatic, choose }) {
  return [
    { label: 'Check for Updates…', click: () => check() },
    { label: 'Check for Updates Automatically', type: 'checkbox', checked: automatic, click: item => setAutomatic(item.checked) },
    { label: 'Update Channel', submenu: [
      ...CHANNELS.map(name => ({
        label: CHANNEL_NAMES[name], type: 'radio', checked: name === channel, enabled: !installing, click: () => choose(name),
      })),
      ...(channel === 'alpha' && isCanaryBuild(version) ? [{ type: 'separator' }, { label: leavingCanary, enabled: false }] : []),
    ] },
  ];
}

/**
 * The owner's choice in Update Channel: Canary asks first, and Alpha on a canary build says when it
 * takes effect. Resolves to the channel stored afterwards.
 * @param {'alpha' | 'canary'} choice
 * @param {object} options
 * @param {'alpha' | 'canary'} options.current
 * @param {string} options.version   the app's own
 * @param {(options: object) => Promise<number>} options.ask   shows a message box, resolving to the button chosen
 * @param {(channel: string) => Promise<void>} options.setChannel
 */
export async function chooseChannel(choice, { current, version, ask, setChannel }) {
  if (choice === current) return current;
  if (choice === 'canary' && (await ask(canaryWarning)) !== canaryWarning.buttons.indexOf('Use Canary')) return current;
  try {
    await setChannel(choice);
  } catch (error) {
    if (error?.code !== 'installing') throw error;
    await ask({ message: 'Your Space is installing an update', detail: 'Choose the update channel again once it has restarted.' });
    return current;
  }
  if (choice === 'alpha' && isCanaryBuild(version)) {
    await ask({ message: leavingCanary, detail: `This is canary ${version}. Your Space stays on it until an alpha newer than it is published, then offers that alpha.` });
  }
  return choice;
}

/** What Check for Updates… says when nothing is newer on the channel. */
export function upToDateMessage(version, channel) {
  if (channel === 'alpha' && isCanaryBuild(version)) {
    return { message: 'No alpha is newer than this canary yet', detail: `This is canary ${version}. ${leavingCanary}.` };
  }
  return { message: 'Your Space is up to date', detail: `Version ${version} is the newest ${CHANNEL_NAMES[channel]} build.` };
}

/** Why Check for Updates… found nothing: the channel's feed couldn't be read, so nothing is offered. */
export function checkFailedDetail(channel) {
  return `Your Space couldn’t read the ${CHANNEL_NAMES[channel] ?? 'update'} channel’s feed, so it offers nothing. ` +
    'Check your internet connection, then try again from Your Space › Check for Updates…';
}
