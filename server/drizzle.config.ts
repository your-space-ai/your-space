import { defineConfig } from "drizzle-kit";

// Generates versioned SQL migrations from both schema files into drizzle/ (research R11).
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/auth-schema.ts", "./src/db/schema.ts"],
  out: "./drizzle",
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
});
