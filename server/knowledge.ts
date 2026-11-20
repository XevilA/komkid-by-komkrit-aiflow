// ============================================================================
// KNOWLEDGE RETRIEVAL — Thai-aware ranking (BM25-style) over the knowledge base
// The previous matcher split on spaces, which finds nothing in Thai text.
// ============================================================================
import { db } from './db.ts';

export interface KnowledgeRow {
  id?: number;
  title: string;
  category: string;
  summary: string;
  content: string;
  source_ref: string;
}

const STOP = new Set(
  [
    'ที่', 'ของ', 'และ', 'ใน', 'การ', 'ความ', 'เป็น', 'ได้', 'มี', 'ให้', 'จะ', 'ไป', 'มา', 'กับ',
    'แต่', 'หรือ', 'ก็', 'ว่า', 'นี้', 'นั้น', 'โดย', 'ซึ่ง', 'เพื่อ', 'จาก', 'ด้วย', 'อย่าง', 'ๆ',
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are',
  ].map((s) => s.normalize('NFC'))
);

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== null) return segmenter;
  try {
    segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  } catch {
    segmenter = null;
  }
  return segmenter;
}

export function tokenize(text: string): string[] {
  const norm = String(text || '').normalize('NFC').toLowerCase();
  const seg = getSegmenter();
  const out: string[] = [];
  if (seg) {
    for (const part of seg.segment(norm)) {
      if (!part.isWordLike) continue;
      const w = part.segment.trim();
      if (w.length < 2 || STOP.has(w)) continue;
      out.push(w);
    }
  } else {
    for (const w of norm.split(/[^\p{L}\p{N}\p{M}]+/u)) {
      if (w.length >= 2 && !STOP.has(w)) out.push(w);
    }
  }
  return out;
}

interface Scored<T> {
  item: T;
  score: number;
}

/** Ranks documents against a query. Title/summary hits count more than body hits. */
export function rankDocuments<T extends KnowledgeRow>(docs: T[], query: string, limit = 6): Scored<T>[] {
  const qTokens = Array.from(new Set(tokenize(query)));
  const N = Math.max(docs.length, 1);

  const prepared = docs.map((d) => ({
    item: d,
    title: tokenize(d.title),
    summary: tokenize(d.summary),
    body: tokenize(d.content),
  }));

  const df = new Map<string, number>();
  for (const q of qTokens) {
    let n = 0;
    for (const p of prepared) {
      if (p.title.includes(q) || p.summary.includes(q) || p.body.includes(q)) n += 1;
    }
    df.set(q, n);
  }

  const scored: Scored<T>[] = prepared.map((p) => {
    let score = 0;
    for (const q of qTokens) {
      const idf = Math.log(1 + (N - (df.get(q) || 0) + 0.5) / ((df.get(q) || 0) + 0.5));
      const tf = (arr: string[]) => {
        let c = 0;
        for (const t of arr) if (t === q || (q.length >= 3 && (t.includes(q) || q.includes(t) && t.length >= 3))) c += 1;
        return c;
      };
      const inTitle = tf(p.title);
      const inSummary = tf(p.summary);
      const inBody = tf(p.body);
      const weighted = inTitle * 4 + inSummary * 2 + Math.min(inBody, 5);
      if (weighted > 0) score += idf * (weighted / (weighted + 1.2));
    }
    return { item: p.item, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Best knowledge for a topic: strongest matches, plus the brand guideline so the voice is
 * always available even when the topic shares no words with it.
 */
export function selectKnowledge<T extends KnowledgeRow>(docs: T[], query: string, limit = 6): T[] {
  const ranked = rankDocuments(docs, query, docs.length);
  const matches = ranked.filter((r) => r.score > 0).slice(0, limit).map((r) => r.item);
  const brand = docs.find((d) => d.category === 'brand_guideline');
  const picked = [...matches];
  if (brand && !picked.includes(brand)) picked.unshift(brand);
  if (picked.length === 0) return docs.slice(0, Math.min(limit, 3));
  return picked.slice(0, limit);
}

export function loadActiveKnowledge(): (KnowledgeRow & { id: number })[] {
  return db
    .prepare(
      'SELECT id, title, category, summary, content, source_ref FROM knowledge_base WHERE is_active = 1 ORDER BY id ASC'
    )
    .all() as unknown as (KnowledgeRow & { id: number })[];
}

export function searchKnowledge(query: string, limit = 6) {
  return selectKnowledge(loadActiveKnowledge(), query, limit);
}
