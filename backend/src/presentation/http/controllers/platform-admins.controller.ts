import { PlatformRoles } from "../../../application/platform-admin/platform-roles";
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
const roleBody = (editing = false) => ({
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["name", "permissions", ...(editing ? ["version"] : [])],
    properties: {
      name: { type: "string" as const, minLength: 1, maxLength: 80 },
      permissions,
      ...(editing ? { version: { type: "integer" as const, minimum: 1 } } : {}),
    },
  },
});
const assignmentBody = {
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["roleId"],
    properties: {
      roleId: { type: "string" as const, format: "uuid", nullable: true },
    },
  },
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
    @Inject(PlatformRoles) private roles: PlatformRoles,
    @Inject(PlatformAdmins) private admins: PlatformAdmins,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Get("roles")
  rolesList(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .list(this.auth.raw(req))
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("roles")
  @HttpCode(200)
  @ApiBody(roleBody())
  createRole(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .save(this.auth.raw(req), req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("roles/:id")
  @HttpCode(200)
  @ApiBody(roleBody(true))
  @ApiParam({ name: "id", format: "uuid" })
  updateRole(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .save(this.auth.raw(req), req.body, String(req.params.id))
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("roles/:id/remove")
  @HttpCode(200)
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version"],
      properties: { version: { type: "integer", minimum: 1 } },
    },
  })
  removeRole(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .remove(this.auth.raw(req), String(req.params.id), req.body)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post(":id/role")
  @HttpCode(200)
  @ApiBody(assignmentBody)
  @ApiParam({ name: "id", format: "uuid" })
  assignAccountRole(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .assign(this.auth.raw(req), String(req.params.id), req.body, false)
      .then((r) => presentPlatformAdmin(res, r));
  }
  @Post("invitations/:id/role")
  @HttpCode(200)
  @ApiBody(assignmentBody)
  @ApiParam({ name: "id", format: "uuid" })
  assignInvitationRole(@Req() req: Request, @Res() res: Response) {
    return this.roles
      .assign(this.auth.raw(req), String(req.params.id), req.body, true)
      .then((r) => presentPlatformAdmin(res, r));
  }
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
      required: ["email"],
      oneOf: [{ required: ["permissions"] }, { required: ["roleId"] }],
      properties: {
        email: { type: "string", format: "email", maxLength: 254 },
        permissions,
        roleId: { type: "string", format: "uuid" },
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
