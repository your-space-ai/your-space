// The Workspace menu: each saved workspace in the list's order, the first nine on ⌘1–⌘9, with a check
// on the one in the frontmost window; then adding a server and the launcher's list. It imports
// nothing from Electron, so the template can be tested on its own.

/**
 * @param {object} options
 * @param {{name: string, origin: string}[]} options.saved   the saved workspaces, in order
 * @param {string | undefined} options.frontmost   the address of the frontmost workspace window
 * @param {(origin: string) => void} options.open   focuses that workspace's window or opens it
 * @param {() => void} options.addServer   shows the launcher's address form
 * @param {() => void} options.manage   shows the launcher's list
 */
export function workspaceMenu({saved, frontmost, open, addServer, manage}) {
  const workspaces = saved.map((entry, index) => ({
    label: entry.name,
    type: 'checkbox',
    checked: entry.origin === frontmost,
    ...(index < 9 ? {accelerator: 'CmdOrCtrl+' + (index + 1)} : {}),
    click: () => open(entry.origin),
  }));
  return [
    ...workspaces,
    ...(workspaces.length ? [{type: 'separator'}] : []),
    {label: 'Add a server…', click: () => addServer()},
    {label: 'Manage workspaces…', accelerator: 'CmdOrCtrl+Shift+O', click: () => manage()},
    {type: 'separator'},
    {role: 'close'},
  ];
}
