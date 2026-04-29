import type { N8nExecution, HealthStatus } from './types';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Health status rules (newest-first execution list):
 *
 *  FAILING  — Most recent completed execution failed. The workflow is
 *             currently broken with no successful recovery run since.
 *
 *  WARNING  — Most recent completed execution succeeded, but at least one
 *             execution within the last 5 days failed. Transient error
 *             that the workflow recovered from.
 *
 *  HEALTHY  — Every execution in the last 5 days was successful (or there
 *             are no failures at all).
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
  // (e.g. a rarely-triggered workflow that last ran 6 days ago)
  const window = recent.length > 0 ? recent : completed;

  const mostRecent = window[0]; // executions are ordered newest → oldest
  const mostRecentFailed =
    mostRecent.status === 'error' || mostRecent.status === 'crashed';

  if (mostRecentFailed) {
    // Last run failed — currently broken
    return 'failing';
  }

  const anyFailure = window.some(
    (e) => e.status === 'error' || e.status === 'crashed',
  );

  if (anyFailure) {
    // Recovered: last run succeeded but there was a failure in the window
    return 'degraded'; // shown as "Warning" in the UI
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
