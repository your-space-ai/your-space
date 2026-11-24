# 012 · Arrange apps and return to a saved view

An owner who works in several installed apps can put them on one screen and return to the same arrangement from the sidebar. A short-lived arrangement can also be opened from its URL.

**Alpha scope (2026-11-23).** The layout preset choice, **Copy layout link** with its `layout` and `sizes` parameters, the divider sizes the browser remembered, and reordering sidebar shortcuts (step 5's first sentence) are out of the alpha. Apps opened together are laid out by count: two side by side, three as a main app with two beside it, four or more in a grid. A saved view keeps and restores its layout and sizes, and `with` still opens apps together. Journey 013's views replace the rest when they come. [Decision](../../docs/architecture/decisions.md#alpha-scope)

## Owner journey

1. Open an installed app. Add companion apps and choose columns, rows, a grid, or a main app with companions. The first app occupies the main area in the last preset.
2. Drag each interior divider with a mouse or touch. Focus a divider and use the arrow keys to resize it. The dashboard keeps existing app documents open as panes change size or move between presets.
3. Save the current arrangement under a name. Its sidebar link restores the app order, preset and proportions in another signed-in browser for the workspace. After editing, use **Update view** to replace the saved arrangement or **Save as new view** to keep both. Rename or delete a view from the sidebar.
4. Copy the layout link to share the current composition. The recipient needs access to this workspace and the apps. A URL carries app names, the layout and proportions. Each pane uses the existing installed app record to find its destination.
5. Reorder installed app shortcuts in the sidebar. On a narrow screen, choose which app to show from the open view. Choosing another app preserves the current documents and the wide-screen proportions.

## Behavior and boundaries

- A layout contains one to twelve distinct installed apps with web interfaces. Columns and rows have one track per app. A grid fills rows from left to right, with the last cell spanning any remaining tracks. The main preset gives the first app the left side and stacks its companions on the right.
- The existing `/open/<app>?with=<second-app>` link opens two columns. An explicit composition link carries a comma-separated `with` list and the `layout` and `sizes` parameters. A saved view points to an opaque server-issued ID. The owner may edit or share its current composition independently of that ID.
- The owner’s server stores named views and shortcut order. Each view has its own revision. Concurrent writes to the same revision show a conflict. A browser keeps the most recent divider choices per owner, workspace, preset and ordered app list. Explicit URLs and saved views take precedence.
- App origins, credentials and cookies follow the existing pane and publishing contracts. A shared link cannot supply an iframe URL or open an uninstalled service. A published app still requires current framing readiness. Link-only apps retain their separate-tab fallback. Workspace themes apply to the controls around the apps.
- Unavailable apps are skipped with a notice. When no selected app is available, the owner can return to Apps. Removing an app from a layout affects only that view. Sidebar shortcut order is independent of pane order.

## Acceptance

- Add and remove apps in all four presets. Verify all interior boundaries move using pointer and keyboard input. Drag through a cross-origin app and confirm that interacting with its contents works after release.
- Enter an unsaved value in an app. Resize, switch presets, add a companion and choose another app on a phone-sized viewport. On returning to the original pane, its value is still present.
- Save two named views with different app sets, arrangements and divider sizes. Refresh, then switch from the first to the second and back using one sidebar click each time. Verify the app order and each saved axis. Update, rename and delete one view, verify a stale change fails and confirm the other view survives. Open a composition URL independently of the saved record.
- Move installed shortcuts with a pointer and keyboard controls. Check their order after reload and ensure newly installed or removed apps are reflected.
- Verify the owner API rejects unauthenticated requests, untrusted mutation origins, invalid layouts and unknown app names. Verify an unavailable published frame retains its external link or readiness message.
