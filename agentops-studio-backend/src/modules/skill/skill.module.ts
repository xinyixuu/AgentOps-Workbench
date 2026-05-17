import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/modules/prisma.module';
import { SkillController } from './skill.controller';
import { SkillService } from './services/skill.service';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  imports: [PrismaModule, ToolRegistryModule],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
