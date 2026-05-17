import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';
import axios, { AxiosRequestConfig } from 'axios';
import { PrismaService } from '../../common/services/prisma.service';

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  type: 'builtin' | 'custom' | 'mcp';
  builtinType?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permission: 'authenticated' | 'owner';
}

export interface ToolExecutionResult {
  success: boolean;
  tool: RegisteredTool;
  input: Record<string, unknown>;
  output: unknown;
  duration: number;
}

interface ToolDefinition extends RegisteredTool {
  inputValidator: ZodTypeAny;
  outputValidator: ZodTypeAny;
  handler: (params: Record<string, unknown>) => Promise<unknown> | unknown;
}

@Injectable()
export class ToolRegistryService {
  private readonly builtinTools: Map<string, ToolDefinition>;
  private readonly mcpTools: Map<string, ToolDefinition>;

  constructor(private readonly prisma: PrismaService) {
    this.builtinTools = this.createBuiltinTools();
    this.mcpTools = this.createMcpTools();
  }

  listBuiltinTools() {
    return Array.from(this.builtinTools.values()).map((tool) => this.serializeTool(tool));
  }

  listMcpTools() {
    return Array.from(this.mcpTools.values()).map((tool) => this.serializeTool(tool));
  }

  async executeSkillTool(userId: string, skillId: string, params: Record<string, unknown> = {}) {
    const builtinByType = this.builtinTools.get(skillId);
    if (builtinByType) {
      return this.executeDefinition(builtinByType, params);
    }

    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }

    if (skill.userId !== userId) {
      throw new ForbiddenException('You do not have permission to execute this skill');
    }

    if (!skill.isActive) {
      throw new BadRequestException('Skill is not active');
    }

    if (skill.type === 'builtin') {
      const builtin = skill.builtinType ? this.builtinTools.get(skill.builtinType) : undefined;
      if (!builtin) {
        throw new BadRequestException(`Unknown builtin skill type: ${skill.builtinType}`);
      }
      return this.executeDefinition(builtin, params);
    }

    const definition = this.createCustomHttpTool(skill);
    return this.executeDefinition(definition, params);
  }

  async executeMcpTool(toolName: string, params: Record<string, unknown> = {}) {
    const tool = this.mcpTools.get(toolName);
    if (!tool) {
      throw new NotFoundException(`Tool ${toolName} not found`);
    }
    return this.executeDefinition(tool, params);
  }

  private async executeDefinition(
    tool: ToolDefinition,
    params: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const validatedInput = tool.inputValidator.parse(params) as Record<string, unknown>;
    const output = await tool.handler(validatedInput);
    const validatedOutput = tool.outputValidator.parse(output);

    return {
      success: true,
      tool: this.serializeTool(tool),
      input: validatedInput,
      output: validatedOutput,
      duration: Date.now() - startedAt,
    };
  }

  private createBuiltinTools() {
    const tools = new Map<string, ToolDefinition>();

    tools.set('time', {
      id: 'builtin-time',
      name: '时间工具',
      description: '获取当前时间和日期',
      type: 'builtin',
      builtinType: 'time',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          datetime: { type: 'string' },
          timestamp: { type: 'number' },
          date: { type: 'string' },
          time: { type: 'string' },
        },
      },
      permission: 'authenticated',
      inputValidator: z.object({}).passthrough(),
      outputValidator: z.object({
        datetime: z.string(),
        timestamp: z.number(),
        date: z.string(),
        time: z.string(),
      }),
      handler: () => {
        const now = new Date();
        return {
          datetime: now.toISOString(),
          timestamp: now.getTime(),
          date: now.toDateString(),
          time: now.toTimeString(),
        };
      },
    });

    tools.set('http', {
      id: 'builtin-http',
      name: 'HTTP请求',
      description: '发送 HTTP 请求',
      type: 'builtin',
      builtinType: 'http',
      inputSchema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          headers: { type: 'object' },
          body: { type: 'object' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'number' },
          data: {},
          headers: { type: 'object' },
        },
      },
      permission: 'authenticated',
      inputValidator: z.object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
        headers: z.record(z.unknown()).default({}),
        body: z.unknown().optional(),
      }),
      outputValidator: z.object({
        status: z.number(),
        data: z.unknown(),
        headers: z.record(z.unknown()),
      }),
      handler: async (params) => {
        const response = await axios({
          url: params.url as string,
          method: params.method as string,
          headers: params.headers as AxiosRequestConfig['headers'],
          data: params.body,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      },
    });

    tools.set('json', {
      id: 'builtin-json',
      name: 'JSON处理',
      description: '解析或生成 JSON',
      type: 'builtin',
      builtinType: 'json',
      inputSchema: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['parse', 'stringify'] },
          data: {},
        },
      },
      outputSchema: {
        type: 'object',
        properties: { result: {} },
      },
      permission: 'authenticated',
      inputValidator: z.object({
        action: z.enum(['parse', 'stringify']),
        data: z.unknown(),
      }),
      outputValidator: z.object({ result: z.unknown() }),
      handler: (params) => {
        if (params.action === 'parse') {
          if (typeof params.data !== 'string') {
            throw new BadRequestException('Data must be a string for parse action');
          }
          return { result: JSON.parse(params.data) };
        }
        return { result: JSON.stringify(params.data) };
      },
    });

    tools.set('regex', {
      id: 'builtin-regex',
      name: '正则表达式',
      description: '使用正则表达式匹配文本',
      type: 'builtin',
      builtinType: 'regex',
      inputSchema: {
        type: 'object',
        required: ['text', 'pattern'],
        properties: {
          text: { type: 'string' },
          pattern: { type: 'string' },
          flags: { type: 'string' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          matches: { type: 'array' },
          groups: { type: 'object' },
        },
      },
      permission: 'authenticated',
      inputValidator: z.object({
        text: z.string(),
        pattern: z.string(),
        flags: z.string().default(''),
      }),
      outputValidator: z.object({
        matches: z.array(z.string()),
        groups: z.record(z.unknown()),
      }),
      handler: (params) => {
        const regex = new RegExp(params.pattern as string, params.flags as string);
        const matches = (params.text as string).match(regex);
        return {
          matches: matches || [],
          groups: matches?.groups || {},
        };
      },
    });

    return tools;
  }

  private createMcpTools() {
    const tools = new Map<string, ToolDefinition>();

    tools.set('echo', {
      id: 'mcp-echo',
      name: 'echo',
      description: '回显输入的消息',
      type: 'mcp',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      outputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
      },
      permission: 'authenticated',
      inputValidator: z.object({ message: z.string() }),
      outputValidator: z.object({ message: z.string() }),
      handler: (params) => ({ message: params.message }),
    });

    tools.set('calculator', {
      id: 'mcp-calculator',
      name: 'calculator',
      description: '执行基础算术运算',
      type: 'mcp',
      inputSchema: {
        type: 'object',
        required: ['a', 'b', 'operation'],
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
          operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
        },
      },
      outputSchema: {
        type: 'object',
        properties: { result: { type: 'number' } },
      },
      permission: 'authenticated',
      inputValidator: z.object({
        a: z.number(),
        b: z.number(),
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      }),
      outputValidator: z.object({ result: z.number() }),
      handler: (params) => {
        const a = params.a as number;
        const b = params.b as number;
        const operation = params.operation as string;

        if (operation === 'add') return { result: a + b };
        if (operation === 'subtract') return { result: a - b };
        if (operation === 'multiply') return { result: a * b };
        if (b === 0) throw new BadRequestException('Cannot divide by zero');
        return { result: a / b };
      },
    });

    return tools;
  }

  private createCustomHttpTool(skill: {
    id: string;
    name: string;
    description: string | null;
    config: string | null;
    inputSchema: string | null;
    outputSchema: string | null;
  }): ToolDefinition {
    const config = this.parseJson(skill.config, {});
    const inputSchema = this.parseJson(skill.inputSchema, { type: 'object', additionalProperties: true });
    const outputSchema = this.parseJson(skill.outputSchema, {});

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description || '自定义 HTTP 工具',
      type: 'custom',
      inputSchema,
      outputSchema,
      permission: 'owner',
      inputValidator: this.jsonSchemaToZod(inputSchema),
      outputValidator: this.jsonSchemaToZod(outputSchema, true),
      handler: async (params) => this.executeCustomHttp(config, params),
    };
  }

  private async executeCustomHttp(config: Record<string, unknown>, params: Record<string, unknown>) {
    const url = config.url as string | undefined;
    const method = (config.method as string | undefined) || 'POST';
    const headers = (config.headers as Record<string, unknown> | undefined) || {};

    if (!url) {
      return {
        success: true,
        data: params,
        message: 'Custom skill executed in echo mode because no URL is configured',
      };
    }

    const response = await axios({
      url,
      method,
      headers: headers as AxiosRequestConfig['headers'],
      data: params,
    });

    return {
      success: true,
      data: response.data,
    };
  }

  private jsonSchemaToZod(schema: Record<string, unknown>, allowUnknownOutput = false): ZodTypeAny {
    if (!schema || Object.keys(schema).length === 0) {
      return allowUnknownOutput ? z.unknown() : z.object({}).passthrough();
    }

    if (schema.type !== 'object') {
      return this.primitiveSchemaToZod(schema);
    }

    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required || []) as string[]);
    const shape: Record<string, ZodTypeAny> = {};

    for (const [key, propertySchema] of Object.entries(properties)) {
      const field = this.primitiveSchemaToZod(propertySchema);
      shape[key] = required.has(key) ? field : field.optional();
    }

    return z.object(shape).passthrough();
  }

  private primitiveSchemaToZod(schema: Record<string, unknown>): ZodTypeAny {
    if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'string')) {
      const values = schema.enum as string[];
      if (values.length > 0) {
        return z.enum(values as [string, ...string[]]);
      }
    }

    switch (schema.type) {
      case 'string':
        return z.string();
      case 'number':
      case 'integer':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(z.unknown());
      case 'object':
        return z.record(z.unknown());
      default:
        return z.unknown();
    }
  }

  private parseJson(value: string | null, fallback: Record<string, unknown>) {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return fallback;
    }
  }

  private serializeTool(tool: RegisteredTool): RegisteredTool {
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      type: tool.type,
      builtinType: tool.builtinType,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      permission: tool.permission,
    };
  }
}
