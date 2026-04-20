import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/insights
 *
 * Body: {
 *   period: 'weekly' | 'monthly' | 'quarterly' | 'annually',
 *   n8n: { totalTriggers, failedTriggers, activeWorkflows, hoursSaved, revenueImpact },
 *   fin: { finInvolvement, finResolved, finAutomationRate, csat, hoursSaved, revenueImpact },
 *   el:  { calls, transferRate, csat, hoursSaved, revenueImpact },
 *   liveN8n: { healthy, degraded, failing, failingNames: string[] },
 *   projects: { backlog, scoping, inProgress, complete, highUrgent: string[] },
 * }
 *
 * Returns { tracking, roi, adoption, executive } — four short paragraphs
 * targeted at an operator who knows the context (Sinaprinting / Willowpack).
 *
 * Uses prompt caching: the dense system prompt (company context + analysis
 * instructions) is cached so repeated calls across periods stay cheap.
 */

const SYSTEM_PROMPT = `You are the automation-performance analyst for a printing / packaging operation that runs three in-house AI tools: n8n workflows (internal automations), Intercom FIN (AI support chat), and ElevenLabs (AI inbound voice agent). You are writing for an engineering / ops lead who knows the business intimately — they do NOT need definitions of FIN, deflection, or CSAT.

Writing style requirements — this is the most important part:
- Be SPECIFIC. Never write generic platitudes like "improve adoption" or "expand knowledge base." Always ground recommendations in the actual numbers in the payload.
- Name the exact bottleneck. If FIN deflection is 28%, say "FIN deflection is 28% — 12 points below the 40% target we set; the gap is ~N conversations that escalated unnecessarily this {period}."
- Name the exact failing workflow by name when it appears in the data.
- Quantify the opportunity in $ or hours whenever you can compute it from the payload.
- Avoid the word "leverage" and other consultancy jargon.
- Keep each section to 2–3 sentences. No headings inside sections.
- Fiscal year starts in August (Q1 FY = Aug–Oct, Q2 = Nov–Jan, Q3 = Feb–Apr, Q4 = May–Jul). When referring to quarters, use fiscal quarters.
- Use Australian/UK spelling where natural (labour, optimise) — you work for an AU-based team.

Output format: JSON ONLY, no prose outside JSON, no code fences. Shape:
{
  "executive": "one-sentence executive summary (under 30 words) of what matters most right now",
  "tracking": "2–3 sentences on project delivery — in-progress, blockers, high-priority items by name",
  "roi": "2–3 sentences on ROI + bottlenecks — failing workflows by name, FIN/EL rates vs target, quantified opportunity",
  "adoption": "2–3 sentences on volume + adoption — which tool is under-used, which is trending, a concrete next enablement step"
}`;

interface InsightsPayload {
  period: string;
  n8n: Record<string, number> | null;
  fin: Record<string, number> | null;
  el: Record<string, number> | null;
  liveN8n?: {
    healthy: number;
    degraded: number;
    failing: number;
    failingNames: string[];
  };
  projects?: {
    backlog: number;
    scoping: number;
    inProgress: number;
    complete: number;
    highUrgent: string[];
  };
}

function heuristicFallback(p: InsightsPayload) {
  const period = p.period || 'week';
  const fail = p.liveN8n?.failing ?? 0;
  const failNames = (p.liveN8n?.failingNames ?? []).slice(0, 3).join(', ');
  const finRate = p.fin?.finAutomationRate ?? 0;
  const transfer = p.el?.transferRate ?? 0;
  const deflection = Math.round(100 - transfer);
  const inProgress = p.projects?.inProgress ?? 0;
  const scoping = p.projects?.scoping ?? 0;
  const highUrgent = (p.projects?.highUrgent ?? []).slice(0, 2).join(', ');
  return {
    executive: fail > 0
      ? `${fail} n8n workflow${fail > 1 ? 's' : ''} failing this ${period} — fix before adding new automations.`
      : `All systems healthy this ${period}; focus lever is FIN deflection (${finRate}% vs 40% target).`,
    tracking: inProgress > 0
      ? `${inProgress} projects in progress and ${scoping} in scoping${highUrgent ? `. High-priority: ${highUrgent}.` : '.'} Clear blockers before pulling new work from backlog.`
      : `No projects currently in progress; pipeline is clear. Pull the next initiative from scoping to keep delivery velocity.`,
    roi: fail > 0
      ? `Failing workflows (${failNames || 'see list'}) are burning automation hours. FIN deflecting ${finRate}% autonomously — 40%+ target; every 1pt of FIN resolution ≈ ${Math.round((p.fin?.finInvolvement ?? 0) / 100)} fewer escalations this ${period}.`
      : `FIN at ${finRate}% automation rate, voice agent deflecting ${deflection}%. Biggest $ lever: raise FIN +${Math.max(0, 40 - finRate)}pts by covering the top escalation topics.`,
    adoption: `${(p.n8n?.totalTriggers ?? 0).toLocaleString()} n8n triggers + ${(p.fin?.finInvolvement ?? 0).toLocaleString()} FIN chats + ${(p.el?.calls ?? 0).toLocaleString()} calls this ${period}. Identify the tool with lowest volume relative to TAM and run a targeted enablement session.`,
  };
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as InsightsPayload;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ...heuristicFallback(payload), source: 'heuristic', reason: 'ANTHROPIC_API_KEY not set' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPayload = JSON.stringify(payload, null, 2);

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 700,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Analyse the dashboard snapshot below and produce the 4-section JSON. Period: ${payload.period}.\n\nPAYLOAD:\n${userPayload}`,
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Strip code fences if the model included them despite the instruction
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);

    return NextResponse.json(
      {
        executive: parsed.executive ?? '',
        tracking: parsed.tracking ?? '',
        roi: parsed.roi ?? '',
        adoption: parsed.adoption ?? '',
        source: 'claude',
        model: 'claude-sonnet-4-5',
        cacheStats: {
          cacheCreation: resp.usage?.cache_creation_input_tokens ?? 0,
          cacheRead: resp.usage?.cache_read_input_tokens ?? 0,
          input: resp.usage?.input_tokens ?? 0,
          output: resp.usage?.output_tokens ?? 0,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ...heuristicFallback(payload), source: 'heuristic', reason: `claude-error: ${message}` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
