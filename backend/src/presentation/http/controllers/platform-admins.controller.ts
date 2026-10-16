import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { PlatformAdmins } from "../../../application/platform-admin/platform-admins";
import { platformPermissionKeys } from "../../../application/platform-admin/permissions";
import { presentPlatformAdmin } from "../presenters/platform-admins.presenter";
import { AuthPresenter } from "../presenters/auth.presenter";
const permissions = {
  type: "array" as const,
  uniqueItems: true,
  maxItems: 6,
  items: { type: "string" as const, enum: platformPermissionKeys },
};
const empty = {
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
};
@Controller("v1/admin/platform-admins")
@ApiCookieAuth("login_session")
@ApiResponse({
  status: 403,
  description: "Exclusivo do Master com sessão plena e MFA.",
})
export class PlatformAdminsController {
  constructor(
    @Inject(PlatformAdmins) private admins: PlatformAdmins,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Get()
  @ApiQuery({ name: "search", required: false, type: String, maxLength: 254 })
  @ApiQuery({
    name: "status",
    required: false,
    enum: [
      "all",
      "active",
      "inactive",
      "pending",
      "expired",
      "revoked",
      "accepted",
    ],
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  list(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .list(this.auth.raw(req), req.query)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("invitations")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["email", "permissions"],
      properties: {
        email: { type: "string", format: "email", maxLength: 254 },
        permissions,
      },
    },
  })
  issue(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .issue(this.auth.raw(req), req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("invitations/:id/resend")
  @HttpCode(200)
  @ApiBody(empty)
  @ApiParam({ name: "id", format: "uuid" })
  resend(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .issue(this.auth.raw(req), req.body, String(req.params.id))
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("invitations/:id/revoke")
  @HttpCode(200)
  @ApiBody(empty)
  @ApiParam({ name: "id", format: "uuid" })
  revoke(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .revoke(this.auth.raw(req), String(req.params.id), req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post(":id")
  @HttpCode(200)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["active", "permissions"],
      properties: { active: { type: "boolean" }, permissions },
    },
  })
  change(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .change(this.auth.raw(req), String(req.params.id), req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
}
@Controller("v1/platform-admin-invitations")
export class PlatformActivationController {
  constructor(@Inject(PlatformAdmins) private admins: PlatformAdmins) {}
  @Post("accept")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["token", "username", "password", "confirmPassword"],
      properties: {
        token: { type: "string", maxLength: 80, writeOnly: true },
        username: { type: "string", minLength: 1, maxLength: 100 },
        password: {
          type: "string",
          minLength: 15,
          maxLength: 1024,
          writeOnly: true,
        },
        confirmPassword: { type: "string", maxLength: 1024, writeOnly: true },
      },
    },
  })
  accept(@Req() req: Request, @Res() res: Response) {
    return this.admins
      .accept(req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
}
