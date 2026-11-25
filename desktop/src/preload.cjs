// Only the bundled launcher receives this preload. The main process verifies the
// sending frame and validates the payload again before performing any operation.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("yourSpace", Object.freeze({
  appearance: () => ipcRenderer.invoke("launcher:appearance"),
  engines: () => ipcRenderer.invoke("launcher:engines"),
  start: ({ engine, expectedSocket }) => ipcRenderer.invoke("launcher:start", { engine, expectedSocket }),
  createOwner: ({ name, username }) => ipcRenderer.invoke("launcher:createOwner", { name, username }),
  connect: ({ url, name }) => ipcRenderer.invoke("launcher:connect", { url, name }),
  workspaces: () => ipcRenderer.invoke("launcher:workspaces"),
  open: ({ origin }) => ipcRenderer.invoke("launcher:open", { origin }),
  rename: ({ origin, name }) => ipcRenderer.invoke("launcher:rename", { origin, name }),
  remove: ({ origin }) => ipcRenderer.invoke("launcher:remove", { origin }),
  // The main process asks the launcher to read its list again; the page gets no event details.
  onRefresh: (callback) => {
    if (typeof callback === "function") ipcRenderer.on("launcher:refresh", () => callback());
  },
  openDockerGuide: () => ipcRenderer.invoke("launcher:openDockerGuide"),
}));
