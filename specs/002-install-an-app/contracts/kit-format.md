# Installation Kit Format

A kit is an app's complete definition in Your Space: what installs it and how it is shown
([Kits define apps](../../../docs/architecture/decisions.md#kits-define-apps)). Every installed app
has one, and Your Space installs only from a kit. A kit is a YAML file anywhere on GitHub, in the
app's repository or apart from it, installed from its link, such as one listed in an optional
operator-configured directory at `apps/<owner>/<repo>.yaml`, or a file on this machine given to
`install-app --kit`, such as one from a private kits repository. It refers to the app's own Compose
file and never copies it. A kit can also go with a Compose file given on this machine
(`install-app --compose <file> --kit <file>`); giving both in one command is what binds them.

**Exact commits, no drift.** The kit pins the app's Compose file: `source.repo`, `source.path` and
`source.commit`, the full 40-character commit, are all required. Your Space reads the Compose file at
exactly `source.commit`, never at a branch's latest commit, and records it. A kit's link resolves to
the kit's commit when the owner reviews the install, even a link to a branch such as
`blob/main/kit.yaml`, and the review and the install use exactly that kit. A kit in the same
repository as its Compose file names an earlier commit than its own, since a file can't contain the
commit it is in: commit the Compose file, then the kit that names that commit. A newer kit, or a kit
that pins a newer Compose commit, reaches an installed app only when the owner chooses to install it;
nothing follows a branch by itself. Your Space doesn't yet show that a newer kit exists: offering it
as an update the owner chooses to install is on the [roadmap](../../../docs/roadmap.md). (The
exception for **Update installed app** in a repository the owner manages, journey 011, left with
managed repositories on 2026-11-23.)
Only a kit given with a Compose file on this machine leaves out `source`, since that file is the
app's Compose file.

```yaml
kit: 1                        # format version
source:                       # required, except with a Compose file on this machine
  repo: <owner>/<repo>        # the app's repository
  path: compose.yaml          # its Compose file
  commit: <40-character sha>  # the exact commit Your Space reads it at
name: finance                 # the app's short name and address
title: Finance
interface:
  service: web
  port: 3000
pane: true                    # false: opens in its own tab
generate:                     # values Your Space generates; the published default is never used
  SECRET_KEY_BASE: { bytes: 64, encoding: hex }
  POSTGRES_PASSWORD: {}       # default: 32 bytes, base64url
derive:                       # values Your Space works out
  APP_URL: app_origin         # the app's own address, e.g. http://finance.space.localhost
  DATABASE_URL:               # built from other settings, so a generated password reaches it
    template: "postgresql://finance:${POSTGRES_PASSWORD}@db/finance"
set:                          # values from the app's own example settings; the owner can change them
  STORAGE_TYPE: local
secrets: [OPENAI_API_KEY]     # settings shown only as set or not set
outbound:                     # starter hosts, approved when the install is confirmed
  - api.openai.com
limits:
  web: { memory: 1536M, cpus: 1 }
```

A `derive` value is `app_origin`, `app_host`, or `{ template: ... }`. A template is text with
`${NAME}` placeholders, each naming a setting the kit generates, sets, or derives from the app's
address; a template can't use another template. Your Space fills it whenever it starts the app, so
when the owner changes a setting it uses, the template follows. The owner can't change a template
setting directly, and it is shown only as set when any setting it uses is secret. Values are
inserted as they are: generated values are hex or base64url and safe in URLs, while a value the
owner types is not encoded. Use a template when the app's file reads one setting that contains
another, such as a database URL with a password the kit generates.

Every field except `kit` and `source` is optional. A kit given with a Compose file on this machine
may leave out `source`, and its `source` isn't matched. Any other kit without `source` is refused, as
is a `source` without `repo`, `path` or `commit`, or with a commit that isn't a full 40-character
one, such as a branch, a tag or a short commit; the message names the missing field. This holds for
`kit: 1` and `kit: 2` alike: a kit written before kits pinned their Compose file is refused until it
adds `source.commit`. Unknown fields are refused, in `source` too, so a kit written for a newer
format doesn't half-apply. A Compose file given where a kit belongs is refused with a message that
explains kits. A kit can't change the Docker adapter's rules: it can only name values, hosts, limits
and the interface.
