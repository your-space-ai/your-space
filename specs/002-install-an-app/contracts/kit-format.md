# Installation Kit Format

A kit is an app's complete definition in Your Space: what installs it and how it is shown
([Kits define apps](../../../docs/architecture/decisions.md#kits-define-apps)). Every installed app
has one, and Your Space installs only from a kit. A kit is a YAML file anywhere on GitHub, in the
app's repository or apart from it, installed from its link, wherever that link was found, or a
file on this machine given to `install-app --kit`, such as one from a private kits repository.
(Superseded 2026-11-23: a kit could also be listed in an optional operator-configured directory at
`apps/<owner>/<repo>.yaml`, set with `YS_KITS_REPOSITORY`; the directory left with the
[alpha scope](../../../docs/architecture/decisions.md#alpha-scope).) It refers to the app's own Compose
file and never copies it. (Superseded 2026-11-23: a kit could also go with a Compose file given on
this machine, `install-app --compose <file> --kit <file>`. That left the alpha; see the
[alpha scope](../../../docs/architecture/decisions.md#alpha-scope), as did `install-app --files-stdin`
with journey 011's creator features. Such a kit could leave out `source`.)

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
env:                          # the app's whole environment: each variable, and where its value comes from
  SECRET_KEY_BASE: { generate: { bytes: 64, encoding: hex } }  # generated once, never shown
  POSTGRES_PASSWORD: { generate: true }                         # 32 bytes, base64url
  APP_URL: { derive: app_origin }   # the app's own address, e.g. http://finance.space.localhost
  DATABASE_URL:                     # built from other variables, so a generated password reaches it
    derive: { template: "postgresql://finance:${POSTGRES_PASSWORD}@db/finance" }
  OWNER_KEY: { ask: true }          # the owner gives it in the review; the install needs it
  ADMIN_EMAIL: { ask: true, secret: false }
  OPENAI_API_KEY: { ask: optional } # the owner may give it, now or later
  STORAGE_TYPE: local               # a value; the owner can change it
outbound:                     # starter hosts, approved when the install is confirmed
  - api.openai.com
limits:
  web: { memory: 1536M, cpus: 1 }
knowledge: { path: /knowledge }  # asks for knowledge bases; path is optional
```

**The environment** (decision 2026-11-23). `env` is the app's whole environment: every variable
Your Space gives the app, each with a value or with where its value comes from. Your Space gives
exactly this map to the app's Compose file, for every `${VARIABLE}` in it, and to every service that
loads it with `env_file: .env` (or `./.env`), the file next to the Compose file where self-hosted apps
keep their settings. Nothing else in the file becomes a setting, and no variable's name makes it
secret. Each entry is one of:

- **A value**, such as `info`, `2` or `false`, kept as text. It is shown, and the owner can change it.
  An empty value is no value, as one the owner clears is: Your Space doesn't give the app the
  variable, so the file's default applies.
- **`{ generate: ... }`**, a random value generated when the app is installed: `true` for 32 bytes in
  base64url, or `{ bytes, encoding }` with 16 to 128 bytes and `hex` or `base64url`. It is secret,
  shown only as set.
- **`{ derive: ... }`**, a value Your Space works out: `app_origin`, the app's address, such as
  `http://finance.space.localhost` or the link the owner publishes it at; `app_host`, its host name;
  or `{ template: ... }`. The owner can't change it.
- **`{ ask: true }`**, a value the owner gives in the review, which the install needs and which can
  later be replaced but not cleared, or **`{ ask: optional }`**, one the owner may give, now or later.
  It is secret unless the entry adds `secret: false`.

A template is text with `${NAME}` placeholders, each naming another variable in `env` that isn't a
template. Your Space fills it whenever it starts the app, so when the owner changes a value it uses,
the template follows. It is shown only as set when any variable it uses is secret. Values are
inserted as they are: generated values are hex or base64url and safe in URLs, while a value the
owner types is not encoded. Use a template when the app's file reads one variable that contains
another, such as a database URL with a password the kit generates.

A variable the Compose file reads with no default, as `${NAME}` or `$NAME`, or requires, as
`${NAME:?message}` or `${NAME?message}`, must be in `env`, even one that only a service left out with its profile uses; the review refuses
the app until it is, with `The kit doesn't define NAME`. One with a default, such as `${NAME:-}` or `${NAME:-info}`, gets
the default unless `env` defines it. A variable the file requires is required in the review even
when the kit marks it `ask: optional`. A service whose `env_file` names any other file, and any
`label_file`, is refused: Compose reads no file an app's file names. So is a Compose file that
includes others (`include`) or extends a service in another file (`extends` with `file`), before
Compose sees it: an app is one Compose file, and `extends` within it still works. The `environment` a `.env`
service's file sets itself wins over `env`, as it does over `.env`. Your Space writes no settings
file: the values stay encrypted in its database and reach Compose only as its environment.

`env` replaced four fields on 2026-11-23: `generate`, `derive` and `set`, whose entries are now
`env` entries, and `secrets`, whose names are now `{ ask: optional }`. A kit with any of them is
refused with a message that names `env`. Apps installed before keep their settings: Your Space reads
their stored kits' fields as `env`. Older Your Space versions refuse a kit with `env` as an unknown
field, so the change needs no new format version; `kit: 1` and `kit: 2` both take it.

**Knowledge** (journey 014, decision 2026-11-25). `knowledge` asks for the owner's knowledge bases,
folders of files that belong to Your Space, not to any app. The owner picks them in the review and on
the app's page, and Your Space mounts each in the interface service at `<path>/<name>`, read-write,
one folder per knowledge base even when there is only one; the app finds them by listing `<path>`.
`path` is optional and defaults to `/knowledge`. It is an absolute path in the app's container, isn't
`/`, names no `..`, and isn't in `/proc`, `/sys` or `/dev`, or at or under `/etc/resolv.conf`,
`/etc/hosts` or `/etc/hostname`, the files Docker mounts in every container. It is at most 8
folders deep, and each folder is 1 to 64 letters, digits, dots, dashes and underscores, starting
with a letter, digit or underscore, so `/a/b/c/d/e/f/g/h/i` and `/-vault` are refused. Your Space keeps it normalised, so
`/data/vault/` is `/data/vault`. `knowledge: {}` asks for the default path. A kit with `knowledge` needs an
`interface`, any other field in `knowledge` is refused, and so is a Compose file whose interface
service mounts anything of its own at or inside the path. The path itself holds only the knowledge
bases' folders and isn't storage: what an app writes there beside them is in the container's own
files, lost when it is recreated, so a kit whose app keeps files at that folder's root puts the path
inside one of the app's volumes. A kit without `knowledge` gets no mounts
and can't be given knowledge bases. Older Your Space versions refuse `knowledge` as an unknown field,
so the change needs no new format version; `kit: 1` and `kit: 2` both take it. An app that writes
into knowledge bases should run as user 1000, or give group 1000, which the knowledge base gives
the files and folders it makes there, read and write on files and read, write and search on folders
(decision 2026-11-26). A umask of 002 keeps those for files and folders the app makes with the
usual modes; it can't add them to a mode the app sets itself, like `0700`, so such an app must ask
for them. The sync with Google Drive runs as user 1000, and can't change files or write into
folders that only another user can write, so that sync fails with a permission error and is
retried; changes it made before the error, deletions included, stay made.

Every field except `kit` and `source` is optional. A kit given with a Compose file on this machine
may leave out `source`, and its `source` isn't matched. Any other kit without `source` is refused, as
is a `source` without `repo`, `path` or `commit`, or with a commit that isn't a full 40-character
one, such as a branch, a tag or a short commit; the message names the missing field. This holds for
`kit: 1` and `kit: 2` alike: a kit written before kits pinned their Compose file is refused until it
adds `source.commit`. Unknown fields are refused, in `source` too, so a kit written for a newer
format doesn't half-apply. A Compose file given where a kit belongs is refused with a message that
explains kits. A kit can't change the Docker adapter's rules: it can only name the app's environment,
hosts, limits and the interface.
