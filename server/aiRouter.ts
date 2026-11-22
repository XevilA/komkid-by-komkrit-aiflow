// ============================================================================
// AI FAILOVER ENGINE — circuit breaker + automatic provider switching
//
// Pure, dependency-free logic (no network, no DB) so it can be unit-tested.
// The glue that talks to real providers lives in aiEngine.ts.
// ============================================================================

export type FailureKind =
  | 'config' // key not configured — never counted against provider health
  | 'auth' // invalid / revoked key, permission denied
  | 'billing' // quota exhausted, insufficient credit
  | 'rate' // 429 / rate limited
  | 'transient' // 5xx, overload, timeout, network
  | 'output' // empty / unparsable / failed validation (model-level, not provider-level)
  | 'other';

export interface AttemptSpec {
  provider: string;
  /** 'economy' = cheapest capable model class, 'standard' = configured/latest model */
  tier: 'economy' | 'standard';
}

export interface AttemptLog {
  provider: string;
  tier: string;
  ok: boolean;
  error?: string;
  kind?: FailureKind;
  latencyMs: number;
  skippedCooldown?: boolean;
}

export interface ProviderHealth {
  provider: string;
  consecutiveFailures: number;
  openUntil: number; // epoch ms; 0 = closed
  lastError: string;
  lastKind: FailureKind | '';
  lastErrorAt: number;
  lastOkAt: number;
  totalCalls: number;
  totalFailures: number;
}

const SEC = 1000;

export function classifyError(rawMessage: string): FailureKind {
  const m = String(rawMessage || '');
  if (/ยังไม่ได้ใส่|ยังไม่ได้ตั้งค่า|no api key|api key (is )?(missing|not set)/i.test(m)) {
    return 'config';
  }
  if (
    /insufficient[_ ]quota|billing|credit balance|out of credit|payment required|\b402\b|exceeded your current quota|account.*(suspended|disabled|deactivated)/i.test(
      m
    )
  ) {
    return 'billing';
  }
  if (
    /\b401\b|\b403\b|unauthori[sz]ed|invalid[^a-z]*(x-?api-?)?key|incorrect api key|api key not valid|authentication|permission[_ ]denied|forbidden/i.test(
      m
    )
  ) {
    return 'auth';
  }
  if (/\b429\b|rate[ _-]?limit|too many requests|resource[_ ]exhausted|quota/i.test(m)) {
    return 'rate';
  }
  if (
    /\b5\d\d\b|overload|unavailable|timed? ?out|timeout|etimedout|econn|enotfound|eai_again|fetch failed|network|socket|temporar|capacity|busy|bad gateway|gateway|error occurred while processing|had an error|internal (server )?error|please (try|retry)|you can retry|request id/i.test(
      m
    )
  ) {
    return 'transient';
  }
  if (
    /ไม่ใช่รูปแบบ json|ตอบกลับเป็นค่าว่าง|ไม่ได้ส่งข้อความ|ปฏิเสธคำขอ|validation|ผลลัพธ์ไม่ครบ/i.test(m)
  ) {
    return 'output';
  }
  return 'other';
}

// --- Breaker state (per process) --------------------------------------------
const health = new Map<string, ProviderHealth>();

function ensure(provider: string): ProviderHealth {
  let h = health.get(provider);
  if (!h) {
    h = {
      provider,
      consecutiveFailures: 0,
      openUntil: 0,
      lastError: '',
      lastKind: '',
      lastErrorAt: 0,
      lastOkAt: 0,
      totalCalls: 0,
      totalFailures: 0,
    };
    health.set(provider, h);
  }
  return h;
}

export function getHealthSnapshot(): ProviderHealth[] {
  return Array.from(health.values()).map((h) => ({ ...h }));
}

export function getProviderHealth(provider: string): ProviderHealth {
  return { ...ensure(provider) };
}

export function resetHealth(provider?: string) {
  if (provider) health.delete(provider);
  else health.clear();
}

export function isCoolingDown(provider: string, now = Date.now()): boolean {
  return ensure(provider).openUntil > now;
}

export function recordSuccess(provider: string, now = Date.now()) {
  const h = ensure(provider);
  h.totalCalls += 1;
  h.consecutiveFailures = 0;
  h.openUntil = 0;
  h.lastOkAt = now;
}

/** Cooldown policy: hard failures open the breaker immediately, soft ones after repeats. */
export function recordFailure(
  provider: string,
  kind: FailureKind,
  message: string,
  now = Date.now()
) {
  if (kind === 'config') return; // not a health signal
  const h = ensure(provider);
  h.totalCalls += 1;
  h.totalFailures += 1;
  h.lastError = String(message || '').slice(0, 300);
  h.lastKind = kind;
  h.lastErrorAt = now;

  if (kind === 'output') {
    // The model produced something unusable; the provider itself is reachable.
    return;
  }
  h.consecutiveFailures += 1;
  const n = h.consecutiveFailures;
  let cooldownMs = 0;

  if (kind === 'billing') cooldownMs = 30 * 60 * SEC;
  else if (kind === 'auth') cooldownMs = 15 * 60 * SEC;
  else if (kind === 'rate') cooldownMs = Math.min(10 * 60 * SEC, 60 * SEC * 2 ** (n - 1));
  else if (kind === 'transient' && n >= 2) {
    cooldownMs = Math.min(5 * 60 * SEC, 30 * SEC * 2 ** (n - 2));
  } else if (kind === 'other' && n >= 3) {
    cooldownMs = Math.min(5 * 60 * SEC, 30 * SEC * 2 ** (n - 3));
  }
  if (cooldownMs > 0) h.openUntil = Math.max(h.openUntil, now + cooldownMs);
}

// --- Runner -----------------------------------------------------------------
export interface FailoverOptions<T> {
  attempts: AttemptSpec[];
  call: (a: AttemptSpec) => Promise<T>;
  /** Throw to reject a result (e.g. bad JSON) and fail over to the next attempt. */
  validate?: (result: T, a: AttemptSpec) => void;
  /** Per-attempt hard timeout. */
  timeoutMs?: number;
  /** Overall wall-clock budget across all attempts (e.g. serverless limit). */
  totalBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class AllProvidersFailedError extends Error {
  attempts: AttemptLog[];
  constructor(message: string, attempts: AttemptLog[]) {
    super(message);
    this.name = 'AllProvidersFailedError';
    this.attempts = attempts;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout หลังรอ ${Math.round(ms / 1000)} วินาที`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function runWithFailover<T>(
  opts: FailoverOptions<T>
): Promise<{ result: T; spec: AttemptSpec; attempts: AttemptLog[] }> {
  const now = opts.now || Date.now;
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = now();

  // Healthy providers first (original order kept); cooling-down ones are a last resort,
  // soonest-to-recover first.
  const ready: AttemptSpec[] = [];
  const cooling: AttemptSpec[] = [];
  for (const a of opts.attempts) {
    (isCoolingDown(a.provider, now()) ? cooling : ready).push(a);
  }
  cooling.sort((a, b) => ensure(a.provider).openUntil - ensure(b.provider).openUntil);
  const ordered = [...ready, ...cooling];

  const logs: AttemptLog[] = [];
  const soleCandidate = new Set(ordered.map((a) => a.provider)).size === 1;

  for (const spec of ordered) {
    const remaining =
      opts.totalBudgetMs !== undefined ? opts.totalBudgetMs - (now() - startedAt) : Infinity;
    if (remaining < 3000 && logs.length > 0) {
      logs.push({
        provider: spec.provider,
        tier: spec.tier,
        ok: false,
        error: 'หมดเวลารวมของคำขอ ไม่ได้ลองค่ายนี้',
        kind: 'transient',
        latencyMs: 0,
      });
      break;
    }
    const perAttempt = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : Infinity;
    const timeoutMs = Math.min(perAttempt, remaining);
    const wasCooling = cooling.includes(spec);
    const tries = soleCandidate ? 3 : 1;

    for (let t = 0; t < tries; t++) {
      const t0 = now();
      try {
        const result = await withTimeout(
          opts.call(spec),
          Number.isFinite(timeoutMs) ? timeoutMs : 0,
          `${spec.provider}`
        );
        if (opts.validate) opts.validate(result, spec);
        recordSuccess(spec.provider, now());
        logs.push({
          provider: spec.provider,
          tier: spec.tier,
          ok: true,
          latencyMs: now() - t0,
          skippedCooldown: wasCooling,
        });
        return { result, spec, attempts: logs };
      } catch (err) {
        const msg = String((err as Error)?.message || err);
        const kind = classifyError(msg);
        recordFailure(spec.provider, kind, msg, now());
        logs.push({
          provider: spec.provider,
          tier: spec.tier,
          ok: false,
          error: msg.slice(0, 300),
          kind,
          latencyMs: now() - t0,
          skippedCooldown: wasCooling,
        });
        if (t + 1 < tries && (kind === 'transient' || kind === 'rate')) {
          await sleep(800 * (t + 1));
          continue;
        }
        break;
      }
    }
  }

  const summary = logs
    .filter((l) => !l.ok)
    .map((l) => `${l.provider}${l.tier === 'economy' ? '(economy)' : ''}: ${l.error}`)
    .join(' | ');
  throw new AllProvidersFailedError(
    logs.length === 0
      ? 'ยังไม่มี AI ค่ายใดที่ตั้งค่า API Key ไว้ — กรุณาเพิ่มคีย์อย่างน้อย 1 ค่ายในหน้าตั้งค่า'
      : `AI ทุกค่ายที่ลองล้มเหลว → ${summary}`,
    logs
  );
}
