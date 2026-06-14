const entries = new Map();
const pending = new Map();

export async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const existing = entries.get(key);
  if (existing?.expiresAt > now) return existing.value;
  if (pending.has(key)) return pending.get(key);
  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (entries.size > 500) {
        for (const [entryKey, entry] of entries) {
          if (entry.expiresAt <= now) entries.delete(entryKey);
        }
      }
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  try {
    return await request;
  } catch (error) {
    if (existing) {
      return existing.value;
    }
    throw error;
  }
}
