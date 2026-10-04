import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiParam, ApiResponse } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Members } from "../../../application/organizations/use-cases/members";
import { AuthPresenter } from "../presenters/auth.presenter";
import { MembersPresenter } from "../presenters/members.presenter";
import { memberBody, memberListResponse } from "../dto/members.dto";
@Controller("v1/admin/organizations/:id/members")
@ApiCookieAuth("login_session")
@ApiParam({ name: "id", type: String, format: "uuid" })
@ApiResponse({
  status: 401,
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
  @ApiResponse(memberListResponse)
  async list(@Req() req: Request, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.operations.list(this.auth.raw(req), req.params.id),
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
      await this.operations.add(this.auth.raw(req), req.params.id, req.body),
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
      ),
    );
  }
}
