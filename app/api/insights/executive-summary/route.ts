import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { DashboardPeriod } from '@/lib/types';
import {
  aggregate,
  periodDateRange,
  previousPeriodDateRange,
  type RawSnapshot,
} from '@/lib/aggregate';
import { readSnapshots } from '@/lib/db-snapshots';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const revalidate = 0;

/**
 * POST /api/insights/executive-summary
 *
 * Generates a period-over-period executive summary by:
 *   1. Receiving the current period totals (already loaded by the dashboard).
 *   2. Reading previous-period snapshots from Supabase for n8n, FIN, ElevenLabs.
 *   3. Aggregating them with the same `aggregate()` pipeline used for current.
 *   4. Sending current + previous totals to Claude for a structured comparison.
 *
 * Returns:
 *   {
 *     executive: string,         // one-sentence headline
 *     overview: string,          // 2–3 sentence period-over-period summary
 *     improvements: string[],    // bullet list of wins
 *     regressions: string[],     // bullet list of declines
 *     drivers: string[],         // possible causes (2–4 bullets)
 *     recommendations: string[], // 2–4 actionable next steps
 *     currentTotals, previousTotals, currentWindow, previousWindow,
 *     period, source: 'claude' | 'heuristic'
 *   }
 */

const SYSTEM_PROMPT = `You are the automation-performance analyst writing an executive summary for the operations lead at a North-American printing / packaging company. Three in-house AI tools drive the metrics: n8n workflows (internal automations), Intercom FIN (AI support chat), and ElevenLabs (AI inbound voice agent).

Writing requirements:
- Be specific and quantitative. Cite real numbers from the payload (deltas in absolute and percentage terms).
- Identify the SINGLE biggest mover (positive or negative) and lead with it.
- For each "improvement" or "regression" bullet, include the metric, the change, and a one-line implication.
- "Drivers" should be plausible operational reasons (e.g. "new workflow X went live mid-{period}", "FIN knowledge base expanded", "support volume spike from email vs messenger"). Use the actual workflow / channel names from the payload where applicable.
- "Recommendations" must be concrete actions the team can take this week — never generic ("improve adoption" is forbidden).
- Fiscal year starts in August (Q1 FY = Aug–Oct, Q2 = Nov–Jan, Q3 = Feb–Apr, Q4 = May–Jul).
- Avoid the word "leverage" and other consultancy jargon.

CURRENCY: All dollar figures are USD. ALWAYS use the dollar sign ($) — NEVER use pound (£), euro (€), or any other currency symbol. Example: write "$16.5K", not "£16.5K".

LABEL: The revenueImpact field represents COST SAVINGS (labour cost avoided), not revenue earned. Refer to it as "cost savings" or "labour cost saved" — do not call it "revenue".

TEXT ENCODING: Use plain ASCII characters only — no curly quotes, no em/en dashes, no Unicode arrows. Use straight quotes ("), hyphens (-), and the word "to" or "->" for direction.

Output: JSON ONLY, no prose outside JSON, no code fences. Shape:
{
  "executive": "one-sentence headline (under 30 words) of what mattered most period-over-period",
  "overview": "2-3 sentences summarising the overall direction across all 3 platforms with specific deltas",
  "improvements": ["bullet 1", "bullet 2", "bullet 3"],
  "regressions": ["bullet 1", "bullet 2"],
  "drivers": ["plausible cause 1", "plausible cause 2", "plausible cause 3"],
  "recommendations": ["action 1", "action 2", "action 3"]
}

Limit each array to at most 5 items. Use empty arrays if a category genuinely has nothing meaningful.`;

interface PlatformTotals {
  totalTriggers?: number;
  successTriggers?: number;
  failedTriggers?: number;
  activeWorkflows?: number;
  hoursSaved?: number;
  revenueImpact?: number;
  // FIN
  finInvolvement?: number;
  finResolved?: number;
  finAutomationRate?: number;
  csat?: number;
  // ElevenLabs
  calls?: number;
  transferRate?: number;
  avgDuration?: number;
}

interface RequestPayload {
  period: DashboardPeriod;
  current: {
    n8n: PlatformTotals | null;
    fin: PlatformTotals | null;
    el:  PlatformTotals | null;
  };
}

// Aggregation rules mirror each route's own settings so the previous-period
// totals match what the live dashboard would compute.
const N8N_AGG = { totalTriggers: 'sum', failedTriggers: 'sum', hoursSaved: 'sum', revenueImpact: 'sum', activeWorkflows: 'last' } as const;
const FIN_AGG = { finInvolvement: 'sum', finResolved: 'sum', finAutomationRate: 'avg', csat: 'avg', hoursSaved: 'sum', revenueImpact: 'sum' } as const;
const EL_AGG  = { calls: 'sum', avgDuration: 'avg', transferRate: 'avg', agents: 'last', csat: 'avg', hoursSaved: 'sum', revenueImpact: 'sum' } as const;

async function readPreviousPeriodTotals(
  source: string,
  startDate: string,
  endDate: string,
  period: DashboardPeriod,
  aggRules: Record<string, 'sum' | 'avg' | 'last' | 'max' | 'min'>,
): Promise<Record<string, number>> {
  try {
    const snaps: RawSnapshot[] = await readSnapshots(source, startDate, endDate);
    if (snaps.length === 0) return {};
    // Use a `now` set to endDate so buildBucketRange's "current period" matches the historical window
    const end = new Date(`${endDate}T12:00:00Z`);
    const { totals } = aggregate(snaps, period, aggRules, end);
    return totals;
  } catch {
    return {};
  }
}

function pct(curr: number | undefined | null, prev: number | undefined | null): number | null {
  if (curr == null || prev == null) return null;
  if (prev === 0) return curr === 0 ? 0 : 100; // 0 → anything is "100% change"
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

// Decode the actual error reason into an actionable, user-facing line
function explainFailure(reason: string | undefined): { driver: string; recommendation: string } {
  if (!reason) return {
    driver: 'AI driver analysis unavailable (no Claude reason returned).',
    recommendation: 'Click Refresh and try again — if it persists, check Vercel logs for /api/insights/executive-summary.',
  };
  if (/credit balance is too low|insufficient_quota/i.test(reason)) return {
    driver: 'AI driver analysis unavailable — Anthropic credit balance is empty.',
    recommendation: 'Go to console.anthropic.com -> Plans & Billing and add credits (or enable auto-recharge). The dashboard will switch back to AI-generated analysis automatically on the next click.',
  };
  if (/ANTHROPIC_API_KEY not set/i.test(reason)) return {
    driver: 'AI driver analysis unavailable — ANTHROPIC_API_KEY is not configured.',
    recommendation: 'Add ANTHROPIC_API_KEY to your Vercel env vars (Settings -> Environment Variables) and redeploy.',
  };
  if (/rate.?limit|429/i.test(reason)) return {
    driver: 'AI driver analysis unavailable — Anthropic rate-limit hit.',
    recommendation: 'Wait 30-60 seconds and click Refresh. If it keeps happening you may need to upgrade your usage tier.',
  };
  if (/401|invalid.{0,20}api.?key|authentication/i.test(reason)) return {
    driver: 'AI driver analysis unavailable — Anthropic API key was rejected.',
    recommendation: 'The ANTHROPIC_API_KEY in Vercel is invalid or revoked. Generate a new one at console.anthropic.com -> API Keys and update the env var.',
  };
  // Unknown reason — surface it as-is, truncated
  return {
    driver: `AI driver analysis unavailable. Claude error: ${reason.slice(0, 160)}${reason.length > 160 ? '...' : ''}`,
    recommendation: 'Check Vercel logs for /api/insights/executive-summary or open Anthropic console for billing/key issues.',
  };
}

function heuristicFallback(
  period: DashboardPeriod,
  current: RequestPayload['current'],
  previous: { n8n: Record<string, number>; fin: Record<string, number>; el: Record<string, number> },
  reason?: string,
) {
  const n8nDelta  = pct(current.n8n?.totalTriggers ?? 0,  previous.n8n.totalTriggers  ?? 0);
  const finDelta  = pct(current.fin?.finInvolvement ?? 0, previous.fin.finInvolvement ?? 0);
  const elDelta   = pct(current.el?.calls ?? 0,           previous.el.calls           ?? 0);
  const hoursDelta = pct(
    (current.n8n?.hoursSaved ?? 0) + (current.fin?.hoursSaved ?? 0) + (current.el?.hoursSaved ?? 0),
    (previous.n8n.hoursSaved ?? 0) + (previous.fin.hoursSaved ?? 0) + (previous.el.hoursSaved ?? 0),
  );
  const improvements: string[] = [];
  const regressions: string[] = [];
  if (n8nDelta != null && n8nDelta > 0) improvements.push(`n8n triggers up ${n8nDelta}% period-over-period.`);
  if (n8nDelta != null && n8nDelta < 0) regressions.push(`n8n triggers down ${Math.abs(n8nDelta)}% period-over-period.`);
  if (finDelta != null && finDelta > 0) improvements.push(`FIN volume up ${finDelta}%.`);
  if (finDelta != null && finDelta < 0) regressions.push(`FIN volume down ${Math.abs(finDelta)}%.`);
  if (elDelta  != null && elDelta  > 0) improvements.push(`ElevenLabs calls up ${elDelta}%.`);
  if (elDelta  != null && elDelta  < 0) regressions.push(`ElevenLabs calls down ${Math.abs(elDelta)}%.`);

  const { driver, recommendation } = explainFailure(reason);
  return {
    executive: hoursDelta != null
      ? `Total hours saved ${hoursDelta >= 0 ? 'up' : 'down'} ${Math.abs(hoursDelta)}% vs previous ${period}.`
      : `Period-over-period summary generated heuristically.`,
    overview: `Compared to the previous ${period}: ${improvements.concat(regressions).slice(0, 3).join(' ')}`.trim(),
    improvements,
    regressions,
    drivers: [driver],
    recommendations: [recommendation],
  };
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as RequestPayload | null;
  if (!payload || !payload.period) {
    return NextResponse.json({ error: 'Missing period in request body' }, { status: 400 });
  }

  const period = payload.period;
  const currentWindow  = periodDateRange(period);
  const previousWindow = previousPeriodDateRange(period);

  // Fetch previous period totals from Supabase for the 3 platforms with DB snapshots
  const [prevN8n, prevFin, prevEl] = await Promise.all([
    readPreviousPeriodTotals('n8n-history',      previousWindow.startDate, previousWindow.endDate, period, N8N_AGG),
    readPreviousPeriodTotals('intercom-fin',     previousWindow.startDate, previousWindow.endDate, period, FIN_AGG),
    readPreviousPeriodTotals('elevenlabs-calls', previousWindow.startDate, previousWindow.endDate, period, EL_AGG),
  ]);

  const previous = { n8n: prevN8n, fin: prevFin, el: prevEl };
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Common response wrapper that always includes the data the PDF needs
  const wrap = (body: object, source: 'claude' | 'heuristic', reason?: string) =>
    NextResponse.json(
      {
        ...body,
        currentTotals: payload.current,
        previousTotals: previous,
        currentWindow,
        previousWindow,
        period,
        source,
        ...(reason ? { reason } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );

  if (!apiKey) {
    return wrap(heuristicFallback(period, payload.current, previous, 'ANTHROPIC_API_KEY not set'), 'heuristic', 'ANTHROPIC_API_KEY not set');
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPayload = JSON.stringify(
      {
        period,
        current: payload.current,
        previous,
        currentWindow,
        previousWindow,
      },
      null,
      2,
    );

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: `Compare the two ${period} snapshots below and produce the executive-summary JSON.\n\nDATA:\n${userPayload}`,
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);

    return wrap(
      {
        executive:       parsed.executive       ?? '',
        overview:        parsed.overview        ?? '',
        improvements:    Array.isArray(parsed.improvements)    ? parsed.improvements    : [],
        regressions:     Array.isArray(parsed.regressions)     ? parsed.regressions     : [],
        drivers:         Array.isArray(parsed.drivers)         ? parsed.drivers         : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        model: 'claude-sonnet-4-5',
        cacheStats: {
          cacheCreation: resp.usage?.cache_creation_input_tokens ?? 0,
          cacheRead:     resp.usage?.cache_read_input_tokens     ?? 0,
          input:         resp.usage?.input_tokens                ?? 0,
          output:        resp.usage?.output_tokens               ?? 0,
        },
      },
      'claude',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return wrap(heuristicFallback(period, payload.current, previous, `claude-error: ${message}`), 'heuristic', `claude-error: ${message}`);
  }
}
