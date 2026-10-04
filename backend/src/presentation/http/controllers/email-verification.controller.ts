import { Controller, Post, Req, Res, Inject, HttpCode } from "@nestjs/common";
import { ApiBody, ApiCookieAuth } from "@nestjs/swagger";
import { Request, Response } from "express";
import {
  VerifyEmail,
  VerificationResult,
  VerificationError,
} from "../../../application/email-verification/verify-email";
import { AuthPresenter } from "../presenters/auth.presenter";
const messages: Record<VerificationError, string> = {
  INPUT_INVALID:
    "Informe somente os dados solicitados e um código de seis dígitos.",
  SESSION_REQUIRED:
    "Entre novamente com uma sessão completa para verificar seu e-mail.",
  ALREADY_VERIFIED: "Seu e-mail já está verificado.",
  COOLDOWN: "Aguarde antes de solicitar outro código.",
  SEND_LIMIT: "Limite de envios atingido. Tente novamente mais tarde.",
  CODE_INVALID: "Código incorreto. Confira os seis dígitos.",
  CODE_EXPIRED: "Código expirado. Solicite um novo código.",
  ATTEMPT_LIMIT: "Limite de tentativas atingido. Solicite um novo código.",
  CODE_USED:
    "Este código já foi utilizado ou invalidado. Solicite um novo código.",
  UNAVAILABLE:
    "Não foi possível solicitar o código. Tente novamente mais tarde.",
};
function present(res: Response, result: VerificationResult) {
  res.setHeader("Cache-Control", "no-store");
  if (!("error" in result)) return res.status(200).json(result);
  const status =
    result.error === "SESSION_REQUIRED"
      ? 401
      : result.error === "UNAVAILABLE"
        ? 503
        : ["COOLDOWN", "SEND_LIMIT", "ATTEMPT_LIMIT"].includes(result.error)
          ? 429
          : 400;
  if (result.retryAfter)
    res.setHeader("Retry-After", String(result.retryAfter));
  return res
    .status(status)
    .json({
      code: result.error,
      message: messages[result.error],
      ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
    });
}
@Controller("v1/auth/email-verification")
@ApiCookieAuth("login_session")
export class EmailVerificationController {
  constructor(
    @Inject(VerifyEmail) private verify: VerifyEmail,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Post("request")
  @HttpCode(200)
  @ApiBody({
    schema: { type: "object", additionalProperties: false, properties: {} },
  })
  async request(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      await this.verify.request(this.auth.raw(req), req.body),
    );
  }
  @Post("confirm")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["code"],
      properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
    },
  })
  async confirm(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      await this.verify.confirm(this.auth.raw(req), req.body),
    );
  }
}
