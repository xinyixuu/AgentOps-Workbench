import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/services/prisma.service';
import { NodeExecutorFactory } from './node-executor.factory';
import { RunWorkflowDto } from '../dto/run-workflow.dto';
import { Subject } from 'rxjs';
import { TraceService, TraceSession, TraceStep } from './trace.service';

interface ExecuteWorkflowOptions {
  userId?: string;
}

@Injectable()
export class WorkflowExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factory: NodeExecutorFactory,
    private readonly traceService: TraceService,
  ) {}

  async executeWorkflow(
    workflowId: string,
    runDto: RunWorkflowDto,
    sseSubject?: Subject<any>,
    options: ExecuteWorkflowOptions = {},
  ) {
    const workflow = options.userId
      ? await this.traceService.assertWorkflowOwner(options.userId, workflowId)
      : await this.prisma.workflow.findUnique({
          where: { id: workflowId },
        });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const traceSession = await this.traceService.startRun(
      workflowId,
      (runDto.inputs || {}) as Record<string, unknown>,
    );
    this.emit(sseSubject, 'run_started', {
      runId: traceSession.runId,
      workflowId,
      inputs: runDto.inputs || {},
    });

    try {
      const nodes = JSON.parse(workflow.nodes) as any[];
      const edges = JSON.parse(workflow.edges) as any[];
      const nodeMap = new Map<string, any>();

      // Build adjacency: nodeId → [{target, sourceHandle}]
      const adjList = new Map<string, { target: string; sourceHandle?: string }[]>();
      // Build in-degree map (only non-condition-dependent)
      const inDegree = new Map<string, number>();

      for (const node of nodes) {
        nodeMap.set(node.id, node);
        adjList.set(node.id, []);
        inDegree.set(node.id, 0);
      }

      for (const edge of edges) {
        const neighbors = adjList.get(edge.source);
        if (neighbors) {
          neighbors.push({ target: edge.target, sourceHandle: edge.sourceHandle });
        }
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      }

      // BFS-style execution: start from nodes with in-degree 0
      const context: Record<string, any> = { ...runDto.inputs };
      Object.defineProperty(context, '__runtime', {
        value: {
          userId: options.userId,
          runId: traceSession.runId,
        },
        enumerable: false,
        configurable: true,
      });
      const executed = new Set<string>();
      const skipped = new Set<string>();

      // Track remaining in-degree for runtime (some edges may be "pruned" by conditions)
      const runtimeInDegree = new Map<string, number>(inDegree);

      // Seed queue with root nodes (in-degree = 0)
      const queue: string[] = nodes
        .filter((n) => inDegree.get(n.id) === 0)
        .map((n) => n.id);

      while (queue.length > 0) {
        const nodeId = queue.shift()!;

        // Skip if already executed or skipped
        if (executed.has(nodeId) || skipped.has(nodeId)) continue;

        const node = nodeMap.get(nodeId);
        if (!node) continue;

        let traceStep: TraceStep | null = null;

        try {
          traceStep = await this.traceService.startStep(traceSession, node, {
            nodeData: node.data || {},
            contextKeys: Object.keys(context),
          });
          this.emit(sseSubject, 'step_started', {
            runId: traceSession.runId,
            stepId: traceStep.id,
            nodeId,
            nodeType: node.type,
            label: node.data?.label,
          });
          sseSubject?.next({ type: 'node_status', data: { nodeId, status: 'running' } });

          const executor = this.factory.getExecutor(node.type);
          const output = await executor.execute(node, context);
          context[nodeId] = output;
          executed.add(nodeId);

          await this.traceService.finishStep(traceSession, traceStep, 'success', output);
          this.emit(sseSubject, 'step_finished', {
            runId: traceSession.runId,
            stepId: traceStep.id,
            nodeId,
            nodeType: node.type,
            status: 'success',
            output,
          });
          sseSubject?.next({ type: 'node_status', data: { nodeId, status: 'success', output } });

          await this.recordNodeSpecificTrace(traceSession, traceStep, node, output, sseSubject);

          // Get downstream edges
          const downstream = adjList.get(nodeId) || [];

          if (node.type === 'condition') {
            // Condition node: only activate the matching branch
            const conditionResult = output?.result;
            const matchHandle = conditionResult ? 'true' : 'false';
            const skipHandle = conditionResult ? 'false' : 'true';

            for (const edge of downstream) {
              if (edge.sourceHandle === matchHandle) {
                // Decrement in-degree for the active branch target
                const deg = (runtimeInDegree.get(edge.target) || 1) - 1;
                runtimeInDegree.set(edge.target, deg);
                if (deg <= 0) {
                  queue.push(edge.target);
                }
              } else if (edge.sourceHandle === skipHandle) {
                // Mark skipped branch — recursively skip all descendants
                await this.skipBranch(edge.target, nodeMap, adjList, skipped, traceSession, sseSubject);
              }
            }
          } else {
            // Normal node: activate all downstream
            for (const edge of downstream) {
              const deg = (runtimeInDegree.get(edge.target) || 1) - 1;
              runtimeInDegree.set(edge.target, deg);
              if (deg <= 0 && !skipped.has(edge.target)) {
                queue.push(edge.target);
              }
            }
          }
        } catch (error) {
          const message = this.errorMessage(error);
          if (traceStep) {
            await this.traceService.finishStep(traceSession, traceStep, 'failed', undefined, message);
          }
          await this.traceService.recordEvent(traceSession, 'error', {
            nodeId,
            nodeType: node.type,
            message,
          }, traceStep?.id);
          this.emit(sseSubject, 'error', {
            runId: traceSession.runId,
            stepId: traceStep?.id,
            nodeId,
            message: `Error executing node ${nodeId}: ${message}`,
          });
          sseSubject?.next({ type: 'node_status', data: { nodeId, status: 'failed', error: message } });
          throw error;
        }
      }

      await this.traceService.finishRun(traceSession, 'success', context);
      this.emit(sseSubject, 'run_finished', {
        runId: traceSession.runId,
        workflowId,
        status: 'success',
        finalContext: context,
      });
      sseSubject?.next({ type: 'done', data: { runId: traceSession.runId, finalContext: context } });
      return context;
    } catch (error) {
      const message = this.errorMessage(error);
      await this.traceService.finishRun(traceSession, 'failed', undefined, message);
      this.emit(sseSubject, 'run_finished', {
        runId: traceSession.runId,
        workflowId,
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  /**
   * Recursively mark a branch as skipped and notify via SSE
   */
  private async skipBranch(
    nodeId: string,
    nodeMap: Map<string, any>,
    adjList: Map<string, { target: string; sourceHandle?: string }[]>,
    skipped: Set<string>,
    traceSession: TraceSession,
    sseSubject?: Subject<any>,
  ) {
    if (skipped.has(nodeId)) return;
    skipped.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (node) {
      const step = await this.traceService.startStep(traceSession, node, {
        reason: 'condition_branch_not_selected',
      });
      await this.traceService.finishStep(traceSession, step, 'skipped', {
        reason: 'condition_branch_not_selected',
      });
      this.emit(sseSubject, 'step_skipped', {
        runId: traceSession.runId,
        stepId: step.id,
        nodeId,
        nodeType: node.type,
        status: 'skipped',
      });
    }
    sseSubject?.next({ type: 'node_status', data: { nodeId, status: 'skipped' } });

    const downstream = adjList.get(nodeId) || [];
    for (const edge of downstream) {
      await this.skipBranch(edge.target, nodeMap, adjList, skipped, traceSession, sseSubject);
    }
  }

  private async recordNodeSpecificTrace(
    traceSession: TraceSession,
    traceStep: TraceStep,
    node: any,
    output: Record<string, any>,
    sseSubject?: Subject<any>,
  ) {
    if (node.type === 'rag') {
      const payload = {
        nodeId: node.id,
        knowledgeBaseId: node.data?.knowledgeBaseId,
        query: node.data?.query,
        topK: node.data?.topK,
        similarityThreshold: node.data?.similarityThreshold,
        documents: output?.documents || [],
      };
      await this.traceService.recordEvent(traceSession, 'rag_retrieval', payload, traceStep.id);
      this.emit(sseSubject, 'rag_retrieval', {
        runId: traceSession.runId,
        stepId: traceStep.id,
        ...payload,
      });
    }

    if (node.type === 'skill') {
      const toolResult = output?.result;
      const payload = {
        nodeId: node.id,
        skillId: node.data?.skillId,
        input: toolResult?.input || node.data?.parameters || {},
        tool: toolResult?.tool,
        output,
        duration: toolResult?.duration,
      };
      await this.traceService.recordEvent(traceSession, 'tool_call', payload, traceStep.id);
      this.emit(sseSubject, 'tool_call', {
        runId: traceSession.runId,
        stepId: traceStep.id,
        ...payload,
      });
    }
  }

  private emit(sseSubject: Subject<any> | undefined, type: string, data: Record<string, any>) {
    sseSubject?.next({ type, data });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
