import { masterOrganizationRoute } from "../organization-scope";
import { OrganizationAccess } from "../../../application/organizations/use-cases/organization-access";
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
  ApiQuery,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { Organizations } from "../../../application/organizations/use-cases/organizations";
import { AuthPresenter } from "../presenters/auth.presenter";
import { OrganizationsPresenter } from "../presenters/organizations.presenter";
import { authFailureSchema } from "../dto/auth.dto";
import { organizationBody } from "../dto/organizations.dto";
@Controller(["v1/admin/organizations", "v1/organizations"])
@ApiCookieAuth("login_session")
@ApiResponse({
  status: 401,
  description: "Sessão sem acesso à gestão de organizações.",
  schema: authFailureSchema,
})
export class OrganizationsController {
  constructor(
    @Inject(OrganizationAccess) private access: OrganizationAccess,
    @Inject(Organizations) private operations: Organizations,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(OrganizationsPresenter) private presenter: OrganizationsPresenter,
  ) {}
  @Get()
  @ApiQuery({ name: "search", required: false, type: String, maxLength: 200 })
  @ApiQuery({ name: "status", required: false, enum: ["active", "inactive"] })
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
  async list(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      masterOrganizationRoute(req)
        ? await this.operations.list(this.auth.raw(req), req.query)
        : await this.access.directory(this.auth.raw(req)),
    );
  }
  @Post()
  @HttpCode(200)
  @ApiBody(organizationBody(false))
  async create(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.create(this.auth.raw(req), req.body),
    );
  }
  @Get(":id/access")
  async describe(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.access.describe(
        this.auth.raw(req),
        req.params.id,
        masterOrganizationRoute(req),
      ),
    );
  }
  @Get(":id")
  @ApiParam({ name: "id", type: String, format: "uuid" })
  async read(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.read(
        this.auth.raw(req),
        req.params.id,
        masterOrganizationRoute(req),
      ),
    );
  }
  @Post(":id")
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @HttpCode(200)
  @ApiBody(organizationBody(true))
  async update(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.update(
        this.auth.raw(req),
        req.params.id,
        req.body,
        masterOrganizationRoute(req),
      ),
    );
  }
}
