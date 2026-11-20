import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Play, RefreshCw, Square } from 'lucide-react';
import { api } from '../api';
import { AiBatchSummary } from '../types';

interface Props {
  onRefreshAll: () => Promise<void>;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  queued: { text: 'รอคิว', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  running: { text: 'กำลังรัน', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  paused: { text: 'หยุดชั่วคราว (ล้มเหลวติดกัน)', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  completed: { text: 'เสร็จสมบูรณ์', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  completed_with_errors: { text: 'เสร็จ (มีรายการล้มเหลว)', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  cancelled: { text: 'ยกเลิกแล้ว', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const ITEM_LABEL: Record<string, string> = {
  pending: 'รอ',
  running: 'กำลังทำ',
  done: 'สำเร็จ',
  failed: 'ล้มเหลว',
  cancelled: 'ยกเลิก',
};

const ACTIVE = new Set(['queued', 'running']);

export const AiBatchStudio: React.FC<Props> = ({ onRefreshAll }) => {
  const [open, setOpen] = useState(false);
  const [topicsText, setTopicsText] = useState('');
  const [mode, setMode] = useState<'economy' | 'standard'>('economy');
  const [maxItems, setMaxItems] = useState(50);
  const [backgroundCapable, setBackgroundCapable] = useState(true);
  const [batch, setBatch] = useState<AiBatchSummary | null>(null);
  const [recent, setRecent] = useState<AiBatchSummary[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const driveToken = useRef(0);

  const topicCount = Array.from(
    new Set(
      topicsText
        .split(/\r?\n/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    )
  ).length;

  const loadRecent = useCallback(async () => {
    try {
      const res = await api.listAiBatches();
      setMaxItems(res.maxItems);
      setBackgroundCapable(res.backgroundCapable);
      setRecent(res.batches.slice(0, 5));
    } catch {
      /* panel is optional; ignore */
    }
  }, []);

  useEffect(() => {
    if (open) loadRecent();
  }, [open, loadRecent]);

  // Drives a batch to completion. On a long-lived server this just observes the background worker;
  // on serverless each call processes one time-boxed slice.
  const drive = useCallback(
    async (id: number) => {
      const token = ++driveToken.current;
      for (;;) {
        if (token !== driveToken.current) return;
        try {
          const s = await api.processAiBatch(id);
          if (token !== driveToken.current) return;
          setBatch(s);
          if (!ACTIVE.has(s.status)) {
            await onRefreshAll();
            loadRecent();
            return;
          }
        } catch (e) {
          setError((e as Error).message);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    },
    [onRefreshAll, loadRecent]
  );

  useEffect(
    () => () => {
      driveToken.current += 1; // stop polling when the panel unmounts
    },
    []
  );

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStarting(true);
    try {
      const topics = topicsText.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
      const created = await api.createAiBatch({ topics, mode });
      setBatch(created);
      setTopicsText('');
      drive(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const openBatch = async (id: number) => {
    setError('');
    try {
      const s = await api.getAiBatch(id);
      setBatch(s);
      if (ACTIVE.has(s.status)) drive(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resume = async (fn: (id: number) => Promise<AiBatchSummary>) => {
    if (!batch) return;
    setError('');
    try {
      const s = await fn(batch.id);
      setBatch(s);
      drive(batch.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cancel = async () => {
    if (!batch) return;
    driveToken.current += 1;
    try {
      setBatch(await api.cancelAiBatch(batch.id));
      loadRecent();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const finished = batch ? batch.done + batch.failed + batch.cancelled : 0;
  const pct = batch && batch.total ? Math.round((finished / batch.total) * 100) : 0;
  const st = batch ? STATUS_LABEL[batch.status] : null;

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2.5">
          <Layers className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-bold text-slate-900">รันเป็นชุด (Batch) — ประหยัดสุด</span>
          <span className="hidden sm:inline text-[11px] text-slate-400">
            ใส่หลายหัวข้อ ให้ AI ทำทีเดียว
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-5 space-y-4">
          <form onSubmit={start} className="space-y-3">
            <textarea
              rows={5}
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              placeholder={`พิมพ์หัวข้อ หนึ่งบรรทัดต่อหนึ่งหัวข้อ (สูงสุด ${maxItems} หัวข้อ)\nเช่น\nAI Tutor ในโรงเรียนขนาดเล็ก\nห้องเรียน Active Learning\nทักษะภาษาไทย-เมียนมา`}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0a101d] focus:bg-white focus:outline-none"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(
                [
                  {
                    id: 'economy',
                    title: 'ประหยัดสุด (แนะนำ)',
                    desc: 'ใช้โมเดลรุ่นประหยัดก่อน ถ้าผลไม่ผ่านจึงขยับไปรุ่นแรงขึ้นเฉพาะรายการนั้น • หัวข้อซ้ำใช้ผลเดิมฟรี • ใช้แคชของค่ายลดค่า input',
                  },
                  {
                    id: 'standard',
                    title: 'คุณภาพเต็ม',
                    desc: 'ใช้โมเดลรุ่นหลักของแต่ละค่ายทุกรายการ ค่าใช้จ่ายสูงกว่า',
                  },
                ] as const
              ).map((m) => (
                <label
                  key={m.id}
                  className={`rounded-xl border p-3 cursor-pointer transition ${
                    mode === m.id
                      ? 'border-[#0a101d] bg-slate-900/[0.03]'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <input
                      type="radio"
                      name="batch-mode"
                      className="accent-[#0a101d]"
                      checked={mode === m.id}
                      onChange={() => setMode(m.id)}
                    />
                    {m.title}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{m.desc}</p>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                {topicCount > 0 ? (
                  <>
                    พร้อมรัน <strong className="text-slate-800">{topicCount}</strong> หัวข้อ (ตัดซ้ำให้แล้ว)
                    {topicCount > maxItems && (
                      <span className="text-rose-600 font-semibold"> • เกินที่กำหนด {maxItems}</span>
                    )}
                  </>
                ) : (
                  'ถ้าค่ายใดล่มระหว่างรัน ระบบสลับค่ายอัตโนมัติ และหยุดเองถ้าล้มเหลวติดกัน 3 รายการ'
                )}
              </span>
              <button
                type="submit"
                disabled={starting || topicCount === 0 || topicCount > maxItems}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0a101d] px-5 py-2.5 text-xs font-semibold text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {starting ? 'กำลังสร้างคิว...' : `เริ่มรัน ${topicCount || ''} หัวข้อ`}
              </button>
            </div>
          </form>

          {error && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
              {error}
            </div>
          )}

          {batch && st && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-900">{batch.name}</div>
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                  {st.text}
                </span>
              </div>

              <div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                  <span>
                    สำเร็จ <strong>{batch.done}</strong>/{batch.total}
                  </span>
                  {batch.failed > 0 && (
                    <span className="text-rose-700">
                      ล้มเหลว <strong>{batch.failed}</strong>
                    </span>
                  )}
                  <span>
                    ใช้ผลจากแคช (ฟรี) <strong>{batch.stats.cacheHits}</strong>
                  </span>
                  <span>
                    สลับค่ายอัตโนมัติ <strong>{batch.stats.failedOver}</strong>
                  </span>
                  {batch.mode === 'economy' && (
                    <span>
                      ขยับไปรุ่นแรง <strong>{batch.stats.escalatedToStandard}</strong>
                    </span>
                  )}
                  <span>
                    Input ที่ใช้แคชของค่าย <strong>{batch.stats.cachedInputPercent}%</strong>
                  </span>
                </div>
              </div>

              <ul className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
                {(batch.items || []).map((it) => (
                  <li key={it.id} className="px-3 py-2 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="flex-1 min-w-[10rem] font-medium text-slate-800">{it.topic}</span>
                    <span
                      className={
                        it.status === 'done'
                          ? 'text-emerald-700 font-semibold'
                          : it.status === 'failed'
                          ? 'text-rose-700 font-semibold'
                          : 'text-slate-500'
                      }
                    >
                      {ITEM_LABEL[it.status]}
                    </span>
                    {it.status === 'done' && (
                      <span className="text-slate-400">
                        {it.cacheHit ? 'จากแคช' : `${it.provider} • ${it.model}`}
                        {it.failedOver ? ' • สลับค่าย' : ''}
                      </span>
                    )}
                    {it.status === 'failed' && it.error && (
                      <span className="basis-full text-rose-600 break-words">{it.error}</span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                {ACTIVE.has(batch.status) && (
                  <button
                    type="button"
                    onClick={cancel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Square className="w-3 h-3" /> ยกเลิก
                  </button>
                )}
                {batch.status === 'paused' && (
                  <button
                    type="button"
                    onClick={() => resume(async (id) => api.processAiBatch(id))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a101d] px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer"
                  >
                    <Play className="w-3 h-3" /> ทำต่อ
                  </button>
                )}
                {batch.failed > 0 && !ACTIVE.has(batch.status) && (
                  <button
                    type="button"
                    onClick={() => resume(api.retryFailedAiBatch)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> ลองใหม่เฉพาะที่ล้มเหลว
                  </button>
                )}
                <span className="text-[11px] text-slate-400">
                  {backgroundCapable
                    ? 'ปิดหน้านี้ได้ ระบบบนเซิร์ฟเวอร์รันต่อให้จนเสร็จ'
                    : 'โฮสต์นี้เป็น Serverless: กรุณาเปิดหน้านี้ค้างไว้จนกว่าจะเสร็จ'}
                  {' • ผลงานอยู่ในรายการแคมเปญด้านล่าง'}
                </span>
              </div>
            </div>
          )}

          {recent.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 mb-1.5">Batch ล่าสุด</div>
              <ul className="space-y-1">
                {recent.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => openBatch(r.id)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-1.5 text-left hover:bg-slate-50 cursor-pointer"
                    >
                      <span className="text-[11px] font-medium text-slate-800 truncate">{r.name}</span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {r.done}/{r.total} • {STATUS_LABEL[r.status]?.text || r.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
