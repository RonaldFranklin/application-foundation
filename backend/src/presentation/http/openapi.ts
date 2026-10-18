import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Config } from "../../infra/config/config";
import { cookiePolicy } from "./presenters/cookies";
export function openapi(app: INestApplication, c: Config) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Application Foundation API")
      .setVersion("1.0.0")
      .setDescription(
        "Origin exata e application/json obrigatórios em POST. Cookie opaco HttpOnly. Ver README para estados, rate limits e respostas.",
      )
      .addServer(c.PUBLIC_API_ORIGIN)
      .addCookieAuth(
        cookiePolicy(c.PUBLIC_API_ORIGIN).sessionName,
        { type: "apiKey", in: "cookie" },
        "login_session",
      )
      .addCookieAuth(
        new URL(c.PUBLIC_API_ORIGIN).protocol === "https:"
          ? "__Secure-customer_session"
          : "customer_session",
        { type: "apiKey", in: "cookie" },
        "customer_session",
      )
      .build(),
  );
}
