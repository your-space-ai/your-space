// Entry point for the Better Auth CLI, which reads an `auth` export to generate auth-schema.ts:
//   npx auth@1.7.18 generate --config src/db/auth-generate.ts --output src/db/auth-schema.ts --yes
// It builds the public instance against a mock database; nothing connects.
import { drizzle } from "drizzle-orm/node-postgres";
import { createAuth } from "../auth.ts";
import { schema, type Db } from "./client.ts";

export const auth = createAuth({
  config: { publicUrl: "http://localhost", authSecret: "schema-generation-only-not-a-secret" },
  db: drizzle.mock({ schema }) as unknown as Db,
});
