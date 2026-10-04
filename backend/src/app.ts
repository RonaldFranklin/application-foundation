import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Config } from "./infra/config/config";
import { Rates } from "./application/auth/use-cases/rate-limits";
import { configureHttp } from "./presentation/http/configure-http";

export async function createApp(c: Config) {
  const app = await NestFactory.create(AppModule.register(c), {
    logger: false,
    bodyParser: false,
  });
  configureHttp(app, c, app.get(Rates));
  await app.init();
  return app;
}
