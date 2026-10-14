import { presentVerification } from "../presenters/email-verification.presenter";
import { Controller, Post, Req, Res, Inject, HttpCode } from "@nestjs/common";
import { ApiBody, ApiCookieAuth } from "@nestjs/swagger";
import { Request, Response } from "express";
import { VerifyEmail } from "../../../application/email-verification/verify-email";
import { AuthPresenter } from "../presenters/auth.presenter";
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
    return presentVerification(
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
    return presentVerification(
      res,
      await this.verify.confirm(this.auth.raw(req), req.body),
    );
  }
}
