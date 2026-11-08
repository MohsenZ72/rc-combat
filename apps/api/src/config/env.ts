import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_ISSUER: z.string().default("rc-combat-api"),
  JWT_AUDIENCE: z.string().default("rc-combat"),
  JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(7 * 24 * 3600).default(12 * 3600),
  INTERNAL_API_KEY: z.string().min(24, "INTERNAL_API_KEY must be at least 24 chars"),
  CLIENT_ORIGINS: z.string().default("http://localhost:5173"),
  SUSPENSION_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  GUEST_LOGINS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
});

export type Env = z.infer<typeof schema>;
export const ENV = Symbol("ENV");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid API environment:\n${issues}\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}
