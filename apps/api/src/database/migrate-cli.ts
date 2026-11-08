import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}
const applied = await migrate(url);
console.log(applied.length ? `done: ${applied.length} migration(s)` : "database is up to date");
