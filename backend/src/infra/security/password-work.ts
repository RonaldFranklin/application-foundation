import { Passwords } from "../../application/auth/ports/security";
import { Config } from "../config/config";
import { hashPassword, verifyPassword, token } from "./crypto";

export class PasswordWork implements Passwords {
  hash = hashPassword;
  verify = verifyPassword;
  constructor(private c: Config) {}
  dummy = "";
  private passwordWorkActive = 0;
  async init() {
    this.dummy = await hashPassword(token());
  }
  async run<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.passwordWorkActive >= this.c.PASSWORD_HASH_CONCURRENCY)
      return null;
    this.passwordWorkActive++;
    try {
      return await work();
    } finally {
      this.passwordWorkActive--;
    }
  }
}
