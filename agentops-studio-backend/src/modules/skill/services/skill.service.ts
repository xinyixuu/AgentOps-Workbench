import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/services/prisma.service';
import { CreateSkillDto } from '../dto/create-skill.dto';
import { UpdateSkillDto } from '../dto/update-skill.dto';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';

@Injectable()
export class SkillService {
  constructor(
    private prisma: PrismaService,
    private toolRegistry: ToolRegistryService,
  ) {}

  // 创建工具
  async createSkill(userId: string, createSkillDto: CreateSkillDto) {
    // 检查工具名称是否已存在
    const existingSkill = await this.prisma.skill.findFirst({
      where: { name: createSkillDto.name, userId },
    });

    if (existingSkill) {
      throw new BadRequestException('Skill with this name already exists');
    }

    return this.prisma.skill.create({
      data: {
        name: createSkillDto.name,
        description: createSkillDto.description,
        type: createSkillDto.type,
        builtinType: createSkillDto.builtinType,
        isActive: createSkillDto.isActive,
        userId,
        config: createSkillDto.config ? JSON.stringify(createSkillDto.config) : undefined,
        inputSchema: createSkillDto.inputSchema ? JSON.stringify(createSkillDto.inputSchema) : undefined,
        outputSchema: createSkillDto.outputSchema ? JSON.stringify(createSkillDto.outputSchema) : undefined,
      },
    });
  }

  // 获取用户的所有工具
  async findSkills(userId: string) {
    return this.prisma.skill.findMany({
      where: { userId },
    });
  }

  // 获取工具详情
  async findSkillById(userId: string, id: string) {
    const skill = await this.prisma.skill.findUnique({
      where: { id },
    });

    if (!skill) {
      throw new NotFoundException('Skill not found');
    }

    if (skill.userId !== userId) {
      throw new BadRequestException('You do not have permission to access this skill');
    }

    return skill;
  }

  // 更新工具
  async updateSkill(userId: string, id: string, updateSkillDto: UpdateSkillDto) {
    const skill = await this.findSkillById(userId, id);

    return this.prisma.skill.update({
      where: { id },
      data: {
        name: updateSkillDto.name,
        description: updateSkillDto.description,
        type: updateSkillDto.type,
        builtinType: updateSkillDto.builtinType,
        isActive: updateSkillDto.isActive,
        config: updateSkillDto.config ? JSON.stringify(updateSkillDto.config) : undefined,
        inputSchema: updateSkillDto.inputSchema ? JSON.stringify(updateSkillDto.inputSchema) : undefined,
        outputSchema: updateSkillDto.outputSchema ? JSON.stringify(updateSkillDto.outputSchema) : undefined,
      },
    });
  }

  // 删除工具
  async deleteSkill(userId: string, id: string) {
    const skill = await this.findSkillById(userId, id);

    return this.prisma.skill.delete({ where: { id } });
  }

  // 执行工具
  async executeSkill(userId: string, skillId: string, params: Record<string, any>) {
    return this.toolRegistry.executeSkillTool(userId, skillId, params);
  }

  // 获取内置工具列表
  async getBuiltinSkills() {
    return this.toolRegistry.listBuiltinTools();
  }
}
