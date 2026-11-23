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

function show(view, focus = true) {
  discovery += 1;
  checking = false;
  for (const id of views) byId(id).hidden = id !== view;
  byId("back").hidden = view === "welcome";
  byId("open-appearance").hidden = view !== "welcome";
  byId("status").textContent = "";
  byId("problem").textContent = "";
  active = view;
  byId(view).querySelector(".intro").after(byId("feedback"));
  if (focus) byId(view + "-title").focus();
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
  const form = byId(view).querySelector("form");
  const controls = [byId("back"), ...(form?.querySelectorAll("input, button, select") || [])];
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

async function checkEngines() {
  // Engine checks may take time. Back and the remote path remain available.
  const request = ++discovery;
  checking = true;
  byId("retry").disabled = true;
  byId("status").textContent = "Checking local Docker engines…";
  byId("problem").textContent = "";
  updateEngine();
  try {
    const result = await api.engines();
    if (request === discovery && successful(result)) fillEngines(result);
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
  else if (result.state === "ready") byId("status").textContent = "Opening your dashboard…";
}

byId("local-choice").addEventListener("click", () => {
  show("local");
  void checkEngines();
});
byId("remote-choice").addEventListener("click", () => show("remote"));
byId("back").addEventListener("click", () => show(active === "owner" ? "local" : "welcome"));
byId("retry").addEventListener("click", checkEngines);
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
  void run("Connecting to your server…", async () => {
    enterWorkspace(await api.connect({ url: address.origin }));
  });
});
byId("address").addEventListener("input", (event) => event.target.setCustomValidity(""));
updateEngine();
