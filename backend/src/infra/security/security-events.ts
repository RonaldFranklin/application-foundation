import { SecurityEvents } from "../../application/auth/ports/security";
export class ConsoleSecurityEvents implements SecurityEvents {
  login(event: "login_failed" | "password_accepted", master: boolean) {
    console.info(JSON.stringify({ event, flow: master ? "master" : "user" }));
  }
}
