# Mac preview verification

Private preview 0.1.0, November 21, 2026. The desktop and bundled CLI were built from [PR 68](https://github.com/your-space-ai/your-space/pull/68). Release qualification tracks an exact distribution separately in the [readiness checklist](../../docs/public-release-readiness.md).

| Path | What ran | Observed result |
| --- | --- | --- |
| Native Mac launch | Apple Silicon, macOS 27.2.1. Extracted the preview zip, checked the app signature and bundled CLI, then opened the app through LaunchServices with a fresh profile. | The launcher appeared. Connecting to a loopback test workspace opened its dashboard and an app window. Relaunch restored the saved workspace. |
| Install from disk images | Built private Apple Silicon and Intel DMGs. In Finder, followed each image’s Applications shortcut and copied Your Space to the system Applications folder. Ejected the image and launched the installed bundle with a fresh profile. | Both copies passed strict signature verification, opened the test workspace and reopened its saved address. The Intel executable ran through Rosetta on Apple Silicon. The automated drag gesture did not complete the copy, so the literal drop remains a manual release check. |
| Automated install checks | Mounted each image read-only, checked the Applications shortcut, copied into an isolated Applications folder and ejected before launch. Checked the platform of both executables, the app seal and the bundled install-file checksums. Also tested an image with a misdirected shortcut. | Both architectures passed installation and relaunch. The test rejected and unmounted the image with the wrong shortcut. |
| Existing HTTPS server | Selected a running Your Space instance in a fresh native profile with the Mac Docker daemon stopped. | The normal sign-in page loaded over trusted TLS. No owner credentials were entered. |
| New local installation | Used the desktop setup service with its real CLI and matching locally built images on disposable ARM64 Linux with rootless Docker 29.6.2 and Compose 5.2.0. | The service selected the local engine, started the stack, created a synthetic owner and resumed the same claimed installation from a fresh process. |
| Install and open a kit | Connected the packaged Mac app to that disposable workspace through a loopback forward. Used the Journey 002 fixture source and a real container. | A synthetic owner signed in, reviewed the pinned kit, confirmed installation, saw the successful server job and opened the running app in its pane. The workspace and installed app had no native launcher bridge. |

The first ad-hoc preview failed during launch because macOS rejected the Electron framework signature. The corrected preview signs nested code consistently and passed both strict signature verification and a real launch. Public builds require Developer ID, hardened runtime, Apple notarization, a stapled ticket and Gatekeeper assessment.

Still open for public release are a clean same-Mac Docker install from published images, installation of the exact downloaded and notarized Apple Silicon and Intel DMGs on clean Macs, and repetition of both kit journeys on that candidate.
