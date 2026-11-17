# Feature Specification: Encrypt Your Space's Stored Data

**Feature Branch**: `009-encrypt-stored-data`

**Created**: 2026-11-17

**Status**: Draft for review. Scope decided on 2026-11-17; two questions are open; see
[Decisions and Open Questions](#decisions-and-open-questions). Nothing in it is delivered yet.

**Linear**: YOU-50. Delivered as the last pull request of journey 003's stack, after the guide
slice. It is a follow-up specification, not one of the eight journeys in the
[spec map](../../docs/spec-map.md).

**Input**: The owner asked that Your Space's database be encrypted, after journey 003's tests found
that replacing the auth secret leaves installed apps' settings unreadable.

## At a Glance

- **Who:** the owner of a Your Space installation, and anyone who later holds a copy of its data.
- **Done when:** what Your Space stores that could hurt the owner if a copy of the database leaked
  is encrypted with a key of its own; replacing the auth secret only signs people out; existing
  installations move onto the new key by themselves; and the guide says exactly what is encrypted,
  with what, and what that does and doesn't protect against.
- **Not covered:** encrypting the whole database or the disk, which stays the owner's
  responsibility for now (the guide says how; a streamlined way may come later), encrypting apps'
  own databases and volumes (each app's data is the app's), backup
  encryption (journey 006, which can reuse this key), and a key held off the machine, such as in a
  secret manager (the decision record names OpenBao as the upgrade path).

## Why

Standard PostgreSQL, including the `postgres:18` image Your Space runs, doesn't encrypt what it
stores. Anyone with a copy of the `ys-postgres` volume, a file-level backup, or the disk reads it
all. Today:

| Data | Now |
| --- | --- |
| Passwords | Hashed with scrypt, never stored |
| Set-password and reset links | Stored only as a hash (journey 001) |
| Session tokens | Stored as they are. A copy alone can't forge a sign-in cookie, which is also signed with the auth secret, kept in the separate `ys-secrets` volume |
| Installed apps' settings and secrets | Encrypted by Your Space with AES-256-GCM, with a key derived from the auth secret |
| Everything else: names, usernames, emails, workspace, apps and their sources, outbound hosts, events | Plain |

Deriving the apps' settings key from the auth secret ties two unrelated things together: replacing
the auth secret, after a leak or after losing the secrets volume, leaves every installed app's
settings unreadable until each app is reinstalled.

## Options

| | What it encrypts | How | Cost |
| --- | --- | --- | --- |
| **A. Your Space's own key for what is secret** | Apps' settings, session tokens, and any later secret column | Your Space encrypts chosen columns itself, as it already does for apps' settings, with a key of its own in `ys-secrets` | Small: one more generated secret and a migration. Names, emails and other metadata stay plain |
| **B. A and every personal field** | A, plus names, usernames and emails | The same, with blind indexes (a keyed hash) for the fields Your Space looks up, such as usernames | Medium: lookups and unique checks change, and Better Auth's tables are read by Better Auth, so its fields need its own hooks |
| **A′. A, inside PostgreSQL** | The same as A | PostgreSQL's own pgcrypto extension, which ships with PostgreSQL and is in the official image (`CREATE EXTENSION pgcrypto`) | Small, but Your Space sends the key inside each query, so it can reach PostgreSQL's logs and statement statistics, as pgcrypto's own documentation warns |
| **C. The whole database** | Everything PostgreSQL writes: tables, indexes, the write-ahead log | Transparent encryption with Percona's `pg_tde`, which "is bundled as a component of Percona Server for PostgreSQL and requires its patches to function" ([Percona's docs](https://docs.percona.com/pg-tde/)) | Large: no extension does this for community PostgreSQL today, so Your Space would run Percona's PostgreSQL build instead of the official image. The key still sits on the same machine as the data |

How others handle it: managed databases (AWS RDS, Google Cloud SQL, Supabase) encrypt the storage
under PostgreSQL, and self-hosters do the same with LUKS, ZFS or FileVault; that protects a stolen
disk, not a copy taken while the machine runs. Secrets are then encrypted per field, by the app
(Rails, Laravel) or with pgcrypto, or with an extension of the host's own such as Supabase's Vault.

## Decision

Option A (2026-11-17): Your Space encrypts what is secret itself, with a key of its own, using
Node's built-in crypto as it already does for apps' settings, so the key never reaches the database
and nothing is added. Encrypting the whole database, or the disk under it, is the owner's
responsibility for now: the guide recommends disk encryption on the host and says what it protects.
A streamlined way to do it may come later, for example if `pg_tde` reaches community PostgreSQL.

## Requirements

- **FR-001**: Your Space generates a data key once, into the `ys-secrets` volume, like the auth
  secret and the database password, and never generates it again on its own. The owner can set it
  in `.env` (`YS_DATA_KEY`) instead; a key set there is used as given and never copied.
- **FR-002**: Installed apps' settings and secrets are encrypted with the data key (AES-256-GCM, a
  fresh nonce per value), and so are session tokens if [open question 1](#decisions-and-open-questions)
  is settled that way. Nothing else changes how it is stored.
- **FR-003**: On start, values still encrypted with the key derived from the auth secret are
  re-encrypted with the data key in one transaction, so existing installations move over by
  themselves. Once moved, replacing the auth secret only signs people out.
- **FR-004**: If the data key is missing but encrypted values exist, Your Space stops before
  starting anything, with recovery steps, as it already does for a lost database password.
- **FR-005**: The owner can replace the data key (`your-space secrets replace data-key`, or the
  secrets step's `--new data-key`): Your Space re-encrypts every value with the new key, then
  forgets the old one.
- **FR-006**: `show-secrets` and `your-space secrets show` list the data key with its source, and
  show its value only when asked.
- **FR-007**: The guide's "Secrets", "Replace a Secret" and "Lost Secrets" sections say what is
  encrypted, with which key, and that the key sits on the same machine as the data, so it protects
  copies of the database, not the machine itself. A new section recommends encrypting the disk on
  the host (LUKS or ZFS on Linux, FileVault on a Mac) for everything else, and says it protects a
  stolen disk but not a copy taken while the machine runs.

## Success Criteria

- **SC-001**: After `secrets replace auth-secret`, an installed app starts and its settings read back
  unchanged; the browser test that found the problem passes without reinstalling.
- **SC-002**: A copy of the `ys-postgres` volume holds no app setting or session token in plain text.
- **SC-003**: An installation with apps installed before this change starts after it with every
  app's settings readable, and no value left on the old key.

## Decisions and Open Questions

Decided on 2026-11-17: option A, and the whole database stays the owner's responsibility for now
([Decision](#decision)).

Open:

1. **Session tokens.** Better Auth finds a session by its token, so a token encrypted with a fresh
   nonce can't be looked up; it would have to be stored as a keyed hash instead, which depends on
   what Better Auth offers natively (constitution VII: no layer around it). Proposed: store them as
   a keyed hash if Better Auth supports that natively, and otherwise leave them as now, protected by
   the cookie signature; the plan settles which.
2. **Numbering.** This is the first specification that isn't a journey. Proposed: `009`, after the
   journeys; the alternative is a separate series for follow-up specifications.
