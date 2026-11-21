(() => {
  const button = byId("open-appearance");
  const dialog = byId("appearance");
  const cards = byId("theme-cards");
  const file = byId("theme-file");
  const error = byId("theme-error");
  const save = byId("apply-theme");
  const art = { canopy: "canopy.webp", tide: "tide.webp", ember: "ember.webp" };
  let library;
  let themes = [];
  let choice;
  let importedText;
  let revision = 0;
  let saving = false;

  function artwork(id) {
    return Object.hasOwn(art, id) ? "../../web/public/themes/" + art[id] : null;
  }

  function paint(theme) {
    for (const [key, value] of Object.entries(theme.variables)) document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = theme.scheme;
    const image = byId("workspace-art");
    const url = artwork(theme.id);
    if (url) image.src = url;
    image.hidden = !url;
  }

  function current() {
    return library.themes.find(theme => theme.id === library.selected);
  }

  function choose(theme) {
    choice = theme;
    paint(theme);
    save.disabled = saving;
  }

  function draw(selectedId) {
    cards.replaceChildren();
    for (const theme of themes) {
      const label = document.createElement("label");
      label.className = "theme-card";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "launcher-theme";
      radio.value = theme.id;
      radio.checked = theme.id === selectedId;
      radio.setAttribute("aria-label", theme.name);
      radio.addEventListener("change", () => {
        revision++;
        choose(theme);
      });
      const sample = document.createElement("span");
      sample.className = "theme-sample";
      const url = artwork(theme.id);
      if (url) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = url;
        sample.append(image);
      } else {
        sample.classList.add("custom-sample");
        sample.style.setProperty("--sample-bg", theme.variables["--bg"]);
        sample.style.setProperty("--sample-accent", theme.variables["--accent"]);
      }
      const name = document.createElement("span");
      name.className = "theme-name";
      name.textContent = theme.name;
      label.append(radio, sample, name);
      cards.append(label);
    }
  }

  button.addEventListener("click", () => {
    if (!library || dialog.open) return;
    themes = [...library.themes];
    choice = current();
    importedText = undefined;
    file.value = "";
    error.textContent = "";
    draw(choice.id);
    dialog.showModal();
    cards.querySelector(":checked").focus();
  });

  file.addEventListener("change", async () => {
    const selected = file.files[0];
    if (!selected) return;
    const request = ++revision;
    error.textContent = "";
    if (selected.size > 16384) {
      save.disabled = saving;
      error.textContent = "Choose a theme file up to 16 KiB.";
      file.value = "";
      return;
    }
    save.disabled = true;
    try {
      const text = await selected.text();
      const preview = await api.previewTheme(text);
      if (request !== revision || !dialog.open) return;
      if (preview.error) throw new Error();
      importedText = text;
      themes = [...library.themes.filter(theme => theme.id !== "custom"), preview];
      draw("custom");
      choose(preview);
      cards.querySelector(":checked").focus();
    } catch {
      if (request === revision) error.textContent = "Couldn’t read that theme. Choose a valid Your Space theme JSON file.";
    } finally {
      if (request === revision) save.disabled = saving;
      file.value = "";
    }
  });

  byId("theme-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    revision++;
    paint(current());
  });
  byId("theme-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || save.disabled) return;
    saving = true;
    byId("theme-controls").disabled = true;
    error.textContent = "";
    try {
      const result = await api.saveTheme({ id: choice.id, text: choice.id === "custom" ? importedText : undefined });
      if (result.error) throw new Error();
      library = result;
      dialog.close();
    } catch {
      error.textContent = "Couldn’t save this theme on your Mac. Try again.";
    } finally {
      saving = false;
      byId("theme-controls").disabled = false;
    }
  });

  api.appearance().then(result => {
    library = result;
    paint(current());
    button.disabled = false;
  }).catch(() => {
    button.title = "Launcher appearance could not be loaded.";
  });
})();
