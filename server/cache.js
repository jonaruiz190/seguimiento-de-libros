const entries = new Map();

export async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const existing = entries.get(key);
  if (existing?.expiresAt > now) return existing.value;
  const value = await loader();
  entries.set(key, { value, expiresAt: now + ttlMs });
  if (entries.size > 500) {
    for (const [entryKey, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(entryKey);
    }
  }
  return value;
}
