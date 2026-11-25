"use strict";

const api = window.yourSpace;
const byId = (id) => document.getElementById(id);
const views = ["welcome", "local", "owner", "remote"];
const guideCodes = new Set(["docker_missing", "engine_missing", "engine_unsupported", "compose_missing", "permission_denied"]);
let active = "welcome";
let busy = false;
let checking = false;
let discovery = 0;
let engines = [];
let engineProblem = null;
// The saved workspaces, in the order the main process keeps them.
let saved = [];
let loaded = false;
// After a workspace opens, the launcher hides; when it shows again, it shows the list.
let afterOpen = false;
// A request from the main process that arrived while an operation was running.
let deferred = null;
// Where the list's focus and scroll were when another section replaced it.
let remembered = null;
// The saved workspace the rename and remove dialog is about, and what gets focus when it closes.
let managing = null;
let returnFocus = null;
// Each opening of the dialog, so a reply to an earlier one changes nothing in it; and whether a
// rename or remove is waiting for its reply, which keeps the dialog open until it comes.
let dialogRun = 0;
let changing = false;
const firstIntro = byId("welcome-intro").textContent;

// A focused control, described so it can be found again after the list is drawn anew.
function keyOf(element) {
  if (!element || element === document.body) return null;
  if (element.dataset?.origin) return { origin: element.dataset.origin, kind: element.dataset.kind };
  return element.id ? { id: element.id } : null;
}

function findKey(key) {
  if (!key) return null;
  const element = key.id ? byId(key.id) : [...byId("saved-list").querySelectorAll("button")]
    .find((button) => button.dataset.origin === key.origin && button.dataset.kind === key.kind);
  return element && element.getClientRects().length ? element : null;
}

function show(view, focus = true) {
  const returning = view === "welcome" && active !== "welcome";
  if (active === "welcome" && view !== "welcome") {
    remembered = { scroll: window.scrollY, key: keyOf(document.activeElement) };
  }
  discovery += 1;
  checking = false;
  for (const id of views) byId(id).hidden = id !== view;
  byId("back").hidden = view === "welcome";
  byId("status").textContent = "";
  byId("problem").textContent = "";
  active = view;
  byId(view).querySelector(".intro").after(byId("feedback"));
  if (!focus || (view === "welcome" && !returning)) return;
  // Back on the list, the control that left it gets focus again, at the same scroll position.
  const target = returning && findKey(remembered?.key);
  if (target) {
    target.focus({ preventScroll: true });
    window.scrollTo(0, remembered.scroll);
  } else byId(view + "-title").focus();
}

function lastOpenedLabel(time, now = Date.now()) {
  if (!time) return "";
  const day = (value) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(time)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return days + " days ago";
  const date = new Date(time);
  const year = date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" };
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...year });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(entry) {
  const item = element("li", "saved-row");
  const open = element("button", "saved-open");
  open.type = "button";
  open.dataset.origin = entry.origin;
  open.dataset.kind = "open";
  const icon = element("span", "choice-icon " + (entry.local ? "computer" : "server"));
  icon.setAttribute("aria-hidden", "true");
  const text = element("span", "saved-text");
  text.append(element("strong", "", entry.name), element("small", "", entry.origin));
  const state = element("span", "saved-state");
  if (entry.running) {
    const dot = element("span", "running-dot");
    dot.setAttribute("aria-hidden", "true");
    state.append(dot, "Running");
  } else state.textContent = lastOpenedLabel(entry.lastOpened);
  open.append(icon, text, state);
  open.addEventListener("click", () => openSaved(entry));
  const edit = element("button", "saved-edit", "⋯");
  edit.type = "button";
  edit.dataset.origin = entry.origin;
  edit.dataset.kind = "edit";
  edit.title = "Rename or remove";
  edit.setAttribute("aria-label", "Rename or remove " + entry.name);
  edit.addEventListener("click", () => manage(entry));
  item.append(open, edit);
  return item;
}

// The list replaces the first-run choices once a workspace is saved. Focus and scroll stay put.
function render(list) {
  const focused = keyOf(document.activeElement);
  const scroll = window.scrollY;
  saved = Array.isArray(list) ? list : [];
  const any = saved.length > 0;
  byId("welcome-title").textContent = any ? "Open a workspace" : "Open your workspace";
  byId("welcome-intro").textContent = any ? "Choose one you use, or add another." : firstIntro;
  byId("saved").hidden = !any;
  byId("first-choices").hidden = any;
  byId("run-here").hidden = saved.some((entry) => entry.local);
  byId("saved-list").replaceChildren(...saved.map(row));
  byId("welcome").classList.remove("loading");
  loaded = true;
  if (focused?.origin) findKey(focused)?.focus({ preventScroll: true });
  if (active === "welcome") window.scrollTo(0, scroll);
}

async function refresh() {
  let state;
  try { state = await api.workspaces(); } catch { state = null; }
  if (state && !state.error && Array.isArray(state.workspaces)) render(state.workspaces);
  else if (!loaded) render([]);
  handle(state?.request);
}

// The main process asks for the list, the address form or a saved workspace, from its menu or Dock icon.
function handle(request) {
  if (busy) {
    if (request) deferred = request;
    return;
  }
  if (!request && !afterOpen) return;
  afterOpen = false;
  if (byId("manage").open && request) {
    if (changing) {
      deferred = request;
      return;
    }
    byId("manage").close();
  }
  if (request?.view === "remote") {
    byId("remote-form").reset();
    show("remote");
    return;
  }
  if (active !== "welcome") show("welcome");
  else {
    byId("status").textContent = "";
    byId("problem").textContent = "";
  }
  const entry = request?.open && saved.find((item) => item.origin === request.open);
  if (entry) openSaved(entry);
}

function selectedEngine() {
  const select = byId("engine");
  const option = select.selectedOptions[0];
  if (!option || option.disabled) return "";
  return option.dataset.socket === "custom" ? byId("socket").value.trim() : select.value;
}

function updateEngine() {
  const option = byId("engine").selectedOptions[0];
  const custom = option?.dataset.socket === "custom";
  const value = selectedEngine();
  const context = custom ? null : engines.find((item) => item.name === value);
  byId("socket-field").hidden = !custom;
  byId("socket").required = custom;
  byId("socket").setCustomValidity(custom && value && !value.startsWith("/") ? "Enter an absolute Unix socket path beginning with /." : "");
  byId("engine-label").textContent = context ? context.name : custom && value ? "Custom Unix socket" : "Local Docker engine";
  byId("endpoint").textContent = context?.socket || (custom && value) ||
    (engineProblem ? "Engine needs attention" : "Choose a local engine to continue.");
  byId("start").disabled = busy || checking || !value;
}

function fillEngines(result) {
  const select = byId("engine");
  const previous = selectedEngine();
  const previouslyCustom = select.selectedOptions[0]?.dataset.socket === "custom";
  const previouslyDisplayed = engines.find((item) => item.name === previous)?.socket;
  engines = result.engines;
  const saved = result.saved;
  engineProblem = result.problem;
  select.replaceChildren();

  const empty = new Option("Choose a local engine", "");
  empty.disabled = true;
  select.add(empty);
  let chosen = empty;
  for (const item of engines) {
    const option = new Option(item.name + (item.detected ? " (detected)" : ""), item.name);
    select.add(option);
    const sameSaved = saved && saved.name === item.name && saved.socket === item.socket;
    const samePrevious = !previouslyCustom && previous === item.name && previouslyDisplayed === item.socket;
    if (previous ? samePrevious : saved ? sameSaved : item.detected) chosen = option;
  }
  const custom = new Option("Enter a Unix socket path");
  custom.dataset.socket = "custom";
  select.add(custom);
  if (previous && previouslyCustom) chosen = custom;
  else if (!previous && saved && (saved.name.startsWith("/") || saved.name.startsWith("unix:///"))) {
    chosen = custom;
    byId("socket").value = saved.socket.replace(/^unix:\/\//, "");
  }
  chosen.selected = true;
  const selectionMissing = chosen === empty;
  byId("engine-details").open = (selectionMissing && (engines.length > 0 || !!saved)) || chosen === custom;
  byId("guide").hidden = !(guideCodes.has(engineProblem?.code) || (!saved && !engines.length));
  byId("engine-guidance").hidden = byId("guide").hidden;
  byId("retry").hidden = !engineProblem && !selectionMissing;
  if (engineProblem) byId("problem").textContent = engineProblem.message;
  else if (selectionMissing && (saved || previous)) byId("problem").textContent = "The selected engine changed or is unavailable. Check the socket before choosing an engine.";
  updateEngine();
}

// Disable the active form during native operations, including Enter-key submissions.
// Only owner-visible sanitized errors returned by the main process reach the page.
async function run(message, action) {
  if (busy) return;
  const view = active;
  const focused = document.activeElement;
  const controls = [byId("back"), ...byId(view).querySelectorAll("input, button, select")];
  const disabled = controls.map((element) => element.disabled);
  busy = true;
  controls.forEach((element) => { element.disabled = true; });
  byId("status").textContent = message;
  byId("problem").textContent = "";
  try {
    await action();
  } catch {
    byId("problem").textContent = "Your Space couldn’t finish this step. Try again.";
  } finally {
    busy = false;
    controls.forEach((element, index) => { element.disabled = disabled[index]; });
    if (byId("status").textContent === message) byId("status").textContent = "";
    if (active === "local") updateEngine();
    if (active === view && byId("problem").textContent && focused?.isConnected) focused.focus();
    if (deferred) {
      const request = deferred;
      deferred = null;
      handle(request);
    }
  }
}

function successful(result) {
  if (!result?.error) return true;
  byId("problem").textContent = result.error.message;
  if (active === "local") byId("retry").hidden = false;
  if (active === "local" && guideCodes.has(result.error.code)) {
    byId("guide").hidden = false;
    byId("engine-guidance").hidden = false;
  }
  return false;
}

// `note` explains why the launcher came here, such as This Mac failing to start; an engine problem
// found by the check takes its place.
async function checkEngines(note) {
  // Engine checks may take time. Back and the remote path remain available.
  const request = ++discovery;
  checking = true;
  byId("retry").disabled = true;
  byId("status").textContent = "Checking local Docker engines…";
  byId("problem").textContent = "";
  updateEngine();
  try {
    const result = await api.engines();
    if (request === discovery && successful(result)) {
      fillEngines(result);
      if (typeof note === "string" && !byId("problem").textContent) byId("problem").textContent = note;
    }
  } catch {
    if (request === discovery) {
      byId("retry").hidden = false;
      byId("problem").textContent = "Your Space couldn’t check Docker. Try again.";
    }
  } finally {
    if (request === discovery) {
      checking = false;
      byId("retry").disabled = false;
      byId("status").textContent = "";
      updateEngine();
    }
  }
}

function enterWorkspace(result) {
  if (!successful(result)) return;
  if (result.state === "owner-needed") show("owner");
  else if (result.state === "ready") {
    afterOpen = true;
    if (active === "remote") byId("remote-form").reset();
    byId("status").textContent = "Opening your dashboard…";
  }
}

// This Mac starts the local workspace with the engine it was set up on. If that fails, the local
// section checks the engines again and shows why, so the owner can fix it or choose another.
function openSaved(entry) {
  if (busy) return;
  void run(entry.local ? "Starting your local workspace…" : "Connecting to your server…", async () => {
    const result = await api.open({ origin: entry.origin });
    if (entry.local && result?.error && !["busy", "forbidden", "not_saved"].includes(result.error.code)) {
      show("local");
      void checkEngines(result.error.message);
      return;
    }
    if (result?.error?.code === "not_saved") void refresh();
    enterWorkspace(result);
  });
}

function manage(entry) {
  if (busy) return;
  dialogRun += 1;
  managing = entry;
  returnFocus = { origin: entry.origin, kind: "edit" };
  byId("rename-form").hidden = false;
  byId("confirm-remove").hidden = true;
  byId("manage").setAttribute("aria-labelledby", "manage-title");
  byId("manage-address").textContent = entry.origin;
  byId("manage-name").value = entry.name;
  byId("manage-name").placeholder = entry.local ? "This Mac" : new URL(entry.origin).host;
  byId("manage-name-help").textContent = entry.local ? "Leave it empty to call it This Mac." : "Leave it empty to use the server’s host name.";
  byId("manage-problem").textContent = "";
  byId("manage").showModal();
  byId("manage-name").select();
}

function confirmRemove() {
  const entry = managing;
  byId("rename-form").hidden = true;
  byId("confirm-remove").hidden = false;
  byId("manage").setAttribute("aria-labelledby", "remove-title");
  byId("remove-title").textContent = "Remove “" + entry.name + "”?";
  byId("remove-detail").textContent = entry.local
    ? "Your Space forgets this entry and nothing else: the workspace on this Mac isn’t stopped or uninstalled, and its apps and data stay. Run on this Mac opens it again."
    : "Your Space forgets this address and nothing else: the workspace and its data stay on the server. You can add it again at any time.";
  byId("remove-problem").textContent = "";
  byId("remove-cancel").focus();
}

// Rename and remove change only the saved list, and the list is drawn again from the reply. A reply
// for an earlier opening of the dialog only redraws the list.
async function change(problem, action) {
  if (changing) return null;
  const run = dialogRun;
  const buttons = byId("manage").querySelectorAll("button, input");
  buttons.forEach((control) => { control.disabled = true; });
  changing = true;
  let result;
  try {
    result = await action();
  } catch {
    result = { error: { message: "Your Space couldn’t save this change. Try again." } };
  } finally {
    changing = false;
    buttons.forEach((control) => { control.disabled = false; });
  }
  // A request that waited for this reply is handled once the dialog has finished with it.
  if (deferred && !busy) {
    const request = deferred;
    deferred = null;
    setTimeout(() => handle(request));
  }
  const current = run === dialogRun && byId("manage").open;
  if (!result?.error) {
    if (current) return result;
    render(result.workspaces);
    return null;
  }
  if (current) byId(problem).textContent = result.error.message;
  return null;
}

byId("rename-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const entry = managing;
  if (!entry) return;
  const result = await change("manage-problem", () => api.rename({ origin: entry.origin, name: byId("manage-name").value.trim() }));
  if (!result) {
    if (byId("manage").open) byId("manage-name").focus();
    return;
  }
  render(result.workspaces);
  byId("manage").close();
});
byId("manage-remove").addEventListener("click", confirmRemove);
byId("manage-cancel").addEventListener("click", () => byId("manage").close());
byId("remove-cancel").addEventListener("click", () => byId("manage").close());
byId("remove-confirm").addEventListener("click", async () => {
  const entry = managing;
  if (!entry) return;
  const index = saved.findIndex((item) => item.origin === entry.origin);
  const result = await change("remove-problem", () => api.remove({ origin: entry.origin }));
  if (!result) {
    if (byId("manage").open) byId("remove-cancel").focus();
    return;
  }
  // Focus moves to the row that took its place, the one before it, or the heading.
  const rest = result.workspaces;
  const next = rest[index] ?? rest[index - 1];
  returnFocus = next ? { origin: next.origin, kind: "open" } : { id: "welcome-title" };
  render(rest);
  byId("manage").close();
});
// Escape doesn't close the dialog while its change waits for a reply.
byId("manage").addEventListener("cancel", (event) => {
  if (changing) event.preventDefault();
});
// The close event comes a moment after the dialog closes, and the dialog may have opened again by then.
byId("manage").addEventListener("close", () => {
  if (byId("manage").open || active !== "welcome") return;
  const target = findKey(returnFocus) ?? (byId("add-server").getClientRects().length ? byId("add-server") : byId("welcome-title"));
  target.focus();
});

byId("local-choice").addEventListener("click", () => {
  show("local");
  void checkEngines();
});
byId("remote-choice").addEventListener("click", () => show("remote"));
byId("run-here").addEventListener("click", () => {
  show("local");
  void checkEngines();
});
byId("add-server").addEventListener("click", () => {
  byId("remote-form").reset();
  show("remote");
});
byId("back").addEventListener("click", () => show(active === "owner" ? "local" : "welcome"));
byId("retry").addEventListener("click", () => checkEngines());
byId("engine").addEventListener("change", updateEngine);
byId("socket").addEventListener("input", updateEngine);
byId("guide").addEventListener("click", () => run("Opening the setup guide…", async () => {
  successful(await api.openDockerGuide());
}));

byId("local-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const engine = selectedEngine();
  if (checking || !engine) return;
  const expectedSocket = byId("engine").selectedOptions[0].dataset.socket === "custom"
    ? engine : engines.find((item) => item.name === engine)?.socket;
  void run("Starting your workspace. The first start may take a few minutes…", async () => {
    enterWorkspace(await api.start({ engine, expectedSocket }));
  });
});

byId("owner-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = byId("owner-name").value.trim();
  const username = byId("username").value.trim();
  void run("Preparing your owner account…", async () => {
    enterWorkspace(await api.createOwner({ name, username }));
  });
});

byId("remote-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("address");
  let address;
  try {
    address = new URL(input.value.trim());
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(address.hostname) || address.hostname.endsWith(".localhost");
    const allowed = address.protocol === "https:" || (address.protocol === "http:" && loopback);
    if (!allowed || address.username || address.password || address.href !== address.origin + "/") throw new Error();
  } catch {
    if (address?.username || address?.password || address?.search || address?.hash) input.value = "";
    input.setCustomValidity("Enter the server’s HTTPS address, or http://space.localhost and its port for a workspace on this Mac, without a path, credentials, query or fragment.");
    input.reportValidity();
    return;
  }
  const name = byId("server-name").value.trim();
  void run("Connecting to your server…", async () => {
    enterWorkspace(await api.connect({ url: address.origin, name }));
  });
});
byId("address").addEventListener("input", (event) => {
  event.target.setCustomValidity("");
  // The name defaults to the address's host, shown as the name field's placeholder.
  let host = "";
  try { host = new URL(event.target.value.trim()).host; } catch { /* Not an address yet. */ }
  byId("server-name").placeholder = host;
});
byId("remote-form").addEventListener("reset", () => {
  byId("address").setCustomValidity("");
  byId("server-name").placeholder = "";
});
api.onRefresh?.(() => void refresh());
updateEngine();
void refresh();
