// ── Existing N8N workflow types (preserved) ─────────────────────────────────
export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'crashed';
  startedAt: string;
  stoppedAt: string | null;
  mode: string;
}

export type HealthStatus = 'healthy' | 'degraded' | 'failing' | 'unknown';

export interface WorkflowHealthData {
  workflow: N8nWorkflow;
  executions: N8nExecution[];
  health: HealthStatus;
  successRate: number | null;
  lastRunAt: string | null;
  totalFetched: number;
  failureCount: number;
  runningCount: number;
}

export interface DashboardData {
  workflows: WorkflowHealthData[];
  fetchedAt: string;
  error?: string;
}

export type HistoryPeriod = 'week' | 'month' | 'quarter' | 'year';

export interface DailyBucket {
  date: string;
  total: number;
  success: number;
  error: number;
}

export interface HistoryData {
  period: HistoryPeriod;
  workflowId: string | null;
  buckets: DailyBucket[];
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  fetchedAt: string;
  error?: string;
}

// ── Dashboard period ─────────────────────────────────────────────────────────
export type DashboardPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annually';

// ── Notion snapshot types (period-aligned bucket payloads) ───────────────────
// Each snapshot now represents one period bucket (day/week/month). The
// `label` field is the short chart label (e.g. "Mon 13", "W15", "Apr"); the
// `weekLabel` is the longer human-readable form.
export interface N8NSnapshot {
  id: string;
  weekLabel: string;
  label?: string;
  start?: string;
  end?: string;
  count?: number;
  weekNumber?: number;
  quarter?: string;
  totalTriggers: number;
  failedTriggers: number;
  activeWorkflows: number;
  newWorkflows: number;
  hoursSaved: number;
  revenueImpact: number;
}

export interface FINSnapshot {
  id: string;
  weekLabel: string;
  label?: string;
  start?: string;
  end?: string;
  count?: number;
  finInvolvement: number;
  finResolved: number;
  finAutomationRate: number;
  csat: number;
  finProcedureUses?: number;
  activeFinProcedures?: number;
  hoursSaved: number;
  revenueImpact: number;
}

export interface ElevenLabsSnapshot {
  id: string;
  weekLabel: string;
  label?: string;
  start?: string;
  end?: string;
  count?: number;
  calls: number;
  avgDuration: number;
  transferRate: number;
  agents: number;
  csat?: number;
  hoursSaved: number;
  revenueImpact: number;
}

export interface N8NTotals {
  totalTriggers: number;
  failedTriggers: number;
  activeWorkflows: number;
  newWorkflows: number;
  hoursSaved: number;
  revenueImpact: number;
}

export interface FINTotals {
  finInvolvement: number;
  finResolved: number;
  finAutomationRate: number;
  csat: number;
  finProcedureUses: number;
  activeFinProcedures: number;
  hoursSaved: number;
  revenueImpact: number;
}

export interface ElevenLabsTotals {
  calls: number;
  avgDuration: number;
  transferRate: number;
  agents: number;
  csat: number;
  hoursSaved: number;
  revenueImpact: number;
}

// ── ClickUp task type ────────────────────────────────────────────────────────
export type TaskPlatform = 'n8n' | 'fin' | 'elevenlabs' | 'general';

export interface ClickUpTask {
  id: string;
  name: string;
  status: string;
  statusColor: string;
  url: string;
  assignees: string[];
  updatedAt: string;
  platform: TaskPlatform;
  priority: 'urgent' | 'high' | 'normal' | 'low' | null;
}

// ── Chart data points ────────────────────────────────────────────────────────
export interface ChartPoint {
  label: string;
  success: number;
  error: number;
}

export interface VolumePoint {
  label: string;
  total: number;
  resolved: number;
}

// ── Sidebar workflow item (extended with live stats) ─────────────────────────
export interface SidebarWorkflow {
  id: string;
  name: string;
  health: 'healthy' | 'degraded' | 'failing' | 'unknown';
  successRate?: number | null;
  lastRunAt?: string | null;
  failureCount?: number;
  runningCount?: number;
  executions?: N8nExecution[];
}
