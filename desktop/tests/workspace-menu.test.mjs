import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceMenu } from '../src/workspace-menu.mjs';

const saved = Array.from({length: 11}, (_, i) => ({name: `Workspace ${i + 1}`, origin: `https://w${i + 1}.example.com`}));

test('the Workspace menu lists saved workspaces in order, the first nine on ⌘1–⌘9, then adding and managing', () => {
  const calls = [];
  const menu = workspaceMenu({
    saved, frontmost: 'https://w2.example.com',
    open: origin => calls.push(['open', origin]),
    addServer: () => calls.push(['add']),
    manage: () => calls.push(['manage']),
  });
  const workspaces = menu.slice(0, saved.length);
  assert.deepEqual(workspaces.map(item => item.label), saved.map(entry => entry.name));
  assert.deepEqual(workspaces.map(item => item.accelerator), [...Array.from({length: 9}, (_, i) => `CmdOrCtrl+${i + 1}`), undefined, undefined]);
  assert.deepEqual(workspaces.map(item => [item.type, item.checked]).filter(([, checked]) => checked), [['checkbox', true]]);
  assert.equal(workspaces[1].checked, true);
  assert.deepEqual(menu.slice(saved.length).map(({type, label, accelerator, role}) => ({type, label, accelerator, role})), [
    {type: 'separator', label: undefined, accelerator: undefined, role: undefined},
    {type: undefined, label: 'Add a server…', accelerator: undefined, role: undefined},
    {type: undefined, label: 'Manage workspaces…', accelerator: 'CmdOrCtrl+Shift+O', role: undefined},
    {type: 'separator', label: undefined, accelerator: undefined, role: undefined},
    {type: undefined, label: undefined, accelerator: undefined, role: 'close'},
  ]);
  workspaces[9].click();
  menu.find(item => item.label === 'Add a server…').click({checked: true});
  menu.find(item => item.label === 'Manage workspaces…').click();
  assert.deepEqual(calls, [['open', 'https://w10.example.com'], ['add'], ['manage']]);
});

test('with nothing saved or no workspace in front, the menu has no workspace items or no check', () => {
  assert.deepEqual(workspaceMenu({saved: [], open() {}, addServer() {}, manage() {}}).map(item => item.label ?? item.type ?? item.role),
    ['Add a server…', 'Manage workspaces…', 'separator', 'close']);
  assert.equal(workspaceMenu({saved, frontmost: undefined, open() {}, addServer() {}, manage() {}}).some(item => item.checked), false);
});
