// Wrapper minimale su Upstash Redis (serverless-friendly, via REST HTTP).
//
// Se le env UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN sono impostate,
// kvEnabled è true e tutto lo stato (slot.svg, contatori, cache repo) viene
// servito/scratchato da Redis in ~10ms same-region, eliminando i commit-per-spin
// su GitHub e le race condition da SHA stale.
//
// Se le env NON sono impostate (es. `vercel dev` in locale senza Redis) kvEnabled
// è false e i singoli moduli applicano un fallback su GitHub Contents API, così
// il progetto resta funzionante anche senza Redis.

import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvEnabled = Boolean(url && token);

export const kv = kvEnabled
  ? new Redis({ url, token })
  : null;
