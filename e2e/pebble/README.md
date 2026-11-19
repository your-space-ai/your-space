# Pebble's test root

`pebble.minica.pem` is the public root certificate that signs the HTTPS certificate of
[Pebble](https://github.com/letsencrypt/pebble), Let's Encrypt's test certificate authority (MPL-2.0),
copied from `/test/certs/pebble.minica.pem` in its image. It is a published test certificate, not a
secret. The CLI's browser test (`e2e/tests/cli.spec.ts`) gives it to Caddy so Caddy trusts Pebble's
ACME endpoint; the certificates Pebble issues are only trusted inside that test.

The test pins Pebble's image to `ghcr.io/letsencrypt/pebble:2.10.3`, and this file is that release's
[`test/certs/pebble.minica.pem`](https://github.com/letsencrypt/pebble/blob/v2.10.3/test/certs/pebble.minica.pem).
Pebble has replaced its test root before, so when you move the image to a newer release, copy this
file from the same release.
