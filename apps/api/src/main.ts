import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { loadEnv } from "./config/env.js";
import { migrate } from "./database/migrate.js";

const env = loadEnv();
// Schema is migrated on boot (advisory-locked, so several instances are safe).
await migrate(env.DATABASE_URL, (m) => Logger.log(m, "Migrations"));
const app = await createApp();
await app.listen(env.API_PORT);
Logger.log(`API listening on :${env.API_PORT}`, "Bootstrap");
