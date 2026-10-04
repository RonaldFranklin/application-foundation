import { INestApplication, ArgumentsHost } from "@nestjs/common";
import { Request, Response, json } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Config } from "../../infra/config/config";
import { Rates } from "../../application/auth/use-cases/rate-limits";
import { INVALID } from "../../application/auth/results";
export function configureHttp(app: INestApplication, c: Config, rates: Rates) {
  const express = app.getHttpAdapter().getInstance();
  express.set(
    "trust proxy",
    c.TRUST_PROXY ? c.TRUST_PROXY.split(",").map((v) => v.trim()) : false,
  );
  app.use(helmet());
  app.enableCors({
    origin: c.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  });
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !== c.FRONTEND_ORIGIN ||
        req.headers["sec-fetch-site"] === "cross-site" ||
        !req.is("application/json")
      )
        return res
          .status(403)
          .json({ message: "Origem da solicitação inválida." });
    }
    next();
  });
  app.use(async (req: Request, res: Response, next: () => void) => {
    try {
      const outcome = await rates.admitRequest(
        req.ip || "unknown",
        req.path === "/v1/auth/login" || req.path === "/v1/admin/auth/login",
      );
      if (outcome !== "allowed")
        return res
          .status(429)
          .setHeader("Retry-After", "60")
          .json({
            message:
              outcome === "api-limit" ? "Tente novamente mais tarde." : INVALID,
          });
      next();
    } catch {
      return res
        .status(503)
        .json({ message: "Serviço temporariamente indisponível." });
    }
  });
  app.use(json({ limit: "8kb" }));
  app.use(cookieParser());
  app.useGlobalFilters({
    catch(exception: unknown, host: ArgumentsHost) {
      const res = host.switchToHttp().getResponse<Response>();
      const status = (exception as { status?: number })?.status;
      res.status(status === 413 ? 413 : 500).json({
        message:
          status === 413
            ? "Solicitação muito grande."
            : "Serviço temporariamente indisponível.",
      });
    },
  });
}
