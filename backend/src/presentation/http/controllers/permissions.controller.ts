import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Permissions } from "../../../application/organizations/use-cases/permissions";
import { permissionKeys } from "../../../application/organizations/permissions";
import { AuthPresenter } from "../presenters/auth.presenter";
import { PermissionsPresenter } from "../presenters/permissions.presenter";
import { masterOrganizationRoute } from "../organization-scope";
@Controller([
  "v1/admin/organizations/:id/permissions",
  "v1/organizations/:id/permissions",
])
@ApiCookieAuth("login_session")
export class PermissionsController {
  constructor(
    @Inject(Permissions) private permissions: Permissions,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(PermissionsPresenter) private presenter: PermissionsPresenter,
  ) {}
  @Get()
  read(@Req() req: Request, @Res() res: Response) {
    return this.permissions
      .execute(
        this.auth.raw(req),
        req.params.id,
        undefined,
        masterOrganizationRoute(req),
      )
      .then((result) => this.presenter.issue(res, result));
  }
  @Post()
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["role", "permissions"],
      properties: {
        role: { type: "string", enum: ["MEMBER"] },
        permissions: {
          type: "array",
          uniqueItems: true,
          items: { type: "string", enum: permissionKeys },
        },
      },
    },
  })
  save(@Req() req: Request, @Res() res: Response) {
    return this.permissions
      .execute(
        this.auth.raw(req),
        req.params.id,
        req.body,
        masterOrganizationRoute(req),
      )
      .then((result) => this.presenter.issue(res, result));
  }
}
