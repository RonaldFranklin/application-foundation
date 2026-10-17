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
  ApiOperation,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { ManageSessions } from "../../../application/auth/use-cases/manage-sessions";
import { AuthPresenter } from "../presenters/auth.presenter";

@Controller("v1/auth/sessions")
@ApiCookieAuth("login_session")
@ApiResponse({ status: 401, description: "Sessão plena obrigatória." })
@ApiResponse({
  status: 400,
  description: "Entrada inválida; IDs de conta e filtros não são aceitos.",
})
export class SessionController {
  constructor(
    @Inject(ManageSessions) private management: ManageSessions,
    @Inject(AuthPresenter) private presenter: AuthPresenter,
  ) {}
  @Get()
  @ApiOperation({
    summary: "Listar somente sessões não expiradas da própria conta",
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "current", "createdAt", "expiresAt", "status"],
            properties: {
              id: {
                type: "string",
                format: "uuid",
                description:
                  "Identificador público, independente do segredo de autenticação.",
              },
              current: { type: "boolean" },
              createdAt: { type: "string", format: "date-time" },
              expiresAt: { type: "string", format: "date-time" },
              status: { type: "string", enum: ["authenticated", "pending"] },
            },
          },
        },
      },
    },
  })
  async list(@Req() req: Request, @Res() res: Response) {
    return this.presenter.sessionManagement(
      res,
      await this.management.list(this.presenter.raw(req), req.query),
    );
  }
  @Post(":id/revoke")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Encerrar uma sessão própria ou todas as outras, preservando a atual",
  })
  @ApiParam({
    name: "id",
    schema: {
      oneOf: [
        { type: "string", format: "uuid" },
        { type: "string", enum: ["others"] },
      ],
    },
  })
  @ApiBody({
    schema: { type: "object", additionalProperties: false, properties: {} },
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "endedCurrent"],
      properties: {
        ok: { type: "boolean", enum: [true] },
        endedCurrent: { type: "boolean" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      "Sessão indisponível, sem distinguir outra conta de inexistência.",
  })
  async revoke(@Req() req: Request, @Res() res: Response) {
    return this.presenter.sessionManagement(
      res,
      await this.management.revoke(
        this.presenter.raw(req),
        req.params.id,
        req.body,
      ),
    );
  }
}
