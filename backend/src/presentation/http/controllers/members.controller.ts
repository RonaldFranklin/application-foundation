import { masterOrganizationRoute } from "../organization-scope";
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
  ApiResponse,
  ApiQuery,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { Members } from "../../../application/organizations/use-cases/members";
import { AuthPresenter } from "../presenters/auth.presenter";
import { MembersPresenter } from "../presenters/members.presenter";
import { authFailureSchema } from "../dto/auth.dto";
import { memberBody, memberListResponse } from "../dto/members.dto";
@Controller([
  "v1/admin/organizations/:id/members",
  "v1/organizations/:id/members",
])
@ApiCookieAuth("login_session")
@ApiParam({ name: "id", type: String, format: "uuid" })
@ApiResponse({
  status: 401,
  schema: authFailureSchema,
  description: "Exige sessão plena Master com senha trocada e MFA verificado.",
})
@ApiResponse({ status: 400, description: "Entrada inválida." })
@ApiResponse({
  status: 404,
  description: "Organização, conta ou vínculo não encontrado.",
})
export class MembersController {
  constructor(
    @Inject(Members) private operations: Members,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(MembersPresenter) private presenter: MembersPresenter,
  ) {}
  @Get()
  @ApiQuery({ name: "search", required: false, type: String, maxLength: 254 })
  @ApiQuery({
    name: "role",
    required: false,
    enum: ["MEMBER", "ORGANIZATION_ADMIN"],
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
  @ApiResponse(memberListResponse)
  async list(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.list(
        this.auth.raw(req),
        req.params.id,
        req.query,
        masterOrganizationRoute(req),
      ),
    );
  }
  @Post()
  @HttpCode(200)
  @ApiBody(memberBody("add"))
  @ApiResponse({
    status: 409,
    description: "Vínculo ou identificadores duplicados.",
  })
  async add(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.add(
        this.auth.raw(req),
        req.params.id,
        req.body,
        masterOrganizationRoute(req),
      ),
    );
  }
  @Post(":userId")
  @HttpCode(200)
  @ApiParam({ name: "userId", type: String, format: "uuid" })
  @ApiBody(memberBody("update"))
  async update(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.update(
        this.auth.raw(req),
        req.params.id,
        req.params.userId,
        req.body,
        false,
        masterOrganizationRoute(req),
      ),
    );
  }
  @Post(":userId/remove")
  @HttpCode(200)
  @ApiParam({ name: "userId", type: String, format: "uuid" })
  @ApiBody(memberBody("remove"))
  async remove(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.update(
        this.auth.raw(req),
        req.params.id,
        req.params.userId,
        req.body,
        true,
        masterOrganizationRoute(req),
      ),
    );
  }
}
