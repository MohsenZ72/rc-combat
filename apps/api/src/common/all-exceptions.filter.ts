import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";

/** Consistent JSON errors; internal details are logged, never returned. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === "string" ? { error: body } : body);
      return;
    }
    this.log.error({ path: req.url, method: req.method, err: (exception as Error)?.message, stack: (exception as Error)?.stack });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal_error" });
  }
}
