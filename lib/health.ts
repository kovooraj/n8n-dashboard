import type { N8nExecution, HealthStatus } from './types';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Health status rules (newest-first execution list):
 *
 *  FAILING  — The most recent execution failed AND every execution since the
 *             last successful run has also failed (i.e. no recovery yet).
 *             Shown as RED "Failing".
 *
 *  DEGRADED — There was at least one failure in the 5-day window, but the
 *             most recent execution succeeded — the workflow has recovered.
 *             Shown as YELLOW "Warning".
 *
 *  HEALTHY  — All executions in the last 5 days were successful.
 *             Shown as GREEN "Healthy".
 *
 *  UNKNOWN  — No completed executions found to evaluate.
 */
export function deriveHealth(executions: N8nExecution[]): HealthStatus {
  const fiveDaysAgo = Date.now() - FIVE_DAYS_MS;

  // Only consider completed executions (exclude running/waiting)
  const completed = executions.filter(
    (e) => e.status === 'success' || e.status === 'error' || e.status === 'crashed',
  );

  if (completed.length === 0) return 'unknown';

  // Narrow to executions within the last 5 days
  const recent = completed.filter(
    (e) => e.startedAt && new Date(e.startedAt).getTime() >= fiveDaysAgo,
  );

  // Fall back to all completed executions if none fall in the window
  const window = recent.length > 0 ? recent : completed;

  const mostRecent = window[0]; // executions are ordered newest → oldest
  const mostRecentFailed =
    mostRecent.status === 'error' || mostRecent.status === 'crashed';

  if (mostRecentFailed) {
    // Most recent failed → currently broken (Failing / RED)
    return 'failing';
  }

  const anyFailure = window.some(
    (e) => e.status === 'error' || e.status === 'crashed',
  );

  if (anyFailure) {
    // Most recent succeeded, but a failure exists in the window → recovered (Warning / YELLOW)
    return 'degraded';
  }

  return 'healthy';
}

export function calcSuccessRate(executions: N8nExecution[]): number | null {
  const completed = executions.filter(
    (e) => e.status === 'success' || e.status === 'error' || e.status === 'crashed',
  );
  if (completed.length === 0) return null;
  const successes = completed.filter((e) => e.status === 'success').length;
  return Math.round((successes / completed.length) * 1000) / 10;
}

/** Returns true if the workflow had any failure in the last 24 hours. */
export function hadFailureInLast24h(executions: N8nExecution[]): boolean {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return executions.some(
    (e) =>
      (e.status === 'error' || e.status === 'crashed') &&
      e.startedAt &&
      new Date(e.startedAt).getTime() >= cutoff,
  );
}
