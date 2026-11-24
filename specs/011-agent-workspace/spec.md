# 011 · Have my agent set up a personal workspace and build its Home

**Outcome.** One person can ask an agent to install Your Space, create a dashboard that reads selected apps, keep its source on GitHub and deploy a reviewed change to the same installation. The workspace runs independently of the agent and the dashboard code remains portable.

**Deferred in part (2026-11-23).** Making a Home app, managed repositories with the GitHub connection, and deploying a customization are out of the alpha and deferred until after it ([decision](../../docs/architecture/decisions.md#creator-workflow-deferred)). Those rows keep their acceptance for when the work returns. Setup from a shell and installing from a kit stay; a kit in a private repository installs with the server command, `install-app --kit -`.

| Owner journey | Acceptance |
| --- | --- |
| Set up from a shell | One documented setup command checks Docker, provisions the workspace and provides a private owner handoff. Retrying a partial setup reuses its data and keeps credentials out of logs. |
| Make a Home app | **Deferred (2026-11-23).** Scaffold an app, edit it, pack and install it. Choose it as Home, allow one other app's read role and render its data. Unavailable or revoked reads fail. Built-in Home and settings stay reachable. |
| Manage app repositories | **Deferred (2026-11-23).** Connect GitHub with public or private access. Create and import repos. Grant a named agent access to selected repos and optional creation and fork rights. Commit through the gateway with the current file SHA. |
| Install from a kit | Paste a GitHub kit link, or pick an entry from an optional operator-configured directory. Review pinned source, image and app settings before installation. Private repositories use owner-authorized access. Since 2026-11-23 every install starts from a kit: in the web client, its link or a directory entry; the server command also takes a kit file ([Kits define apps](../../docs/architecture/decisions.md#kits-define-apps)). Owner-authorized access to private repositories is deferred with the GitHub connection (2026-11-23): the web client and the directory read public GitHub, and a kit in a private repository is given to the server command as a file. |
| Deploy a customization | **Deferred (2026-11-23).** The owner confirms the exact commit and image set. A compatible update retains the installation and data volumes, retires old app credentials and grants, and recovers the previous artifacts on startup failure. |

The general app SDK, building arbitrary Dockerfiles on the installation host, backup-based data rollback, automatic upstream updates and multi-catalog publishing remain later work. A packed static app and an ordinary app with a published image both use the existing Compose runtime.

[Operator setup](../../docs/install/agent-setup.md) · [Kits](../../docs/apps/install-apps.md)
