import { Controller, Get, Post, Inject, Req, Res } from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiResponse } from "@nestjs/swagger";
import { Request, Response } from "express";
import { OrganizationContextPresenter } from "../presenters/organization-context.presenter";
import { OrganizationContext } from "../../../application/organizations/use-cases/organization-context";
import { AuthPresenter } from "../presenters/auth.presenter";
@Controller("v1/organization-context")
@ApiCookieAuth("login_session")
@ApiResponse({ status: 401, description: "Exige sessão plena comum." })
@ApiResponse({
  status: 403,
  description:
    "Organização sem autorização administrativa ou contexto revogado.",
})
@ApiResponse({
  status: 409,
  description: "Seleção explícita de organização necessária.",
})
export class OrganizationContextController {
  constructor(
    @Inject(OrganizationContext) private context: OrganizationContext,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(OrganizationContextPresenter)
    private presenter: OrganizationContextPresenter,
  ) {}
  @Get()
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["organizationId", "name"],
      properties: {
        organizationId: { type: "string", format: "uuid" },
        name: { type: "string" },
      },
    },
  })
  read(@Req() req: Request, @Res() res: Response) {
    return this.context
      .resolve(this.auth.raw(req))
      .then((r) => this.presenter.issue(res, r));
  }
  @Post()
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["organizationId", "name"],
      properties: {
        organizationId: { type: "string", format: "uuid" },
        name: { type: "string" },
      },
    },
  })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["organizationId"],
      properties: { organizationId: { type: "string", format: "uuid" } },
    },
  })
  @ApiResponse({ status: 400, description: "Seleção inválida." })
  select(@Req() req: Request, @Res() res: Response) {
    return this.context
      .select(this.auth.raw(req), req.body)
      .then((r) => this.presenter.issue(res, r));
  }
}
