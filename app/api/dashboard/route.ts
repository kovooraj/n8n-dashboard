export const dynamic = 'force-dynamic';

import { fetchAllWorkflows, fetchExecutionsBatch } from '@/lib/n8n';
import { deriveHealth, calcSuccessRate } from '@/lib/health';
import type { DashboardData, WorkflowHealthData } from '@/lib/types';

export async function GET(): Promise<Response> {
  try {
    const allWorkflows = await fetchAllWorkflows();
    const activeWorkflows = allWorkflows.filter((w) => w.active);

    const executionMap = await fetchExecutionsBatch(
      activeWorkflows.map((w) => w.id),
      20
    );

    const workflows: WorkflowHealthData[] = activeWorkflows.map((wf) => {
      const executions = executionMap.get(wf.id) ?? [];
      const health = deriveHealth(executions);
      const successRate = calcSuccessRate(executions);
      const lastRunAt = executions[0]?.startedAt ?? null;
      const failureCount = executions.filter(
        (e) => e.status === 'error' || e.status === 'crashed'
      ).length;
      const runningCount = executions.filter(
        (e) => e.status === 'running' || e.status === 'waiting'
      ).length;

      return {
        workflow: wf,
        executions: executions.slice(0, 10),
        health,
        successRate,
        lastRunAt,
        totalFetched: executions.length,
        failureCount,
        runningCount,
      };
    });

    // Sort: failing first, then degraded, then healthy, then unknown
    const order = { failing: 0, degraded: 1, healthy: 2, unknown: 3 };
    workflows.sort((a, b) => order[a.health] - order[b.health]);

    const payload: DashboardData = {
      workflows,
      fetchedAt: new Date().toISOString(),
    };

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const payload: DashboardData = {
      workflows: [],
      fetchedAt: new Date().toISOString(),
      error: message,
    };
    return Response.json(payload, { status: 502 });
  }
}
