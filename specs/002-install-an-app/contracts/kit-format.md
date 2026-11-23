# Installation Kit Format

A kit is a YAML file in an optional operator-configured directory at `apps/<owner>/<repo>.yaml`, or anywhere on GitHub when
the owner gives its link, or a file on this machine given to `install-app --kit`, such as one from a
private kits repository. It refers to the app's own file and never copies it. A kit can also go with
a Compose file given on this machine (`install-app --compose <file> --kit <file>`); giving both in
one command is what binds them.

```yaml
kit: 1                        # format version
source:
  repo: we-promise/sure       # the app's repository
  path: compose.example.yml   # the file this kit fits
name: sure                    # the app's short name and address
title: Sure
interface:
  service: web
  port: 3000
pane: true                    # false: opens in its own tab
generate:                     # values Your Space generates; the published default is never used
  SECRET_KEY_BASE: { bytes: 64, encoding: hex }
  POSTGRES_PASSWORD: {}       # default: 32 bytes, base64url
derive:                       # values Your Space works out
  APP_URL: app_origin         # the app's own address, e.g. http://sure.space.localhost
  DATABASE_URL:               # built from other settings, so a generated password reaches it
    template: "postgresql://sure:${POSTGRES_PASSWORD}@db/sure"
set:                          # values from the app's own example settings; the owner can change them
  STORAGE_TYPE: local
required: [ADMIN_EMAIL]       # settings the owner gives; the install needs a value for each
secrets: [OPENAI_ACCESS_TOKEN]  # settings shown only as set or not set
outbound:                     # starter hosts, approved when the install is confirmed
  - api.openai.com
limits:
  web: { memory: 1536M, cpus: 1 }
```

A `derive` value is `app_origin`, `app_host`, or `{ template: ... }`. A template is text with
`${NAME}` placeholders, each naming a setting the kit generates, sets, requires, or derives from
the app's address; a template can't use another template. Your Space fills it whenever it starts the app, so
when the owner changes a setting it uses, the template follows. The owner can't change a template
setting directly, and it is shown only as set when any setting it uses is secret. Values are
inserted as they are: generated values are hex or base64url and safe in URLs, while a value the
owner types is not encoded. Use a template when the app's file reads one setting that contains
another, such as a database URL with a password the kit generates.

**How settings reach the app.** An app's settings are the variables its file reads and every
setting its kit names: in `generate`, `derive`, `set`, `required` or `secrets`. Your Space keeps them,
encrypted, and gives them to Compose as its environment whenever it checks or starts the app; it
writes no settings file. They reach the app two ways:

- Through the file's own placeholders, such as `SECRET_KEY_BASE: ${SECRET_KEY_BASE}`.
- A service whose `env_file` names only `.env`, the file next to the Compose file where self-hosted
  apps keep their settings, gets every setting that has a value as its environment, in place of that
  file. The `environment` its file sets wins over them, as it does over `.env`. Its kit names the
  settings `.env` would hold, since the file doesn't. The review reports the change.

Compose reads no settings or label file an app's file names: any other `env_file`, such as
`/etc/passwd`, `../x`, `config/app.env` or a second file next to `.env`, and any `label_file`, is
refused. A `required` setting has no value until the owner gives one in the review; like a setting
the file requires with `${NAME:?…}`, the install needs it, and later it can be changed but not
cleared. A `secrets` setting with no other source is one the owner may give. An optional setting
the owner may give that isn't secret is a `set` value, which can be empty. `required` can't name a
setting the kit generates or derives.

Every field except `kit` and `source` is optional. A kit given with a Compose file on this machine
may leave out `source`, and its `source` isn't matched; a kit without `source` fits no file on
GitHub. Unknown fields are refused, so a kit written for a
newer format doesn't half-apply. A kit can't change the Docker adapter's rules: it can only name
settings, values, hosts, limits and the interface.
