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
import { auditPageSchema, auditDetailSchema } from "../dto/audit.dto";
import { AuthPresenter } from "../presenters/auth.presenter";
import { AuditPresenter } from "../presenters/audit.presenter";
@Controller("v1/audit")
@ApiCookieAuth("login_session")
@ApiResponse({ status: 401, description: "Exige sessão plena comum." })
@ApiResponse({
  status: 403,
  description:
    "Exige contexto selecionado e vínculo administrativo ativo.",
})
@ApiResponse({ status: 409, description: "Seleção explícita de organização necessária." })
export class OrganizationAuditController {
  constructor(
    @Inject(QueryAudit) private audit: QueryAudit,
    @Inject(AuthPresenter) private auth: AuthPresenter,
    @Inject(AuditPresenter) private presenter: AuditPresenter,
  ) {}
  @Get("access")
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["organization"],
      properties: { organization: { type: "string" } },
    },
  })
  access(@Req() req: Request, @Res() res: Response) {
    return this.audit
      .organizationAccess(this.auth.raw(req))
      .then((result) => this.presenter.issue(res, result));
  }
  @Get()
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "ISO 8601 com fuso, inclusive",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "ISO 8601 com fuso, inclusive",
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
  @ApiResponse({ status: 200, schema: auditPageSchema })
  @ApiResponse({
    status: 400,
    description: "Filtro inválido; organizationId não é aceito.",
  })
  list(@Req() req: Request, @Res() res: Response) {
    return this.audit
      .listOrganization(this.auth.raw(req), req.query)
      .then((result) => this.presenter.issue(res, result));
  }
  @Get(":id")
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @ApiResponse({ status: 200, schema: auditDetailSchema })
  @ApiResponse({
    status: 404,
    description: "Evento não encontrado neste escopo.",
  })
  read(@Req() req: Request, @Res() res: Response) {
    return this.audit
      .readOrganization(this.auth.raw(req), req.params.id, req.query)
      .then((result) => this.presenter.issue(res, result));
  }
}
