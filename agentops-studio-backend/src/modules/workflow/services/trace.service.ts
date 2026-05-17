import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/services/prisma.service';

export type TraceEventType =
  | 'run_started'
  | 'run_finished'
  | 'step_started'
  | 'step_finished'
  | 'step_skipped'
  | 'token'
  | 'tool_call'
  | 'rag_retrieval'
  | 'error';

export interface TraceSession {
  runId: string;
  workflowId: string;
  sequence: number;
  startedAtMs: number;
}

export interface TraceStep {
  id: string;
  nodeId: string;
  nodeType: string;
  startedAtMs: number;
}

@Injectable()
export class TraceService {
  constructor(private readonly prisma: PrismaService) {}

  async assertWorkflowOwner(userId: string, workflowId: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        application: {
          select: { userId: true },
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }

    if (workflow.application.userId !== userId) {
      throw new ForbiddenException('You do not have permission to access this workflow');
    }

    return workflow;
  }

  async startRun(workflowId: string, inputs: Record<string, unknown> = {}): Promise<TraceSession> {
    const run = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        status: 'running',
        inputs: this.safeStringify(inputs),
        startedAt: new Date(),
      },
      select: {
        id: true,
        startedAt: true,
      },
    });

    const session: TraceSession = {
      runId: run.id,
      workflowId,
      sequence: 0,
      startedAtMs: run.startedAt.getTime(),
    };

    await this.recordEvent(session, 'run_started', { workflowId, inputs });
    return session;
  }

  async finishRun(
    session: TraceSession,
    status: 'success' | 'failed' | 'cancelled',
    context?: Record<string, unknown>,
    error?: string,
  ) {
    const completedAt = new Date();
    const duration = completedAt.getTime() - session.startedAtMs;

    await this.recordEvent(session, status === 'success' ? 'run_finished' : 'error', {
      status,
      duration,
      error,
    });

    return this.prisma.workflowExecution.update({
      where: { id: session.runId },
      data: {
        status,
        context: context === undefined ? undefined : this.safeStringify(context),
        error,
        duration,
        completedAt,
      },
    });
  }

  async startStep(
    session: TraceSession,
    node: { id: string; type: string; data?: Record<string, unknown> },
    input: Record<string, unknown>,
  ): Promise<TraceStep> {
    const step = await this.prisma.workflowStep.create({
      data: {
        executionId: session.runId,
        nodeId: node.id,
        nodeType: node.type,
        label: typeof node.data?.label === 'string' ? node.data.label : undefined,
        status: 'running',
        inputSnapshot: this.safeStringify(input),
        startedAt: new Date(),
      },
      select: {
        id: true,
        nodeId: true,
        nodeType: true,
        startedAt: true,
      },
    });

    const traceStep: TraceStep = {
      id: step.id,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      startedAtMs: step.startedAt.getTime(),
    };

    await this.recordEvent(session, 'step_started', {
      nodeId: node.id,
      nodeType: node.type,
      label: node.data?.label,
    }, step.id);

    return traceStep;
  }

  async finishStep(
    session: TraceSession,
    step: TraceStep,
    status: 'success' | 'failed' | 'skipped',
    output?: unknown,
    error?: string,
  ) {
    const completedAt = new Date();
    const duration = completedAt.getTime() - step.startedAtMs;

    const updatedStep = await this.prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status,
        outputSnapshot: output === undefined ? undefined : this.safeStringify(output),
        error,
        duration,
        completedAt,
      },
    });

    await this.recordEvent(
      session,
      status === 'skipped' ? 'step_skipped' : 'step_finished',
      {
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        status,
        duration,
        output,
        error,
      },
      step.id,
    );

    return updatedStep;
  }

  async recordEvent(
    session: TraceSession,
    eventType: TraceEventType,
    payload: unknown,
    stepId?: string,
  ) {
    session.sequence += 1;

    return this.prisma.traceEvent.create({
      data: {
        executionId: session.runId,
        stepId,
        eventType,
        sequence: session.sequence,
        payload: this.safeStringify(payload),
      },
    });
  }

  async listRuns(userId: string, workflowId: string) {
    await this.assertWorkflowOwner(userId, workflowId);

    const runs = await this.prisma.workflowExecution.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        _count: {
          select: {
            steps: true,
            traceEvents: true,
          },
        },
      },
    });

    return runs.map((run) => ({
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      inputs: this.parseJson(run.inputs),
      error: run.error,
      duration: run.duration,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      stepCount: run._count.steps,
      eventCount: run._count.traceEvents,
    }));
  }

  async getRun(userId: string, runId: string) {
    const run = await this.prisma.workflowExecution.findFirst({
      where: {
        id: runId,
        workflow: {
          application: {
            userId,
          },
        },
      },
      include: {
        steps: {
          orderBy: { startedAt: 'asc' },
        },
        traceEvents: {
          orderBy: { sequence: 'asc' },
        },
        workflow: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException('Workflow run not found');
    }

    return {
      id: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflow.name,
      status: run.status,
      inputs: this.parseJson(run.inputs),
      context: this.parseJson(run.context),
      error: run.error,
      duration: run.duration,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      steps: run.steps.map((step) => ({
        id: step.id,
        nodeId: step.nodeId,
        nodeType: step.nodeType,
        label: step.label,
        status: step.status,
        input: this.parseJson(step.inputSnapshot),
        output: this.parseJson(step.outputSnapshot),
        error: step.error,
        duration: step.duration,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      })),
      traceEvents: run.traceEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        sequence: event.sequence,
        payload: this.parseJson(event.payload),
        stepId: event.stepId,
        createdAt: event.createdAt,
      })),
    };
  }

  private safeStringify(value: unknown): string | undefined {
    if (value === undefined) return undefined;

    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ unserializable: true });
    }
  }

  private parseJson(value: string | null): unknown {
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
