# Runtime test fixtures

`sure-resolved.json` comes from [Sure’s example Compose file at 70647cb](https://github.com/we-promise/sure/blob/70647cb/compose.example.yml), distributed under the [upstream AGPL-3.0 license](https://github.com/we-promise/sure/blob/70647cb/LICENSE). The fixture is the JSON output of `docker compose -p ys-sure config --format json` on that sample. The runtime adapter tests use it to check how an existing app’s services and volumes are handled.
