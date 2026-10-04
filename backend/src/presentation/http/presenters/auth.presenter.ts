import { ProfileEditResult } from "../../../application/auth/use-cases/edit-profile";
import { Request, Response } from "express";
import { Config } from "../../../infra/config/config";
import {
  IssueResult,
  LoginResult,
  INVALID,
} from "../../../application/auth/results";
import { Sessions } from "../../../application/auth/use-cases/sessions";
import { cookiePolicy } from "./cookies";
export class AuthPresenter {
  constructor(private c: Config) {}
  raw(req: Request): string | undefined {
    return req.cookies?.[cookiePolicy(this.c.PUBLIC_API_ORIGIN).sessionName] as
      string | undefined;
  }
  deviceRaw(req: Request): string | undefined {
    return req.cookies?.[cookiePolicy(this.c.PUBLIC_API_ORIGIN).deviceName] as
      string | undefined;
  }
  issue(res: Response, result: IssueResult) {
    if (result && "busy" in result)
      return res
        .status(503)
        .setHeader("Retry-After", "1")
        .json({ message: "Autenticação temporariamente indisponível." });
    if (!result) return res.status(401).json({ message: INVALID });
    if ("invalid" in result)
      return res.status(400).json({
        message:
          result.invalid === "password"
            ? "Use uma nova senha de 15 a 1024 caracteres."
            : result.invalid === "initial-password"
              ? "Use uma nova senha de 15 a 1024 caracteres e repita a mesma senha na confirmação."
              : "Solicitação inválida.",
      });
    if ("raw" in result) {
      const { raw, seconds, deviceRaw, ...body } = result;
      const policy = cookiePolicy(this.c.PUBLIC_API_ORIGIN);
      if (raw)
        res.cookie(policy.sessionName, raw, {
          ...policy.options,
          maxAge: seconds * 1000,
        });
      if (deviceRaw)
        res.cookie(policy.deviceName, deviceRaw, {
          ...policy.options,
          maxAge: this.c.MASTER_DEVICE_DAYS * 86400000,
        });
      return res.status(200).json(body);
    }
    return res.status(200).json(result);
  }
  login(res: Response, result: LoginResult) {
    if ("busy" in result) return this.issue(res, result);
    if (!result.ok)
      return res.status(401).json({
        message: INVALID,
        challengeRequired: result.challengeRequired,
      });
    return this.issue(res, result);
  }
  logout(res: Response, result: Awaited<ReturnType<Sessions["logout"]>>) {
    if (result.invalid) return this.issue(res, result);
    const policy = cookiePolicy(this.c.PUBLIC_API_ORIGIN);
    res.clearCookie(policy.sessionName, policy.options);
    if (result.deviceRevocationFailed)
      return res
        .status(500)
        .json({ message: "Serviço temporariamente indisponível." });
    if (result.forgetDevice) res.clearCookie(policy.deviceName, policy.options);
    return res.status(204).send();
  }
  profile(res: Response, result: ProfileEditResult) {
    if (!result || "busy" in result) return this.issue(res, result);
    if ("fields" in result)
      return res.status(400).json({
        message: "Revise os campos informados.",
        fields: result.fields,
      });
    if ("rejected" in result)
      return res.status(401).json({
        message:
          "Não foi possível confirmar a alteração. Confira os dados e a autenticação ou tente novamente mais tarde.",
      });
    if (result.passwordChanged) {
      const policy = cookiePolicy(this.c.PUBLIC_API_ORIGIN);
      res.clearCookie(policy.sessionName, policy.options);
      res.clearCookie(policy.deviceName, policy.options);
    }
    return res.status(200).json(result);
  }
  health(res: Response) {
    return res.json({ status: "ok" });
  }
}
