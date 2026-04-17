const BASE = 'https://api.notion.com/v1';
const TOKEN = process.env.NOTION_TOKEN;

function notionHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${TOKEN ?? ''}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

export async function queryDatabase(
  databaseId: string,
  filter?: object,
  sorts?: object[]
): Promise<Record<string, unknown>[]> {
  if (!TOKEN) {
    throw new Error('NOTION_TOKEN not set');
  }

  const body: Record<string, unknown> = { page_size: 100 };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const res = await fetch(`${BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return (data.results ?? []) as Record<string, unknown>[];
}

// Helper to safely extract a Notion property value
export function getProp(
  page: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const props = page.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  return (props[key] as Record<string, unknown>) ?? null;
}

export function getNumber(page: Record<string, unknown>, key: string): number {
  const prop = getProp(page, key);
  if (!prop) return 0;
  return (prop.number as number) ?? 0;
}

export function getText(page: Record<string, unknown>, key: string): string {
  const prop = getProp(page, key);
  if (!prop) return '';
  // title or rich_text
  const arr =
    (prop.title as Array<{ plain_text: string }>) ??
    (prop.rich_text as Array<{ plain_text: string }>) ??
    [];
  return arr.map((t) => t.plain_text).join('');
}

export function getSelect(page: Record<string, unknown>, key: string): string {
  const prop = getProp(page, key);
  if (!prop) return '';
  const sel = prop.select as { name: string } | null;
  return sel?.name ?? '';
}

export function getDate(page: Record<string, unknown>, key: string): string | null {
  const prop = getProp(page, key);
  if (!prop) return null;
  const d = prop.date as { start?: string; end?: string } | null;
  return d?.start ?? null;
}

export function getFormula(page: Record<string, unknown>, key: string): number {
  const prop = getProp(page, key);
  if (!prop) return 0;
  const formula = prop.formula as { type?: string; number?: number; string?: string } | undefined;
  if (formula?.type === 'number') return formula.number ?? 0;
  if (formula?.type === 'string' && formula.string) return parseFloat(formula.string) || 0;
  return formula?.number ?? 0;
}
