import { DynamicModule, Module } from "@nestjs/common";
import { Config } from "./infra/config/config";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { EmailQueueModule } from "./infra/queues/email-queue.module";
@Module({})
export class AppModule {
  static register(c: Config): DynamicModule {
    const auth = AuthModule.register(c);
    return {
      module: AppModule,
      imports: [
        auth,
        OrganizationsModule.register(auth),
        EmailQueueModule.register(c.queue, c.smtp),
      ],
    };
  }
}
