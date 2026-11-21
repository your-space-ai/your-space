# Integration qualification

The platform at `1dca473` has human/operator actors, events, owner sessions, installation IDs, a strict kit parser and a browser access gate. The gate handles browser access. Agent credentials, kit route grants and request approvals are proposed in this journey.

Before enabling a kit’s write routes, test its pinned version against a disposable installation. Verify the credential supports the intended operations, a repeated create produces one record, an edit rejects a stale revision, and revoking permission prevents the next write. Check resulting state in the app. Keep provider-specific findings, setup and release evidence with the integration or in the local test plan.

Use a second, unrelated route catalog with the same platform binary. If an integration cannot meet a route’s guarantees, leave that route disabled and document the limitation with the kit.
