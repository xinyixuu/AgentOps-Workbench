import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/modules/prisma.module';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [PrismaModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
