# Installation Kit Format

A kit is a YAML file in the kits repository at `apps/<owner>/<repo>.yaml`, or anywhere on GitHub when
the owner gives its link. It refers to the app's own file and never copies it.

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
set:                          # values from the app's own example settings; the owner can change them
  STORAGE_TYPE: local
secrets: [OPENAI_ACCESS_TOKEN]  # settings shown only as set or not set
outbound:                     # starter hosts, approved when the install is confirmed
  - api.openai.com
limits:
  web: { memory: 1536M, cpus: 1 }
```

Every field except `kit` and `source` is optional. Unknown fields are refused, so a kit written for a
newer format doesn't half-apply. A kit can't change the Docker adapter's rules: it can only name
values, hosts, limits and the interface.
