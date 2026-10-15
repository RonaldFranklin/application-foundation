import { presentInvitation } from "../presenters/invitations.presenter";
import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { Invitations } from "../../../application/organization-invitations/invitations";
import { AuthPresenter } from "../presenters/auth.presenter";
import { masterOrganizationRoute } from "../organization-scope";
const empty = {
  schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
};
@Controller([
  "v1/admin/organizations/:id/invitations",
  "v1/organizations/:id/invitations",
])
@ApiCookieAuth("login_session")
@ApiParam({ name: "id", type: String, format: "uuid" })
@ApiResponse({
  status: 403,
  description: "Exige capacidade atual na organização.",
})
export class InvitationsController {
  constructor(
    @Inject(Invitations) private invitations: Invitations,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Get()
  @ApiQuery({ name: "search", required: false, type: String, maxLength: 254 })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["all", "pending", "expired", "accepted", "revoked"],
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 1000000,
  })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  list(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .list(
        this.auth.raw(req),
        String(req.params.id),
        masterOrganizationRoute(req),
        req.query,
      )
      .then((r) => presentInvitation(res, r));
  }
  @Post()
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["email"],
      properties: {
        email: { type: "string", format: "email", maxLength: 254 },
        role: {
          type: "string",
          enum: ["MEMBER", "ORGANIZATION_ADMIN"],
          default: "MEMBER",
        },
      },
    },
  })
  issue(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .issue(
        this.auth.raw(req),
        String(req.params.id),
        req.body,
        masterOrganizationRoute(req),
      )
      .then((r) => presentInvitation(res, r));
  }
  @ApiParam({ name: "invitationId", type: String, format: "uuid" })
  @Post(":invitationId/resend")
  @HttpCode(200)
  @ApiBody(empty)
  resend(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .issue(
        this.auth.raw(req),
        String(req.params.id),
        req.body,
        masterOrganizationRoute(req),
        String(req.params.invitationId),
      )
      .then((r) => presentInvitation(res, r));
  }
  @ApiParam({ name: "invitationId", type: String, format: "uuid" })
  @Post(":invitationId/revoke")
  @HttpCode(200)
  @ApiBody(empty)
  revoke(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .revoke(
        this.auth.raw(req),
        String(req.params.id),
        String(req.params.invitationId),
        req.body,
        masterOrganizationRoute(req),
      )
      .then((r) => presentInvitation(res, r));
  }
}
@Controller("v1/invitations")
export class InvitationAcceptanceController {
  constructor(
    @Inject(Invitations) private invitations: Invitations,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Post("preview")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["token"],
      properties: { token: { type: "string", maxLength: 80, writeOnly: true } },
    },
  })
  preview(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .preview(req.body)
      .then((r) => presentInvitation(res, r));
  }
  @Post("accept")
  @HttpCode(200)
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["token", "mode"],
          properties: {
            token: { type: "string", maxLength: 80, writeOnly: true },
            mode: { type: "string", enum: ["existing"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "token",
            "mode",
            "username",
            "password",
            "confirmPassword",
          ],
          properties: {
            token: { type: "string", maxLength: 80, writeOnly: true },
            mode: { type: "string", enum: ["new"] },
            username: { type: "string", maxLength: 100 },
            password: {
              type: "string",
              minLength: 15,
              maxLength: 1024,
              writeOnly: true,
            },
            confirmPassword: {
              type: "string",
              maxLength: 1024,
              writeOnly: true,
            },
          },
        },
      ],
    },
  })
  accept(@Req() req: Request, @Res() res: Response) {
    return this.invitations
      .accept(this.auth.raw(req), req.body)
      .then((r) => presentInvitation(res, r));
  }
}
