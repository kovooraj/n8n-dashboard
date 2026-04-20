/**
 * Tiny in-memory TTL cache for hot route handlers.
 *
 * Next.js keeps module state alive across warm serverless invocations, so this
 * materially reduces load on upstream APIs (Intercom, ElevenLabs) when the
 * dashboard refreshes. Cold starts miss — that's fine.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export function createTTLCache<V>(ttlMs: number) {
  const map = new Map<string, Entry<V>>();

  return {
    get(key: string): V | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt < Date.now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V): void {
      map.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clear(): void {
      map.clear();
    },
  };
}
