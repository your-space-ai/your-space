# 013 · Redesign the workspace

The dashboard gets a new structure and a component kit that every theme can restyle. Themes gain a light and a dark palette and a component style, and the dashboard ships three built-in themes: Cerulean, Cinder and Fern. Owners keep making, importing and sharing their own. This supersedes the presentation parts of [010](../010-personal-themes/spec.md) and the view behavior of [012](../012-multi-app-layouts/spec.md); their storage, sharing and permission rules still apply.

## Owner journey

1. **First run.** After the owner account exists, pick a theme (Cerulean, Cinder or Fern, each previewed in light and dark), then add a first app from a link to a kit or from the kit directory, or skip.
2. **Sign in.** A large greeting with the workspace name, and the username, password and **Sign in** on one row.
3. **Home.** The built-in Home is a launcher: a greeting, a "needs you" strip that links to waiting approvals, and every installed app as a tile with its status. Home settings offers two more layouts: the launcher with saved views and recent agent activity, and a quiet launcher of large icons. A custom Home app still replaces the built-in Home when chosen. (2026-11-23: custom Home apps are deferred until after the alpha, [decision](../../docs/architecture/decisions.md#creator-workflow-deferred).)
4. **Sidebar.** Home, Apps, Approvals, Agents, pinned saved views, installed apps and Settings, grouped with icons and status. The sidebar collapses to an icon rail and back.
5. **Tabs.** Home is the first tab. Opening an app from the sidebar or Home adds a tab for it, or focuses its existing tab. Close any tab except Home.
6. **Views.** Merge open app tabs into one view tab. The view lays its apps out by count (two side by side, three as a main app with two beside it, four in a grid). Drag a pane by its title bar to swap it with another or onto an edge drop zone of another pane, and drag dividers to resize. Each pane's title bar has a menu: Reload, Make main, Move, Pop out to its own tab, Details and Close in view. A view is temporary until the owner chooses **Save view** and names it. Pinned saved views appear in the sidebar. An **All views** page lists every saved view.
7. **Apps.** A list of installed apps with status, beside the selected app's details: update notice, version, address, agent access, internet access requests, and Open, Restart and Remove. **Install** sits at the top of the list.
8. **Approvals.** One queue of agent actions waiting for the owner, each showing the agent, app, action, change type, time and scope, with **Approve** and **Deny**. Waiting and Decided tabs. Access requests are not in this queue: an app's internet access requests appear on its Apps details and an agent's request for more access appears on its Agents details, each flagged with a count.
9. **Agents.** A list of agents beside the selected agent's tabs: App access (role per app and which changes need approval), Keys and Activity. **New agent** sits at the top.
10. **Settings.** A section list: Account, Appearance, Home and Engine. GitHub and Repositories left with the GitHub connection and managed repositories (2026-11-23, [decision](../../docs/architecture/decisions.md#creator-workflow-deferred)). Engine shows each app's memory and processor use as bars. Appearance offers a mode (Match my device, Light, Dark), the three built-in themes, and the owner's own themes with New theme and Import.

## Themes

- A version 2 theme file holds a name, a style (`crisp`, `soft` or `bold`), a heading, body and monospace font, and a light and a dark palette. Each palette has ten colors: background, panel, text, muted text, accent, text on accent, border, danger, success and warning.
- The style sets component shape and adds no colors of its own: Crisp uses hairline borders and small corners, Soft uses larger corners and tints surfaces with the palette's accent, and Bold uses heavy rules and square corners. Every component reads its colors, fonts and shape from the active theme and mode, so an owner's theme restyles the whole dashboard.
- The workspace stores the selected theme and mode. **Match my device** follows the browser's color scheme preference.
- The built-in themes are Cerulean (blue, Bold, Instrument Sans), Cinder (orange, Crisp, Space Grotesk headings) and Fern (green, Soft, Fraunces headings). Their fonts and IBM Plex Mono ship with the dashboard under the SIL Open Font License, so no theme loads remote fonts.
- Version 1 files still import: their single palette applies in both modes and they use the Crisp style. Workspaces using Canopy, Tide or Ember keep that theme as their own copy. (Superseded 2026-11-23: themes have one format. Version 1 files don't import, and a workspace's version 1 themes and starter choice don't carry over, so it starts on Cerulean; [decision](../../docs/architecture/decisions.md#portable-workspace-appearance).)

## Voice

Copy follows the good-neighbor voice: welcoming, plain-spoken and specific. Errors say what happened, when and what to do next. Approval prompts name the agent, the action, the app and the limit of its access.

## Acceptance

- Each built-in theme meets a 4.5:1 contrast ratio for ordinary text and primary button labels in light and dark. Verify every screen in all three themes and both modes. (2026-11-23: this also covered an imported version 1 theme; version 1 files no longer import, so verify that one is refused.)
- Switch mode between Match my device, Light and Dark, and verify the setting persists across browsers for the workspace.
- Import, export and re-import a version 2 theme. Reject malformed, oversized and unknown-version files without changing the current theme.
- Open three apps as tabs, merge them into a view, swap two panes, drag one to an edge, resize a divider and use each pane menu action with pointer and keyboard. Save, pin, unpin and delete a view, and reopen it from the sidebar and from All views. App documents stay open while panes move and resize.
- Approve and deny actions from the Approvals queue and from Home's link to it. Verify access requests appear only on the related app or agent.
- Collapse and expand the sidebar. Check narrow and wide screens and keyboard-only use of every screen.
- Keep app workflows, grants, approvals and credentials independent of appearance, as in 010.

## Delivery

Separate pull requests, each with its tests and docs: theme format version 2 and the built-in themes; the component kit; the shell with tabs; views; Home; Apps; Agents and Approvals; Settings and Appearance; sign-in and first run; and a copy pass in the new voice. Moving owner creation into the first-run screen and agents requesting more access are separate features that need their own specifications.

**Alpha scope (2026-11-23).** The first alpha ships with only the first of these, theme format version 2 and the built-in themes. The rest, from the component kit through the copy pass, is parked for alpha.2, and this journey keeps its acceptance for then ([decision](../../docs/architecture/decisions.md#personal-dashboard-release-boundary)).
