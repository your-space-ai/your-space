# Integration qualification

The owner session and browser access gate handle human access. Each agent uses its own Your Space credential and an installation-scoped grant. Qualify the app’s underlying credential and route semantics separately.

Before enabling a kit’s write routes, test its pinned version against a disposable installation. Verify the credential supports the intended operations, a repeated create produces one record, an edit rejects a stale revision, and revoking permission prevents the next write. Check resulting state in the app. Keep provider-specific findings, setup and release evidence with the integration or in the local test plan.

Use a second, unrelated route catalog with the same platform binary. If an integration cannot meet a route’s guarantees, leave that route disabled and document the limitation with the kit.
