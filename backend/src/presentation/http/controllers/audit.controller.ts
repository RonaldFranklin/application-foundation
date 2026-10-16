import { auditPageSchema, auditDetailSchema } from "../dto/audit.dto";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { QueryAudit } from "../../../application/audit/query-audit";
import { auditLabels } from "../../../application/audit/labels";
import { AuthPresenter } from "../presenters/auth.presenter";
import { AuditPresenter } from "../presenters/audit.presenter";
@Controller("v1/admin/audit")
@ApiCookieAuth("login_session")
@ApiResponse({ status: 401, description: "Exige sessão plena Master." })
export class AuditController {
  constructor(
    @Inject(QueryAudit) private audit: QueryAudit,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(AuditPresenter) private presenter: AuditPresenter,
  ) {}
  @Get()
  @ApiResponse({ status: 200, schema: auditPageSchema })
  @ApiResponse({ status: 400, description: "Filtros ou paginação inválidos." })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "Instante ISO 8601 com fuso, inclusive",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "Instante ISO 8601 com fuso, inclusive",
  })
  @ApiQuery({ name: "action", required: false, enum: Object.keys(auditLabels) })
  @ApiQuery({ name: "outcome", required: false, enum: ["success", "failure"] })
  @ApiQuery({
    name: "page",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
  })
  @ApiQuery({
    name: "pageSize",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
  })
  list(@Req() req: Request, @Res() res: Response) {
    return this.audit
      .list(this.auth.raw(req), req.query)
      .then((result) => this.presenter.issue(res, result));
  }
  @Get(":id")
  @ApiResponse({ status: 200, schema: auditDetailSchema })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 404, description: "Evento não encontrado." })
  read(@Req() req: Request, @Res() res: Response) {
    return this.audit
      .read(this.auth.raw(req), req.params.id, req.query)
      .then((result) => this.presenter.issue(res, result));
  }
}
