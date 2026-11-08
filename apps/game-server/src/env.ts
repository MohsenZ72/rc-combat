import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GAME_SERVER_PORT: z.coerce.number().int().positive().default(2567),
  GAME_SERVER_ID: z.string().min(1).max(64).default("local-1"),
  API_INTERNAL_URL: z.url().default("http://localhost:3000"),
  INTERNAL_API_KEY: z.string().min(24, "INTERNAL_API_KEY must be at least 24 chars"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_ISSUER: z.string().default("rc-combat-api"),
  JWT_AUDIENCE: z.string().default("rc-combat"),
  CLIENT_ORIGINS: z.string().default("http://localhost:5173"),
  TICK_RATE: z.coerce.number().int().min(10).max(60).default(30),
  SNAPSHOT_DIVISOR: z.coerce.number().int().min(1).max(6).default(1),
  MIN_PLAYERS: z.coerce.number().int().min(1).max(10).default(2),
  MAX_PLAYERS: z.coerce.number().int().min(1).max(10).default(10),
  LOBBY_WAIT_SECONDS: z.coerce.number().int().min(1).max(300).default(20),
  FILL_WITH_BOTS: bool,
  RECONNECT_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
  RESULTS_LINGER_SECONDS: z.coerce.number().int().min(5).max(600).default(45),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid game-server environment:\n${issues}\nCopy .env.example to .env and fill it in.`);
  }
  if (parsed.data.MIN_PLAYERS > parsed.data.MAX_PLAYERS) throw new Error("MIN_PLAYERS cannot exceed MAX_PLAYERS");
  return parsed.data;
}
