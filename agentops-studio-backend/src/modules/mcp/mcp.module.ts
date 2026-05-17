import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';

@Module({
  imports: [ToolRegistryModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
