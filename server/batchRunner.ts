// ============================================================================
// BATCH RUNNER — run many multi-agent campaigns as cheaply as possible
//
// Savings levers (all real, none simulated):
//  1. Response cache       identical request -> reused, costs nothing
//  2. Economy tier         cost-efficient model class first, escalate to the full model only on failure
//  3. Prompt-cache layout  one shared Knowledge Base + static system prompt for the whole batch;
//                          first item runs alone to warm the vendor prompt cache, the rest reuse it
//  4. Cheapest-first provider order (ai_economy_order) with automatic failover
//  5. Duplicate topics removed, circuit-stop after repeated failures so a broken batch doesn't burn money
// State lives in SQLite, so a batch survives restarts and can be driven in short slices on serverless.
// ============================================================================
import { db, IS_SERVERLESS } from './db.ts';
import {
  executeMultiAgentWorkflow,
  getActiveKnowledgeContext,
  type LlmProviderId,
} from './aiEngine.ts';
import { createWorkflowRecord } from './workflowStore.ts';

export type BatchMode = 'economy' | 'standard';

export interface BatchOptions {
  mode: BatchMode;
  concurrency: number;
  category: string;
  inputSource: string;
  targetAudience: string;
  businessPillar: string;
  flowMode: 'core_3agent' | 'full_8agent';
  provider?: LlmProviderId;
  autoGenerateCoverImage?: boolean;
}

export const MAX_BATCH_ITEMS = 50;
const MAX_TOPIC_LEN = 300;
const STOP_AFTER_CONSECUTIVE_FAILURES = 3;
const STUCK_RUNNING_MS = 10 * 60 * 1000;

const running = new Set<number>();

function nowIso() {
  return new Date().toISOString();
}

export function normalizeTopics(raw: unknown): { topics: string[]; duplicates: number } {
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x ?? ''))
    : String(raw ?? '').split(/\r?\n/);
  const seen = new Set<string>();
  const topics: string[] = [];
  let duplicates = 0;
  for (const t of list) {
    const clean = t.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    topics.push(clean);
  }
  return { topics, duplicates };
}

export function createBatch(input: {
  name?: string;
  topics: unknown;
  options?: Partial<BatchOptions>;
}): { id: number; duplicates: number } {
  const { topics, duplicates } = normalizeTopics(input.topics);
  if (topics.length === 0) throw new Error('กรุณาใส่หัวข้ออย่างน้อย 1 หัวข้อ (หนึ่งบรรทัดต่อหนึ่งหัวข้อ)');
  if (topics.length > MAX_BATCH_ITEMS) {
    throw new Error(`รันได้สูงสุด ${MAX_BATCH_ITEMS} หัวข้อต่อหนึ่ง Batch (ตอนนี้ ${topics.length})`);
  }
  const tooLong = topics.find((t) => t.length > MAX_TOPIC_LEN);
  if (tooLong) throw new Error(`หัวข้อยาวเกิน ${MAX_TOPIC_LEN} ตัวอักษร: "${tooLong.slice(0, 40)}…"`);

  const o = input.options || {};
  const options: BatchOptions = {
    mode: o.mode === 'standard' ? 'standard' : 'economy',
    concurrency: Math.max(1, Math.min(5, Math.floor(Number(o.concurrency) || 3))),
    category: String(o.category || 'ai-tech'),
    inputSource: String(o.inputSource || 'แนวโน้มการศึกษา (Trend & Research)'),
    targetAudience: String(o.targetAudience || 'ครู / บุคลากรทางการศึกษา'),
    businessPillar: String(o.businessPillar || '1. VIEWS | ยอดวิว'),
    flowMode: o.flowMode === 'core_3agent' ? 'core_3agent' : 'full_8agent',
    provider: o.provider,
    autoGenerateCoverImage: Boolean(o.autoGenerateCoverImage),
  };

  // One shared Knowledge Base for the entire batch => identical, cacheable prompt prefix.
  const kb = getActiveKnowledgeContext(topics.join(' '));
  const kbSlim = kb.map((k) => ({
    title: k.title,
    summary: k.summary,
    content: k.content,
    source_ref: k.source_ref,
  }));

  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO ai_batches (name, status, mode, options_json, kb_json, total, created_at, updated_at)
       VALUES (?, 'queued', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.name || '').trim().slice(0, 120) || `Batch ${now.slice(0, 16).replace('T', ' ')}`,
      options.mode,
      JSON.stringify(options),
      JSON.stringify(kbSlim),
      topics.length,
      now,
      now
    );
  const id = Number(res.lastInsertRowid);
  const ins = db.prepare(
    `INSERT INTO ai_batch_items (batch_id, idx, topic, status, updated_at) VALUES (?, ?, ?, 'pending', ?)`
  );
  topics.forEach((t, i) => ins.run(id, i, t, now));
  return { id, duplicates };
}

function batchRow(id: number): any {
  return db.prepare('SELECT * FROM ai_batches WHERE id = ?').get(id);
}

export function summarizeBatch(id: number) {
  const b = batchRow(id);
  if (!b) return null;
  const items = db
    .prepare('SELECT * FROM ai_batch_items WHERE batch_id = ? ORDER BY idx ASC')
    .all(id) as any[];
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const sum = (k: string) => items.reduce((a, i) => a + Number(i[k] || 0), 0);
  const done = count('done');
  const cacheHits = items.filter((i) => i.status === 'done' && i.cache_hit).length;
  const inputTokens = sum('input_tokens');
  const cachedTokens = sum('cached_tokens');
  const byProvider: Record<string, number> = {};
  for (const i of items) {
    if (i.status === 'done' && !i.cache_hit && i.provider) {
      byProvider[i.provider] = (byProvider[i.provider] || 0) + 1;
    }
  }
  return {
    id: b.id as number,
    name: b.name as string,
    status: b.status as string,
    mode: b.mode as BatchMode,
    createdAt: b.created_at as string,
    updatedAt: b.updated_at as string,
    finishedAt: (b.finished_at as string) || null,
    total: items.length,
    done,
    failed: count('failed'),
    pending: count('pending'),
    running: count('running'),
    cancelled: count('cancelled'),
    stats: {
      cacheHits,
      failedOver: items.filter((i) => i.failed_over).length,
      escalatedToStandard:
        b.mode === 'economy' ? items.filter((i) => i.status === 'done' && i.tier === 'standard').length : 0,
      inputTokens,
      outputTokens: sum('output_tokens'),
      cachedInputTokens: cachedTokens,
      cachedInputPercent: inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0,
      byProvider,
    },
    items: items.map((i) => ({
      id: i.id as number,
      idx: i.idx as number,
      topic: i.topic as string,
      status: i.status as string,
      attempts: i.attempts as number,
      workflowId: (i.workflow_id as number) || null,
      error: (i.error as string) || '',
      provider: (i.provider as string) || '',
      model: (i.model as string) || '',
      tier: (i.tier as string) || '',
      cacheHit: Boolean(i.cache_hit),
      failedOver: Boolean(i.failed_over),
    })),
  };
}

export function listBatches(limit = 20) {
  const rows = db
    .prepare('SELECT id FROM ai_batches ORDER BY id DESC LIMIT ?')
    .all(limit) as { id: number }[];
  return rows
    .map((r) => summarizeBatch(r.id))
    .filter(Boolean)
    .map((b) => ({ ...b!, items: undefined }));
}

function refreshBatchStatus(id: number) {
  const b = batchRow(id);
  if (!b || b.status === 'cancelled') return;
  const c = db
    .prepare(
      `SELECT
        SUM(status='pending') AS pending, SUM(status='running') AS running,
        SUM(status='failed') AS failed, SUM(status='done') AS done
       FROM ai_batch_items WHERE batch_id = ?`
    )
    .get(id) as any;
  let status = b.status;
  let finished: string | null = null;
  if (!c.pending && !c.running) {
    status = c.failed ? 'completed_with_errors' : 'completed';
    finished = nowIso();
  } else if (b.status === 'paused') {
    status = 'paused';
  } else {
    status = 'running';
  }
  db.prepare('UPDATE ai_batches SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?').run(
    status,
    nowIso(),
    finished,
    id
  );
}

function recoverStuckItems(id: number) {
  const cutoff = new Date(Date.now() - STUCK_RUNNING_MS).toISOString();
  db.prepare(
    `UPDATE ai_batch_items SET status = 'pending', updated_at = ?
     WHERE batch_id = ? AND status = 'running' AND updated_at < ?`
  ).run(nowIso(), id, cutoff);
}

async function runOneItem(batchId: number, item: any, options: BatchOptions, kb: any[]) {
  db.prepare(
    `UPDATE ai_batch_items SET status = 'running', attempts = attempts + 1, error = '', updated_at = ? WHERE id = ?`
  ).run(nowIso(), item.id);
  try {
    const result = await executeMultiAgentWorkflow({
      topic: item.topic,
      inputSource: options.inputSource,
      category: options.category,
      targetAudience: options.targetAudience,
      businessPillar: options.businessPillar,
      flowMode: options.flowMode,
      provider: options.provider,
      autoGenerateCoverImage: options.autoGenerateCoverImage,
      tier: options.mode === 'economy' ? 'economy' : 'standard',
      cache: true,
      batchId,
      kbItems: kb,
    });
    const workflowId = createWorkflowRecord(
      {
        topic: item.topic,
        inputSource: options.inputSource,
        category: options.category,
        targetAudience: options.targetAudience,
        businessPillar: options.businessPillar,
        flowMode: options.flowMode,
      },
      result
    );
    const m = result.meta;
    db.prepare(
      `UPDATE ai_batch_items SET status = 'done', workflow_id = ?, provider = ?, model = ?, tier = ?,
        cache_hit = ?, failed_over = ?, input_tokens = ?, output_tokens = ?, cached_tokens = ?,
        error = '', updated_at = ? WHERE id = ?`
    ).run(
      workflowId,
      m.provider,
      m.model,
      m.tier,
      m.cacheHit ? 1 : 0,
      m.failedOver ? 1 : 0,
      m.usage.inputTokens,
      m.usage.outputTokens,
      m.usage.cachedTokens,
      nowIso(),
      item.id
    );
    return true;
  } catch (err) {
    db.prepare(
      `UPDATE ai_batch_items SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(String((err as Error).message || err).slice(0, 600), nowIso(), item.id);
    return false;
  }
}

/**
 * Works through pending items until done, cancelled, paused or the time budget is used up.
 * Safe to call repeatedly (serverless slices) — a batch is never processed by two callers at once.
 */
export async function processBatch(
  id: number,
  opts: { budgetMs?: number } = {}
): Promise<ReturnType<typeof summarizeBatch>> {
  if (running.has(id)) return summarizeBatch(id);
  const b = batchRow(id);
  if (!b) throw new Error('ไม่พบ Batch ที่ต้องการ');
  if (b.status === 'cancelled') return summarizeBatch(id);

  running.add(id);
  try {
    recoverStuckItems(id);
    const options = JSON.parse(b.options_json) as BatchOptions;
    const kb = JSON.parse(b.kb_json || '[]');
    const deadline = Date.now() + (opts.budgetMs ?? Infinity);

    db.prepare("UPDATE ai_batches SET status = 'running', updated_at = ? WHERE id = ?").run(nowIso(), id);

    let consecutiveFailures = 0;
    let stop = false;

    const takeNext = (): any | null => {
      if (stop || Date.now() >= deadline) return null;
      const cur = batchRow(id);
      if (!cur || cur.status === 'cancelled') return null;
      const next = db
        .prepare(
          `SELECT * FROM ai_batch_items WHERE batch_id = ? AND status = 'pending' ORDER BY idx ASC LIMIT 1`
        )
        .get(id);
      if (!next) return null;
      // claim immediately (single-threaded JS: no race between find and claim)
      db.prepare("UPDATE ai_batch_items SET status = 'running', updated_at = ? WHERE id = ?").run(
        nowIso(),
        (next as any).id
      );
      return next;
    };

    const work = async (item: any) => {
      const ok = await runOneItem(id, item, options, kb);
      if (ok) consecutiveFailures = 0;
      else {
        consecutiveFailures += 1;
        if (consecutiveFailures >= STOP_AFTER_CONSECUTIVE_FAILURES) {
          stop = true;
          db.prepare("UPDATE ai_batches SET status = 'paused', updated_at = ? WHERE id = ?").run(
            nowIso(),
            id
          );
        }
      }
    };

    // Warm-up: when nothing has been cached yet, run the first item alone so the vendor
    // prompt cache holds the shared prefix before the parallel workers start.
    const doneSoFar = (
      db.prepare("SELECT COUNT(*) c FROM ai_batch_items WHERE batch_id = ? AND status = 'done'").get(id) as any
    ).c as number;
    const pendingCount = (
      db.prepare("SELECT COUNT(*) c FROM ai_batch_items WHERE batch_id = ? AND status = 'pending'").get(id) as any
    ).c as number;
    if (doneSoFar === 0 && pendingCount >= 3 && options.concurrency > 1) {
      const first = takeNext();
      if (first) await work(first);
    }

    const workers = Array.from({ length: options.concurrency }, async () => {
      for (;;) {
        const item = takeNext();
        if (!item) return;
        await work(item);
      }
    });
    await Promise.all(workers);

    refreshBatchStatus(id);
  } finally {
    running.delete(id);
  }
  return summarizeBatch(id);
}

export function cancelBatch(id: number) {
  const b = batchRow(id);
  if (!b) throw new Error('ไม่พบ Batch ที่ต้องการ');
  db.prepare("UPDATE ai_batch_items SET status = 'cancelled', updated_at = ? WHERE batch_id = ? AND status = 'pending'").run(
    nowIso(),
    id
  );
  db.prepare("UPDATE ai_batches SET status = 'cancelled', updated_at = ?, finished_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    id
  );
  return summarizeBatch(id);
}

export function retryFailed(id: number) {
  const b = batchRow(id);
  if (!b) throw new Error('ไม่พบ Batch ที่ต้องการ');
  db.prepare("UPDATE ai_batch_items SET status = 'pending', error = '', updated_at = ? WHERE batch_id = ? AND status = 'failed'").run(
    nowIso(),
    id
  );
  db.prepare("UPDATE ai_batches SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ?").run(
    nowIso(),
    id
  );
  return summarizeBatch(id);
}

/** Long-lived servers keep working after the browser closes; serverless is driven by /process calls. */
export function startBackground(id: number) {
  if (IS_SERVERLESS) return;
  void processBatch(id).catch((e) => console.error('Batch runner error:', (e as Error).message));
}

export function resumeBatchesOnBoot() {
  if (IS_SERVERLESS) return;
  const rows = db
    .prepare("SELECT id FROM ai_batches WHERE status IN ('queued','running')")
    .all() as { id: number }[];
  for (const r of rows) {
    db.prepare(
      "UPDATE ai_batch_items SET status = 'pending', updated_at = ? WHERE batch_id = ? AND status = 'running'"
    ).run(nowIso(), r.id);
    startBackground(r.id);
  }
}
