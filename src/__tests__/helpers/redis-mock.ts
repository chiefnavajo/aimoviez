/**
 * Stateful Redis mock for lib unit tests.
 * Uses an in-memory Map to simulate Redis operations.
 * For API route tests, use createMockRedis from api-test-utils.ts instead.
 */

export function createStatefulRedisMock() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const sortedSets = new Map<string, Map<string, number>>();

  const mock = {
    // String operations
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string | number, opts?: { ex?: number }) => {
      store.set(key, String(value));
      if (opts?.ex) ttls.set(key, Date.now() + opts.ex * 1000);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
        sortedSets.delete(key);
      }
      return count;
    }),
    incr: jest.fn(async (key: string) => {
      const v = Number(store.get(key) || 0) + 1;
      store.set(key, String(v));
      return v;
    }),
    incrby: jest.fn(async (key: string, amount: number) => {
      const v = Number(store.get(key) || 0) + amount;
      store.set(key, String(v));
      return v;
    }),
    decr: jest.fn(async (key: string) => {
      const v = Number(store.get(key) || 0) - 1;
      store.set(key, String(v));
      return v;
    }),
    exists: jest.fn(async (key: string) => (store.has(key) || sortedSets.has(key)) ? 1 : 0),
    expire: jest.fn(async (key: string, seconds: number) => {
      ttls.set(key, Date.now() + seconds * 1000);
      return 1;
    }),
    ttl: jest.fn(async (key: string) => {
      const exp = ttls.get(key);
      if (!exp) return -1;
      return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
    }),

    // Hash operations
    hget: jest.fn(async (key: string, field: string) => {
      const obj = store.get(key);
      if (!obj) return null;
      try { return JSON.parse(obj)[field] ?? null; } catch { return null; }
    }),
    hset: jest.fn(async (key: string, field: string, value: string) => {
      const existing = store.get(key);
      const obj = existing ? JSON.parse(existing) : {};
      obj[field] = value;
      store.set(key, JSON.stringify(obj));
      return 1;
    }),
    hdel: jest.fn(async (key: string, field: string) => {
      const existing = store.get(key);
      if (!existing) return 0;
      const obj = JSON.parse(existing);
      if (!(field in obj)) return 0;
      delete obj[field];
      store.set(key, JSON.stringify(obj));
      return 1;
    }),
    hgetall: jest.fn(async (key: string) => {
      const existing = store.get(key);
      if (!existing) return null;
      try { return JSON.parse(existing); } catch { return null; }
    }),

    // Sorted set operations
    zadd: jest.fn(async (key: string, opts: { score: number; member: string } | Array<{ score: number; member: string }>) => {
      if (!sortedSets.has(key)) sortedSets.set(key, new Map());
      const zset = sortedSets.get(key)!;
      const items = Array.isArray(opts) ? opts : [opts];
      let added = 0;
      for (const item of items) {
        if (!zset.has(item.member)) added++;
        zset.set(item.member, item.score);
      }
      return added;
    }),
    zscore: jest.fn(async (key: string, member: string) => {
      return sortedSets.get(key)?.get(member) ?? null;
    }),
    zrange: jest.fn(async (key: string, start: number, stop: number) => {
      const zset = sortedSets.get(key);
      if (!zset) return [];
      const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end).map(([m]) => m);
    }),
    zrevrange: jest.fn(async (key: string, start: number, stop: number) => {
      const zset = sortedSets.get(key);
      if (!zset) return [];
      const sorted = [...zset.entries()].sort((a, b) => b[1] - a[1]);
      const end = stop === -1 ? sorted.length : stop + 1;
      return sorted.slice(start, end).map(([m]) => m);
    }),
    zrem: jest.fn(async (key: string, member: string) => {
      const removed = sortedSets.get(key)?.delete(member) ? 1 : 0;
      return removed;
    }),
    zcard: jest.fn(async (key: string) => sortedSets.get(key)?.size ?? 0),
    zrangebyscore: jest.fn(async (key: string, min: number, max: number) => {
      const zset = sortedSets.get(key);
      if (!zset) return [];
      return [...zset.entries()]
        .filter(([, score]) => score >= min && score <= max)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
    }),

    // Set operations
    sadd: jest.fn(async (key: string, ...members: string[]) => {
      const existing = store.get(key);
      const set = existing ? new Set(JSON.parse(existing)) : new Set();
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) { set.add(m); added++; }
      }
      store.set(key, JSON.stringify([...set]));
      return added;
    }),
    srem: jest.fn(async (key: string, ...members: string[]) => {
      const existing = store.get(key);
      if (!existing) return 0;
      const set = new Set(JSON.parse(existing));
      let removed = 0;
      for (const m of members) {
        if (set.delete(m)) removed++;
      }
      store.set(key, JSON.stringify([...set]));
      return removed;
    }),
    smembers: jest.fn(async (key: string) => {
      const existing = store.get(key);
      if (!existing) return [];
      try { return JSON.parse(existing); } catch { return []; }
    }),
    sismember: jest.fn(async (key: string, member: string) => {
      const existing = store.get(key);
      if (!existing) return 0;
      try { return JSON.parse(existing).includes(member) ? 1 : 0; } catch { return 0; }
    }),
    scard: jest.fn(async (key: string) => {
      const existing = store.get(key);
      if (!existing) return 0;
      try { return JSON.parse(existing).length; } catch { return 0; }
    }),

    // Pipeline
    pipeline: jest.fn(() => {
      const commands: Array<() => Promise<unknown>> = [];
      const pipe = {
        get: jest.fn((key: string) => { commands.push(() => mock.get(key)); return pipe; }),
        set: jest.fn((key: string, val: string) => { commands.push(() => mock.set(key, val)); return pipe; }),
        del: jest.fn((key: string) => { commands.push(() => mock.del(key)); return pipe; }),
        incr: jest.fn((key: string) => { commands.push(() => mock.incr(key)); return pipe; }),
        zadd: jest.fn((key: string, opts: { score: number; member: string }) => { commands.push(() => mock.zadd(key, opts)); return pipe; }),
        expire: jest.fn((key: string, s: number) => { commands.push(() => mock.expire(key, s)); return pipe; }),
        exec: jest.fn(async () => {
          const results = [];
          for (const cmd of commands) results.push(await cmd());
          return results;
        }),
      };
      return pipe;
    }),

    // Eval (Lua scripts - returns null by default, override per test)
    eval: jest.fn(async () => null),

    // Test inspection
    _store: store,
    _sortedSets: sortedSets,
    _ttls: ttls,
    _clear: () => { store.clear(); sortedSets.clear(); ttls.clear(); },
  };

  return mock;
}

export type StatefulRedisMock = ReturnType<typeof createStatefulRedisMock>;
