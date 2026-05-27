import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Single entry point for AI text generation across the dashboard.
 *
 * Provider order: Claude (Anthropic) -> OpenAI (gpt-4o-mini) -> heuristic.
 *
 * - Claude is preferred when ANTHROPIC_API_KEY is set and has credits.
 * - On any Claude failure (no key, billing empty, rate limit, etc.) we
 *   automatically retry with OpenAI if OPENAI_API_KEY is set.
 * - If both providers fail, the caller falls back to a heuristic.
 *
 * Both providers are asked for JSON-only responses. We strip code fences
 * defensively in case a model wraps the output despite the instruction.
 */

export type AIProvider = 'claude' | 'openai';

export interface GenerateOptions {
  /** Cached on Claude (ephemeral). Sent verbatim to OpenAI's `system` role. */
  systemPrompt: string;
  /** User-content payload. */
  userPrompt: string;
  /** Max tokens to return. Defaults to 1500. */
  maxTokens?: number;
  /** Preferred provider order. Default ['claude', 'openai']. */
  preferOrder?: AIProvider[];
}

export interface GenerateResult {
  /** Provider that actually succeeded. */
  source: AIProvider;
  /** Model name used. */
  model: string;
  /** Parsed JSON object. */
  json: Record<string, unknown>;
  /** Reasons each upstream provider failed (in attempted order). Empty if Claude succeeded first. */
  attemptErrors: Array<{ provider: AIProvider; reason: string }>;
  /** Token usage if returned by the provider. */
  usage?: {
    input?: number;
    output?: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

async function tryClaude(opts: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const model = 'claude-sonnet-4-5';
  const resp = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1500,
    system: [
      { type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: opts.userPrompt }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const json = JSON.parse(stripCodeFences(text)) as Record<string, unknown>;

  return {
    source: 'claude',
    model,
    json,
    attemptErrors: [],
    usage: {
      input: resp.usage?.input_tokens ?? 0,
      output: resp.usage?.output_tokens ?? 0,
      cacheCreation: resp.usage?.cache_creation_input_tokens ?? 0,
      cacheRead: resp.usage?.cache_read_input_tokens ?? 0,
    },
  };
}

async function tryOpenAI(opts: GenerateOptions): Promise<GenerateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 1500,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user',   content: opts.userPrompt },
      ],
      // Force valid JSON — works on gpt-4o, gpt-4o-mini, and later.
      response_format: { type: 'json_object' },
    }),
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenAI ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? '';
  const json = JSON.parse(stripCodeFences(text)) as Record<string, unknown>;

  return {
    source: 'openai',
    model,
    json,
    attemptErrors: [],
    usage: {
      input:  data.usage?.prompt_tokens     ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Generate JSON from the AI, with automatic fallback Claude -> OpenAI.
 * Throws only if every configured provider fails — caller should use a
 * heuristic in that case.
 */
export async function generateInsightsJSON(opts: GenerateOptions): Promise<GenerateResult> {
  const order: AIProvider[] = opts.preferOrder ?? ['claude', 'openai'];
  const errors: Array<{ provider: AIProvider; reason: string }> = [];

  for (const provider of order) {
    try {
      const result = provider === 'claude' ? await tryClaude(opts) : await tryOpenAI(opts);
      return { ...result, attemptErrors: errors };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({ provider, reason });
      // Continue to next provider
    }
  }

  // All providers failed
  const lastReason = errors[errors.length - 1]?.reason ?? 'unknown';
  const summary = errors.map((e) => `${e.provider}: ${e.reason.slice(0, 100)}`).join(' | ');
  const err: Error & { allFailures?: typeof errors } = new Error(`All AI providers failed. ${summary}. Last: ${lastReason}`);
  err.allFailures = errors;
  throw err;
}
