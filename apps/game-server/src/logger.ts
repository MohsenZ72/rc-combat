import pino from "pino";

export const logger = pino({
  name: "game-server",
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["token", "*.token", "authorization", "*.authorization"], censor: "[redacted]" },
});

export type Logger = typeof logger;
