import { Injectable } from '@nestjs/common';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

@Injectable()
export class McpService {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async getTools() {
    return this.toolRegistry.listMcpTools();
  }

  async invokeTool(userId: string, toolName: string, params: Record<string, unknown>) {
    try {
      return await this.toolRegistry.executeMcpTool(toolName, params);
    } catch (error) {
      return {
        success: false,
        tool: toolName,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
