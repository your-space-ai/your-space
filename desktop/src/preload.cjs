// Only the bundled launcher receives this preload. The main process verifies the
// sending frame and validates the payload again before performing any operation.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yourSpace", Object.freeze({
  appearance: () => ipcRenderer.invoke("launcher:appearance"),
  engines: () => ipcRenderer.invoke("launcher:engines"),
  start: ({ engine, expectedSocket }) => ipcRenderer.invoke("launcher:start", { engine, expectedSocket }),
  createOwner: ({ name, username }) => ipcRenderer.invoke("launcher:createOwner", { name, username }),
  connect: ({ url }) => ipcRenderer.invoke("launcher:connect", { url }),
  openDockerGuide: () => ipcRenderer.invoke("launcher:openDockerGuide"),
}));
