import { EditProfile } from "../../../application/auth/use-cases/edit-profile";
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
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { INVALID } from "../../../application/auth/results";
import { Login } from "../../../application/auth/use-cases/login";
import { ChangeInitialPassword } from "../../../application/auth/use-cases/change-initial-password";
import { Sessions } from "../../../application/auth/use-cases/sessions";
import { Mfa } from "../../../application/auth/use-cases/mfa";
import {
  authFailureSchema,
  loginBody,
  profileBody,
  initialCommonPasswordBody,
} from "../dto/auth.dto";
import { AuthPresenter } from "../presenters/auth.presenter";
type AuthRequest = Request<Record<string, string>, unknown, unknown>;
@Controller("v1")
@ApiCookieAuth("login_session")
@ApiResponse({
  status: 401,
  description:
    "Sessão, reautenticação ou transição recusada; código opcional identifica causas seguras.",
  schema: authFailureSchema,
})
export class AuthController {
  constructor(
    @Inject(EditProfile) private editProfile: EditProfile,
    @Inject(Login) private loginUseCase: Login,
    @Inject(ChangeInitialPassword)
    private changePassword: ChangeInitialPassword,
    @Inject(Sessions) private sessions: Sessions,
    @Inject(Mfa) private mfaFlow: Mfa,
    @Inject(AuthPresenter) private presenter: AuthPresenter,
  ) {}
  @HttpCode(200)
  @Post("auth/login")
  @ApiBody(loginBody)
  @ApiOperation({
    summary:
      "Login comum; rejeita master; emite password para senha temporária ou full para conta regular",
  })
  @ApiResponse({ status: 401, description: INVALID })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      required: ["ok", "stage"],
      properties: {
        ok: { type: "boolean", enum: [true] },
        stage: { type: "string", enum: ["password", "full"] },
      },
    },
  })
  async userLogin(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.login(
      res,
      await this.loginUseCase.execute(false, req.body, {
        ip: req.ip || "",
        previous: this.presenter.raw(req),
        deviceRaw: this.presenter.deviceRaw(req),
      }),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/login")
  @ApiBody(loginBody)
  @ApiOperation({ summary: "Login master, emite somente sessão restrita" })
  @ApiResponse({ status: 401, description: INVALID })
  async masterLogin(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.login(
      res,
      await this.loginUseCase.execute(true, req.body, {
        ip: req.ip || "",
        previous: this.presenter.raw(req),
        deviceRaw: this.presenter.deviceRaw(req),
      }),
    );
  }
  @Get("auth/session")
  @ApiOperation({ summary: "Estado da sessão, sem conceder acesso a recursos" })
  async state(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.sessions.state(this.presenter.raw(req)),
    );
  }
  @HttpCode(200)
  @Post("auth/initial-password")
  @ApiBody(initialCommonPasswordBody)
  @ApiOperation({
    summary:
      "Trocar senha temporária comum; exige sessão password comum, revoga sessões anteriores e emite sessão full de 8 horas por padrão",
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: { stage: { type: "string", enum: ["full"] } },
    },
  })
  @ApiResponse({
    status: 401,
    description:
      "Sessão ausente, expirada, revogada, de outro fluxo ou senha igual à temporária.",
    schema: authFailureSchema,
  })
  @ApiResponse({
    status: 400,
    description:
      "Senha fora da política, confirmação divergente ou campos extras.",
  })
  async initialCommonPassword(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.changePassword.execute(
        this.presenter.raw(req) || "",
        req.body,
        false,
      ),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/password")
  @ApiBody({
    schema: {
      type: "object",
      required: ["password"],
      properties: {
        password: { type: "string", minLength: 15, maxLength: 1024 },
      },
    },
  })
  async password(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.changePassword.execute(
        this.presenter.raw(req) || "",
        req.body,
      ),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/totp/setup")
  @ApiOperation({
    summary: "Segredo disponibilizado somente durante configuração restrita",
  })
  async setup(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.mfaFlow.setup(this.presenter.raw(req) || ""),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/totp/enroll")
  @ApiBody({
    schema: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
    },
  })
  async enroll(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.mfaFlow.mfa(this.presenter.raw(req) || "", req.body, true),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/mfa")
  @ApiBody({
    schema: {
      type: "object",
      required: ["code"],
      properties: {
        code: {
          type: "string",
          description: "TOTP ou recovery code de 32 caracteres",
        },
      },
    },
  })
  async mfa(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.mfaFlow.mfa(
        this.presenter.raw(req) || "",
        req.body,
        false,
        this.presenter.deviceRaw(req),
      ),
    );
  }
  @HttpCode(200)
  @Post("admin/auth/confirm")
  @ApiOperation({
    summary: "Confirma armazenamento dos códigos e eleva sessão",
  })
  async confirm(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.mfaFlow.confirm(
        this.presenter.raw(req) || "",
        this.presenter.deviceRaw(req),
      ),
    );
  }
  @HttpCode(200)
  @Post("auth/logout")
  @ApiOperation({
    summary: "Revogação idempotente, incluindo sessões restritas",
  })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        forgetDevice: {
          type: "boolean",
          default: false,
          description: "Revoga também o cookie de admissão deste dispositivo",
        },
      },
    },
  })
  async logout(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.logout(
      res,
      await this.sessions.logout(
        this.presenter.raw(req),
        req.body,
        this.presenter.deviceRaw(req),
      ),
    );
  }
  @Get("welcome")
  async welcome(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.sessions.welcome(this.presenter.raw(req), false),
    );
  }
  @Get("admin/welcome")
  async adminWelcome(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.issue(
      res,
      await this.sessions.welcome(this.presenter.raw(req), true),
    );
  }
  @HttpCode(200)
  @Post("auth/profile")
  @ApiBody(profileBody(false))
  @ApiOperation({
    summary:
      "Editar usuário/e-mail com senha atual e TOTP para master; e-mail sem verificação de posse",
  })
  async profile(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.profile(
      res,
      await this.editProfile.execute(
        this.presenter.raw(req) || "",
        req.body,
        false,
      ),
    );
  }
  @HttpCode(200)
  @Post("auth/password")
  @ApiBody(profileBody(true))
  @ApiOperation({
    summary:
      "Alterar senha; revoga todas as sessões e dispositivos; exige novo login",
  })
  async accountPassword(@Req() req: AuthRequest, @Res() res: Response) {
    return this.presenter.profile(
      res,
      await this.editProfile.execute(
        this.presenter.raw(req) || "",
        req.body,
        true,
      ),
    );
  }
  @Get("health") health(@Res() res: Response) {
    return this.presenter.health(res);
  }
}
