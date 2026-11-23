import { useState, type ReactNode } from "react";
import { builtInThemes } from "../../../shared/appearance/theme.mjs";
import {
  AppIcon, AppTile, Button, ConfirmDialog, CountBadge, Dialog, EmptyState, Icon, IconButton, iconNames, ListDetail, Menu,
  Notice, Panel, SectionHeader, SelectField, SelectList, StatusDot, StatusPill, Tabs, TextField, Toggle, useToast, type Tone,
} from "../ui/index.ts";

const apps: { id: string; name: string; meta: string; tone: Tone; status: string }[] = [
  { id: "calendar", name: "Calendar", meta: "Version 2.1", tone: "success", status: "Running" },
  { id: "notes", name: "Notes", meta: "Update ready", tone: "warning", status: "Needs you" },
  { id: "task-board", name: "Task board", meta: "Version 0.9", tone: "info", status: "Starting" },
  { id: "photos", name: "Photos", meta: "Version 3.0", tone: "neutral", status: "Stopped" },
  { id: "recipes", name: "Recipes", meta: "Version 1.2", tone: "danger", status: "Failed" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gallery-section" aria-labelledby={id} data-gallery={id}>
      <SectionHeader id={id} title={title} level={2} />
      {children}
    </section>
  );
}

export function Gallery({ themeId, scheme }: { themeId: string; scheme: "light" | "dark" }) {
  const [tab, setTab] = useState("access");
  const [selected, setSelected] = useState("calendar");
  const [dialog, setDialog] = useState<"save" | "remove" | null>(null);
  const [internet, setInternet] = useState(true);
  const [updates, setUpdates] = useState(false);
  const toast = useToast();
  const app = apps.find((item) => item.id === selected)!;

  return (
    <main className="gallery">
      <SectionHeader
        level={1}
        title="Component kit"
        description="Every component in one theme and palette. Each reads its colors, fonts and shape from the theme."
        actions={
          <nav className="gallery-themes" aria-label="Themes">
            {builtInThemes.map(({ id, theme }) => (["light", "dark"] as const).map((mode) => (
              <a key={id + mode} href={`?theme=${id}&scheme=${mode}`} aria-current={id === themeId && mode === scheme ? "page" : undefined}>
                {theme.name} {mode}
              </a>
            )))}
          </nav>
        }
      />

      <Section id="buttons" title="Buttons">
        <div className="gallery-row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <div className="gallery-row">
          <Button icon="plus">Install</Button>
          <Button variant="secondary" icon="reload">Restart</Button>
          <Button variant="quiet" icon="external">Open in its own tab</Button>
          <Button variant="danger" icon="close">Remove app</Button>
        </div>
        <div className="gallery-row">
          <Button size="small">Small</Button>
          <Button size="small" variant="secondary">Small</Button>
          <Button size="small" variant="quiet">Small</Button>
          <Button size="small" variant="danger">Small</Button>
          <IconButton icon="more" label="More actions" />
          <IconButton icon="sidebar" label="Collapse the sidebar" />
          <IconButton icon="reload" label="Reload" variant="secondary" />
          <IconButton icon="close" label="Close" size="small" />
        </div>
        <div className="gallery-row">
          <Button disabled>Disabled</Button>
          <Button variant="secondary" disabled>Disabled</Button>
          <Button variant="quiet" disabled>Disabled</Button>
          <Button variant="danger" disabled>Disabled</Button>
        </div>
      </Section>

      <Section id="fields" title="Inputs, selects and switches">
        <div className="gallery-columns">
          <TextField label="Workspace name" hint="Shown when you sign in." defaultValue="Home lab" />
          <TextField label="Username" error="Use 3 to 32 letters, numbers or dashes." defaultValue="a" />
          <TextField label="Address" placeholder="https://example.com/kit" />
          <TextField label="Version" defaultValue="2.1.0" disabled />
          <SelectField label="Role" hint="What the agent may do in this app." defaultValue="editor">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </SelectField>
          <div className="gallery-stack">
            <Toggle label="Internet access" hint="The app can reach the hosts you allow." checked={internet} onChange={(event) => setInternet(event.target.checked)} />
            <Toggle label="Update automatically" checked={updates} onChange={(event) => setUpdates(event.target.checked)} />
            <Toggle label="Share with agents" disabled />
          </div>
        </div>
      </Section>

      <Section id="status" title="Status">
        <div className="gallery-row">
          {apps.map((item) => <StatusPill key={item.id} tone={item.tone}>{item.status}</StatusPill>)}
        </div>
        <div className="gallery-row">
          {apps.map((item) => <StatusDot key={item.id} tone={item.tone} label={item.status} />)}
          <span className="gallery-inline">Waiting <CountBadge count={3} label="approvals" /></span>
        </div>
      </Section>

      <Section id="panels" title="Panels and section headers">
        <div className="gallery-columns">
          <Panel title="Status" actions={<><Button size="small" variant="secondary" icon="reload">Restart</Button><Menu label="Status actions" items={[{ label: "Details", onSelect: () => {} }]} /></>}>
            <p>Calendar is running. It started 2 hours ago.</p>
            <p className="gallery-muted">Memory 180 MB of 512 MB</p>
          </Panel>
          <Panel as="div" aria-label="Untitled panel">
            <SectionHeader level={3} title="Section header" description="A heading with a description and actions." actions={<Button size="small" variant="quiet">Edit</Button>} />
            <p>Panels group related content. A panel with a title is named by it.</p>
          </Panel>
        </div>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs
          label="Agent details"
          value={tab}
          onChange={setTab}
          items={[
            { id: "access", label: "App access", panel: <p>Calendar: Editor. Changes to events need your approval.</p> },
            { id: "keys", label: "Keys", count: 2, panel: <p>Two keys. The newest was issued today.</p> },
            { id: "activity", label: "Activity", panel: <p>No calls in the last day.</p> },
          ]}
        />
      </Section>

      <Section id="overlays" title="Menus, dialogs and toasts">
        <div className="gallery-row">
          <span className="gallery-inline">Pane menu <Menu label="Calendar actions" items={[
            { label: "Reload", icon: "reload", onSelect: () => toast({ message: "Calendar reloaded." }) },
            { label: "Make main", onSelect: () => {} },
            { label: "Move", onSelect: () => {}, disabled: true },
            { label: "Pop out to its own tab", icon: "external", onSelect: () => {} },
            { label: "Details", icon: "info", onSelect: () => {} },
            "separator",
            { label: "Close in view", icon: "close", onSelect: () => {} },
            { label: "Remove app", danger: true, onSelect: () => setDialog("remove") },
          ]} /></span>
          <Button variant="secondary" onClick={() => setDialog("save")}>Save view…</Button>
          <Button variant="secondary" onClick={() => setDialog("remove")}>Remove app…</Button>
          <Button variant="secondary" onClick={() => {
            toast({ tone: "success", message: "View saved as Morning.", duration: Infinity });
            toast({ message: "Calendar has an update.", action: { label: "Update", onSelect: () => {} }, duration: Infinity });
            toast({ tone: "danger", message: "Couldn't restart Recipes. Try again.", duration: Infinity });
          }}>Show toasts</Button>
        </div>
        <Dialog
          open={dialog === "save"}
          onClose={() => setDialog(null)}
          title="Save this view"
          description="A saved view keeps its apps and layout. Pin it to see it in the sidebar."
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => setDialog(null)}>Save view</Button></>}
        >
          <div className="gallery-stack">
            <TextField label="View name" defaultValue="Morning" data-autofocus />
            <Toggle label="Pin to the sidebar" defaultChecked />
          </div>
        </Dialog>
        <ConfirmDialog
          open={dialog === "remove"}
          title="Remove Recipes?"
          body="Its containers stop and are removed. Its data is kept, so you can install it again with its data."
          confirmLabel="Remove app"
          onConfirm={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        />
      </Section>

      <Section id="notices" title="Notices">
        <div className="gallery-stack">
          <Notice title="An update is ready" action={<Button size="small" variant="secondary">Update</Button>}>Calendar 2.2 fixes reminders that arrived late.</Notice>
          <Notice tone="success">Calendar is running.</Notice>
          <Notice tone="warning" title="Notes asks to reach notes-sync.example">Allow it on the app's details to let it sync.</Notice>
          <Notice tone="danger" title="Recipes stopped at 9:41">It ran out of memory. Raise its memory limit, then restart it.</Notice>
        </div>
      </Section>

      <Section id="empty" title="Empty state">
        <EmptyState icon="views" title="No saved views yet" action={<Button icon="plus">Open apps</Button>}>
          Open two or more apps as tabs, merge them into a view, then save it.
        </EmptyState>
      </Section>

      <Section id="apps" title="App icons and tiles">
        <div className="gallery-row">
          <AppIcon name="Calendar" size="small" />
          <AppIcon name="Calendar" />
          <AppIcon name="Task board" size="large" />
        </div>
        <div className="gallery-tiles">
          {apps.map((item) => <AppTile key={item.id} href={`#${item.id}`} name={item.name} status={{ tone: item.tone, label: item.status }} />)}
        </div>
      </Section>

      <Section id="icons" title="Icons">
        <ul className="gallery-icons">
          {iconNames.map((name) => <li key={name}><Icon name={name} /><span>{name}</span></li>)}
        </ul>
      </Section>

      <Section id="list-detail" title="List and details">
        <ListDetail
          className="gallery-list-detail"
          label="Apps"
          actions={<Button size="small" icon="plus">Install</Button>}
          view="detail"
          onBack={() => {}}
          list={<SelectList label="Installed apps" value={selected} onChange={setSelected} items={apps.map((item) => ({
            id: item.id, title: item.name, meta: item.meta, icon: <AppIcon name={item.name} size="small" />,
            status: <StatusDot tone={item.tone} label={item.status} hideLabel />,
          }))} />}
          detail={
            <>
              <SectionHeader level={3} title={app.name} description={app.meta} actions={<><Button size="small">Open</Button><Button size="small" variant="secondary">Restart</Button><Menu label={`More actions for ${app.name}`} items={[{ label: "Remove", danger: true, onSelect: () => setDialog("remove") }]} /></>} />
              <dl className="gallery-details">
                <dt>Status</dt><dd><StatusPill tone={app.tone}>{app.status}</StatusPill></dd>
                <dt>Address</dt><dd><code>{app.id}.home.example</code></dd>
                <dt>Agent access</dt><dd>2 agents</dd>
              </dl>
            </>
          }
        />
      </Section>
    </main>
  );
}
