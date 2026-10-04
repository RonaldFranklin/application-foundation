import { DynamicModule, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Module({})
export class PrismaModule {
  static register(url: string): DynamicModule {
    return {
      module: PrismaModule,
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(url) },
      ],
      exports: [PrismaService],
    };
  }
}
