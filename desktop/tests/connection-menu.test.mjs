import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionMenu } from '../src/connection-menu.mjs';

const saved = Array.from({length: 11}, (_, i) => ({name: `Connection ${i + 1}`, origin: `https://w${i + 1}.example.com`}));

test('the Connections menu lists saved connections in order, the first nine on ⌘1–⌘9, then adding and managing', () => {
  const calls = [];
  const menu = connectionMenu({
    saved, frontmost: 'https://w2.example.com',
    open: origin => calls.push(['open', origin]),
    addServer: () => calls.push(['add']),
    manage: () => calls.push(['manage']),
  });
  const connections = menu.slice(0, saved.length);
  assert.deepEqual(connections.map(item => item.label), saved.map(entry => entry.name));
  assert.deepEqual(connections.map(item => item.accelerator), [...Array.from({length: 9}, (_, i) => `CmdOrCtrl+${i + 1}`), undefined, undefined]);
  assert.deepEqual(connections.map(item => [item.type, item.checked]).filter(([, checked]) => checked), [['checkbox', true]]);
  assert.equal(connections[1].checked, true);
  assert.deepEqual(menu.slice(saved.length).map(({type, label, accelerator, role}) => ({type, label, accelerator, role})), [
    {type: 'separator', label: undefined, accelerator: undefined, role: undefined},
    {type: undefined, label: 'Add a server…', accelerator: undefined, role: undefined},
    {type: undefined, label: 'Manage connections…', accelerator: 'CmdOrCtrl+Shift+O', role: undefined},
    {type: 'separator', label: undefined, accelerator: undefined, role: undefined},
    {type: undefined, label: undefined, accelerator: undefined, role: 'close'},
  ]);
  connections[9].click();
  menu.find(item => item.label === 'Add a server…').click({checked: true});
  menu.find(item => item.label === 'Manage connections…').click();
  assert.deepEqual(calls, [['open', 'https://w10.example.com'], ['add'], ['manage']]);
});

test('with nothing saved or no connection in front, the menu has no connection items or no check', () => {
  assert.deepEqual(connectionMenu({saved: [], open() {}, addServer() {}, manage() {}}).map(item => item.label ?? item.type ?? item.role),
    ['Add a server…', 'Manage connections…', 'separator', 'close']);
  assert.equal(connectionMenu({saved, frontmost: undefined, open() {}, addServer() {}, manage() {}}).some(item => item.checked), false);
});

test("a name's own & shows as written, since menus read a single & as a mnemonic marker", () => {
  const [item] = connectionMenu({saved: [{name: 'R&D && Ops', origin: 'https://rd.example.com'}], open() {}, addServer() {}, manage() {}});
  assert.equal(item.label, 'R&&D &&&& Ops');
});
