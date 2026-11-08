import "reflect-metadata";
import { ConsoleLogger, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./config/env.js";

/** Builds the configured Nest app (shared by main.ts and the e2e tests). */
export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger === false ? false : new ConsoleLogger({ json: process.env.NODE_ENV === "production", prefix: "api" }),
    bodyParser: false,
  });
  const env = app.get<Env>(ENV);
  // Replays from game servers can be a few MB; player requests are tiny.
  app.useBodyParser("json", { limit: "10mb" });
  app.use(helmet());
  app.enableCors({ origin: env.CLIENT_ORIGINS.split(",").map((o) => o.trim()), credentials: false });
  app.set("trust proxy", 1);
  app.enableShutdownHooks();
  return app;
}
