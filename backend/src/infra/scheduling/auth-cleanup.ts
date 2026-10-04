import { OnModuleDestroy } from "@nestjs/common";
import { Cleanup } from "../../application/auth/use-cases/cleanup";
export class AuthCleanup implements OnModuleDestroy {
  private cleanup?: NodeJS.Timeout;
  constructor(private useCase: Cleanup) {}
  start() {
    this.cleanup = setInterval(() => {
      void this.useCase
        .execute()
        .catch(() => console.warn('{"event":"cleanup_failed"}'));
    }, 3600000);
    this.cleanup.unref();
  }
  onModuleDestroy() {
    clearInterval(this.cleanup);
  }
}
