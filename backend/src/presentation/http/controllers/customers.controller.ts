import { customerBodies } from "../dto/customers.dto";
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
  ApiCookieAuth,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { CustomerAccess } from "../../../application/customers/customer-access";
import { AuthPresenter } from "../presenters/auth.presenter";
import { AUTH_CONFIG } from "../../../auth/auth.tokens";
import { present } from "../presenters/customers.presenter";
@Controller("v1/customer")
export class CustomerController {
  private cookie: { name: string; secure: boolean };
  constructor(
    @Inject(CustomerAccess) private customers: CustomerAccess,
    @Inject(AUTH_CONFIG) c: { PUBLIC_API_ORIGIN: string },
  ) {
    const secure = new URL(c.PUBLIC_API_ORIGIN).protocol === "https:";
    this.cookie = {
      secure,
      name: `${secure ? "__Secure-" : ""}customer_session`,
    };
  }
  private raw(req: Request): string | undefined {
    return req.cookies?.[this.cookie.name];
  }
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Login exclusivo de clientes externos" })
  @ApiBody({ schema: customerBodies.login })
  login(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      () => this.customers.login(req.body, req.ip || "unknown"),
      this.cookie,
    );
  }
  @Post("accept")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.accept })
  accept(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.accept(req.body));
  }
  @Post("password/request")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.invite })
  request(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.requestReset(req.body));
  }
  @Post("password/reset")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.reset })
  reset(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.reset(req.body));
  }
  @Get("session")
  @ApiCookieAuth("customer_session")
  state(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.state(this.raw(req), req.query));
  }
  @Get("account")
  @ApiCookieAuth("customer_session")
  profile(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.profile(this.raw(req), req.query));
  }
  @Post("account")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.profile })
  @ApiCookieAuth("customer_session")
  update(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.update(this.raw(req), req.body));
  }
  @Post("logout")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.empty })
  @ApiCookieAuth("customer_session")
  logout(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      () => this.customers.logout(this.raw(req), req.body),
      this.cookie,
      true,
    );
  }
  @Get("sessions")
  @ApiCookieAuth("customer_session")
  sessions(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.listSessions(this.raw(req), req.query),
    );
  }
  @Post("sessions/revoke")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.revoke })
  @ApiCookieAuth("customer_session")
  revoke(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.revokeSession(this.raw(req), req.body),
    );
  }
  @Post("mfa/verify")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.code })
  @ApiCookieAuth("customer_session")
  mfa(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      () => this.customers.mfa(this.raw(req), req.body),
      this.cookie,
    );
  }
  @Post("mfa/setup")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.setup })
  @ApiCookieAuth("customer_session")
  setup(@Req() req: Request, @Res() res: Response) {
    return present(res, () => this.customers.setup(this.raw(req), req.body));
  }
  @Post("mfa/enroll")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.code })
  @ApiCookieAuth("customer_session")
  enroll(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      () => this.customers.enroll(this.raw(req), req.body),
      this.cookie,
    );
  }
  @Post("mfa/disable")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.disable })
  @ApiCookieAuth("customer_session")
  disable(@Req() req: Request, @Res() res: Response) {
    return present(
      res,
      () => this.customers.disable(this.raw(req), req.body),
      this.cookie,
    );
  }
}
@Controller("v1/organization-customers")
@ApiCookieAuth("login_session")
export class OrganizationCustomersController {
  constructor(
    @Inject(CustomerAccess) private customers: CustomerAccess,
    @Inject(AuthPresenter) private auth: AuthPresenter,
  ) {}
  @Get()
  @ApiQuery({
    name: "search",
    required: false,
    type: String,
    description: "E-mail completo normalizado",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  list(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.list(this.auth.raw(req), req.query),
    );
  }
  @Get(":id")
  @ApiParam({ name: "id", type: String, format: "uuid" })
  detail(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.detail(
        this.auth.raw(req),
        String(req.params.id),
        req.query,
      ),
    );
  }
  @Post("invite")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.invite })
  invite(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.invite(this.auth.raw(req), req.body),
    );
  }
  @Post(":id/resend")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.empty })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  resend(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.invite(
        this.auth.raw(req),
        req.body,
        String(req.params.id),
      ),
    );
  }
  @Post(":id/cancel")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.empty })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  cancel(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.cancel(
        this.auth.raw(req),
        String(req.params.id),
        req.body,
      ),
    );
  }
  @Post(":id/status")
  @HttpCode(200)
  @ApiBody({ schema: customerBodies.status })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  status(@Req() req: Request, @Res() res: Response) {
    return present(res, () =>
      this.customers.status(
        this.auth.raw(req),
        String(req.params.id),
        req.body,
      ),
    );
  }
}
