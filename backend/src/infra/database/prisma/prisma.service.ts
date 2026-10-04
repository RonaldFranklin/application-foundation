import { OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// A single pool per application; connection remains lazy for OpenAPI generation.
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(url: string) {
    super({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
