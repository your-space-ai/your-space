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
secrets: [OPENAI_ACCESS_TOKEN]  # settings shown only as set or not set
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
may leave out `source`, and its `source` isn't matched; a kit without `source` fits no file on
GitHub. Unknown fields are refused, so a kit written for a
newer format doesn't half-apply. A kit can't change the Docker adapter's rules: it can only name
values, hosts, limits and the interface.
