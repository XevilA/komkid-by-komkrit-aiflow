import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { api } from '../api';
import { AiHealthResponse, AiProviderHealth } from '../types';

const STATE_STYLE: Record<
  AiProviderHealth['state'],
  { dot: string; label: string; text: string }
> = {
  ok: { dot: 'bg-emerald-500', label: 'ปกติ', text: 'text-emerald-800' },
  degraded: { dot: 'bg-amber-500', label: 'เริ่มมีปัญหา', text: 'text-amber-800' },
  cooldown: { dot: 'bg-rose-500', label: 'พักการใช้งานชั่วคราว', text: 'text-rose-800' },
  unconfigured: { dot: 'bg-slate-300', label: 'ยังไม่ได้ใส่คีย์', text: 'text-slate-500' },
};

function fmtWait(sec: number): string {
  if (sec >= 60) return `${Math.ceil(sec / 60)} นาที`;
  return `${sec} วินาที`;
}

const OrderEditor: React.FC<{
  title: string;
  hint: string;
  order: string[];
  health: AiProviderHealth[];
  onChange: (next: string[]) => void;
}> = ({ title, hint, order, health, onChange }) => {
  const label = (id: string) => health.find((h) => h.id === id)?.label || id;
  const configured = (id: string) => health.find((h) => h.id === id)?.configured;
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-bold text-slate-900">{title}</div>
      <p className="text-[11px] text-slate-500 mt-0.5 mb-3">{hint}</p>
      <ol className="space-y-1.5">
        {order.map((id, i) => (
          <li
            key={id}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
          >
            <span className="w-5 text-[11px] font-bold text-slate-400">{i + 1}</span>
            <span
              className={`flex-1 text-xs font-semibold ${
                configured(id) ? 'text-slate-900' : 'text-slate-400'
              }`}
            >
              {label(id)}
              {!configured(id) && <span className="ml-1.5 font-normal">(ข้าม — ยังไม่มีคีย์)</span>}
            </span>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label="เลื่อนขึ้น"
              className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === order.length - 1}
              aria-label="เลื่อนลง"
              className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};

export const AiRoutingPanel: React.FC = () => {
  const [data, setData] = useState<AiHealthResponse | null>(null);
  const [fallbackOrder, setFallbackOrder] = useState<string[]>([]);
  const [economyOrder, setEconomyOrder] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async (initial = false) => {
    try {
      const res = await api.getAiHealth();
      setData(res);
      if (initial) {
        setFallbackOrder(res.fallbackOrder);
        setEconomyOrder(res.economyOrder);
      }
    } catch (e) {
      setNotice({ type: 'err', text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), 8000);
    return () => clearInterval(t);
  }, [load]);

  const save = async (patch: Parameters<typeof api.saveAiRouting>[0]) => {
    setSaving(true);
    setNotice(null);
    try {
      await api.saveAiRouting(patch);
      setDirty(false);
      setNotice({ type: 'ok', text: 'บันทึกการตั้งค่าแล้ว มีผลทันทีกับทุกการเรียก AI' });
      await load(true);
    } catch (e) {
      setNotice({ type: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500">
        กำลังโหลดสถานะระบบ AI...
      </div>
    );
  }

  const cachedPct =
    data.last24h.inputTokens > 0
      ? Math.round((data.last24h.cachedInputTokens / data.last24h.inputTokens) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              ระบบ AI สลับค่ายอัตโนมัติ
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              ถ้า AI ค่ายใดล่ม ถูกจำกัดโควตา คีย์ผิด หรือตอบกลับใช้ไม่ได้ ระบบจะสลับไปค่ายถัดไปให้เองทันที
              และพักค่ายที่มีปัญหาไว้ชั่วคราวเพื่อไม่ให้เสียเวลาและเงินซ้ำ
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#0a101d]"
              checked={data.failoverEnabled}
              disabled={saving}
              onChange={(e) => save({ failoverEnabled: e.target.checked })}
            />
            เปิดใช้งานการสลับอัตโนมัติ
          </label>
        </div>

        {notice && (
          <div
            role="status"
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold border ${
              notice.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {data.providers.map((p) => {
            const st = STATE_STYLE[p.state];
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
                  <span className="text-xs font-bold text-slate-900 flex-1">{p.label}</span>
                </div>
                <div className={`mt-1 text-[11px] font-semibold ${st.text}`}>
                  {st.label}
                  {p.state === 'cooldown' && ` • กลับมาลองใหม่ใน ${fmtWait(p.cooldownRemainingSec)}`}
                </div>
                {p.lastError && p.state !== 'unconfigured' && (
                  <div className="mt-1 text-[11px] text-slate-500 line-clamp-2" title={p.lastError}>
                    ปัญหาล่าสุด: {p.lastError}
                  </div>
                )}
                {p.state === 'cooldown' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.resetAiHealth(p.id);
                      load(false);
                    }}
                    className="mt-2 text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer"
                  >
                    ปลดพักแล้วลองใหม่ทันที
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
          <span>
            24 ชม.ล่าสุด: เรียก <strong className="text-slate-800">{data.last24h.calls}</strong> ครั้ง
          </span>
          <span>
            ล้มเหลว <strong className="text-slate-800">{data.last24h.failures}</strong>
          </span>
          <span>
            สลับค่ายอัตโนมัติ <strong className="text-slate-800">{data.last24h.failovers}</strong> ครั้ง
          </span>
          <span>
            Input ที่ใช้แคชของค่าย <strong className="text-slate-800">{cachedPct}%</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OrderEditor
          title="ลำดับการใช้งานปกติ"
          hint="ค่ายแรกใช้ก่อน ถ้าล่มจะไปค่ายถัดไปตามลำดับ"
          order={fallbackOrder}
          health={data.providers}
          onChange={(n) => {
            setFallbackOrder(n);
            setDirty(true);
          }}
        />
        <OrderEditor
          title="ลำดับโหมดประหยัด (Batch)"
          hint="เรียงจากถูกที่สุดไปแพงที่สุด ใช้กับงาน Batch"
          order={economyOrder}
          health={data.providers}
          onChange={(n) => {
            setEconomyOrder(n);
            setDirty(true);
          }}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => save({ fallbackOrder, economyOrder })}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0a101d] px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5" />
          {saving ? 'กำลังบันทึก...' : 'บันทึกลำดับ'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-slate-900">เหตุการณ์ล่าสุด (ล้มเหลว / สลับค่าย)</h4>
          <button
            type="button"
            onClick={() => load(false)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> รีเฟรช
          </button>
        </div>
        {data.recentEvents.length === 0 ? (
          <p className="text-xs text-slate-400">ยังไม่มีเหตุการณ์ผิดปกติ ทุกอย่างทำงานปกติ</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentEvents.map((ev, i) => (
              <li key={i} className="py-2 text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-slate-400 tabular-nums">
                  {new Date(ev.created_at).toLocaleString('th-TH')}
                </span>
                <span className="font-semibold text-slate-800">{ev.provider}</span>
                {ev.ok ? (
                  <span className="text-emerald-700">
                    รับช่วงต่อแทน {ev.failed_over_from}
                  </span>
                ) : (
                  <span className="text-rose-700 break-all">{ev.error || ev.error_kind}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
