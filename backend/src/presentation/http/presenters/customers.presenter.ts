import { Response } from "express";
import { CustomerError } from "../../../application/customers/customer-access";
const options = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/v1/customer",
});
export async function present(
  res: Response,
  work: () => Promise<unknown>,
  cookie?: { name: string; secure: boolean },
  clear = false,
) {
  try {
    const result = (await work()) as Record<string, unknown>;
    const { raw, seconds, ...body } = result;
    if (cookie && typeof raw === "string")
      res.cookie(cookie.name, raw, {
        ...options(cookie.secure),
        maxAge: Number(seconds) * 1000,
      });
    if (cookie && clear) res.clearCookie(cookie.name, options(cookie.secure));
    return res.status(200).json(body);
  } catch (error) {
    if (!(error instanceof CustomerError)) throw error;
    if (error.status === 429 || error.status === 503)
      res.setHeader("Retry-After", "60");
    return res.status(error.status).json({ message: error.message });
  }
}
