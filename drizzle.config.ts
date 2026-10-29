import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` writes SQL migrations to ./drizzle from the schema;
// `npm run db:migrate` applies them (scripts/migrate.ts).
export default defineConfig({
  dialect: 'mysql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
});
