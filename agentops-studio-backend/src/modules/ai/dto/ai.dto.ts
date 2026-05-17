import { IsString, IsOptional, IsObject, IsUUID, IsArray } from 'class-validator';

// DTO = Data Transfer Object，用来描述前端传给后端的数据长啥样
export class RunDto {
  @IsUUID('4', { message: 'Invalid application ID' })
  appId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Invalid workflow ID' })
  workflowId?: string;

  @IsObject({ message: 'Inputs must be an object' })
  inputs: Record<string, unknown>;

  @IsOptional()
  @IsString({ message: 'Session ID must be a string' })
  sessionId?: string;
}

export class StreamRunDto extends RunDto {}

export class ChatDto {
  @IsString({ message: 'Message must be a string' })
  message: string;

  @IsOptional()
  @IsArray({ message: 'History must be an array' })
  history?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;

  @IsOptional()
  @IsString({ message: 'Session ID must be a string' })
  sessionId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Invalid knowledge base ID' })
  knowledgeBaseId?: string;
}

