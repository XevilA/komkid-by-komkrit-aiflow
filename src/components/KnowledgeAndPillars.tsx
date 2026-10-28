import React, { useEffect, useState } from 'react';
import {
  Database,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  X,
  TrendingUp,
  MessageSquare,
  Users,
  Mail,
  Settings,
  Save,
  KeyRound,
  Zap,
  AlertTriangle,
  RefreshCw,
  Film,
  Bot,
} from 'lucide-react';
import {
  KnowledgeItem,
  BusinessPillarItem,
  PostComment,
  Subscriber,
  ContactMessage,
  AiEngineSettings,
} from '../types';
import { api, formatThaiDate } from '../api';

const KB_CATEGORIES = [
  { id: 'policy', label: 'ข้อมูลการศึกษา / นโยบายรัฐ (สพฐ., OPEC)' },
  { id: 'research', label: 'งานวิจัย / บทความ / แหล่งอ้างอิง' },
  { id: 'komkrit_vision', label: 'แนวคิดและมุมมองของคมกฤช (Komkrit)' },
  { id: 'regulation', label: 'กฎหมาย PDPA / ระเบียบ / จริยธรรม' },
  { id: 'brand_guideline', label: 'Brand Guideline / Tone of Voice' },
];

export const KnowledgeBaseManager: React.FC<{
  items: KnowledgeItem[];
  onRefresh: () => Promise<void>;
}> = ({ items, onRefresh }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: '',
    category: 'research' as KnowledgeItem['category'],
    summary: '',
    content: '',
    sourceRef: '',
    isActive: true,
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({
      title: '',
      category: 'research',
      summary: '',
      content: '',
      sourceRef: '',
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (k: KnowledgeItem) => {
    setEditingId(k.id);
    setForm({
      title: k.title,
      category: k.category,
      summary: k.summary,
      content: k.content,
      sourceRef: k.sourceRef,
      isActive: k.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      await api.updateKnowledge(editingId, form);
    } else {
      await api.createKnowledge(form);
    }
    setModalOpen(false);
    await onRefresh();
  };

  const handleToggle = async (k: KnowledgeItem) => {
    await api.updateKnowledge(k.id, { isActive: !k.isActive });
    await onRefresh();
  };

  const handleDelete = async (id: number) => {
    await api.deleteKnowledge(id);
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
        <div>
          <h2 className="text-xl font-extrabold text-[#0d2546] flex items-center gap-2">
            <Database className="w-5 h-5 text-[#f59e0b]" />
            ฐานความรู้ (Knowledge Base CRUD) — เพิ่มประสิทธิภาพของทุก AI Agent
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ข้อมูลที่เปิดใช้งาน (Active) จะถูกส่งให้ Research Agent, Content Agent และ QA Agent ใช้อ้างอิงอัตโนมัติ
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2.5 text-xs font-extrabold text-white hover:bg-[#193d6e] cursor-pointer"
        >
          <Plus className="w-4 h-4 text-amber-300" /> เพิ่มฐานความรู้ใหม่
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((k) => {
          const catLabel =
            KB_CATEGORIES.find((c) => c.id === k.category)?.label || k.category;
          return (
            <div
              key={k.id}
              className={`rounded-2xl border p-4 bg-white shadow-2xs flex flex-col justify-between ${
                k.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="rounded-full bg-sky-50 border border-sky-200 px-2.5 py-0.5 text-[10.5px] font-bold text-sky-900">
                    {catLabel}
                  </span>
                  <button
                    onClick={() => handleToggle(k)}
                    className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold cursor-pointer ${
                      k.isActive
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {k.isActive ? '● ใช้งานกับ AI' : '○ ปิดชั่วคราว'}
                  </button>
                </div>
                <h3 className="font-extrabold text-sm text-[#0d2546]">
                  {k.title}
                </h3>
                <p className="mt-1 text-xs font-semibold text-amber-800">
                  {k.summary}
                </p>
                <p className="mt-2 text-xs text-slate-600 font-body line-clamp-3">
                  {k.content}
                </p>
              </div>
              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>แหล่งอ้างอิง: {k.sourceRef || '-'}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openEdit(k)}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 inline mr-0.5" /> แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(k.id)}
                    className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-lg text-[#0d2546]">
                {editingId ? 'แก้ไขฐานความรู้' : 'เพิ่มฐานความรู้สำหรับ AI Agent'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">ชื่อหัวข้อฐานความรู้ *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">หมวดหมู่ฐานความรู้</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as any })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                >
                  {KB_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">สรุปใจความสำคัญ (Summary) *</label>
                <input
                  type="text"
                  required
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">รายละเอียดเนื้อหา / กฎเกณฑ์สำหรับ AI *</label>
                <textarea
                  rows={4}
                  required
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-body"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">แหล่งอ้างอิง (Source Reference)</label>
                <input
                  type="text"
                  value={form.sourceRef}
                  onChange={(e) =>
                    setForm({ ...form, sourceRef: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  บันทึกฐานความรู้
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export const FivePillarManager: React.FC<{
  pillars: BusinessPillarItem[];
  onRefresh: () => Promise<void>;
}> = ({ pillars, onRefresh }) => {
  const [editing, setEditing] = useState<BusinessPillarItem | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await api.updatePillar(editing.id, editing);
    setEditing(null);
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] to-[#1a4378] p-6 text-white">
        <span className="rounded-full bg-[#f59e0b] px-3 py-0.5 text-xs font-extrabold text-[#0b1e38]">
          KOMKID 5-PILLAR BUSINESS MODEL
        </span>
        <h2 className="mt-2 text-xl sm:text-2xl font-extrabold">
          CONTENT &nbsp;→&nbsp; AUDIENCE &nbsp;→&nbsp; TRUST
        </h2>
        <p className="text-xs sm:text-sm text-slate-200 mt-1">
          บริหารจัดการเป้าหมายและตัวชี้วัดทั้ง 5 เสาหลักธุรกิจของ คมคิด by KOMKRIT (แก้ไขข้อมูลแต่ละเสาหลักได้ทันที)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {pillars.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl bg-white border border-amber-200/90 p-4 shadow-xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="rounded-full bg-[#0d2546] px-2.5 py-0.5 text-[10px] font-extrabold text-amber-300">
                  เสาหลักที่ {p.pillarIndex}
                </span>
                {p.statusBadge && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                    {p.statusBadge}
                  </span>
                )}
              </div>
              <h3 className="font-extrabold text-sm text-[#0d2546]">
                {p.title}
              </h3>
              <div className="text-[11px] font-bold text-[#d97706] mt-0.5">
                {p.subtitle}
              </div>
              <p className="mt-2.5 text-xs text-slate-600 font-body leading-relaxed">
                {p.description}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="text-[10.5px] text-slate-400">{p.metricLabel}</div>
              <div className="text-base font-extrabold text-[#0d2546] flex items-center justify-between">
                <span>{p.metricValue}</span>
                <button
                  onClick={() => setEditing({ ...p })}
                  className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-[#0d2546] hover:text-white transition cursor-pointer"
                  title="แก้ไขตัวชี้วัดเสาหลักนี้"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-extrabold text-lg text-[#0d2546] mb-3">
              แก้ไข {editing.title}
            </h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">คำอธิบายย่อย</label>
                <input
                  type="text"
                  value={editing.subtitle}
                  onChange={(e) =>
                    setEditing({ ...editing, subtitle: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">รายละเอียดเสาหลัก</label>
                <textarea
                  rows={3}
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold mb-1">ชื่อตัวชี้วัด (KPI)</label>
                  <input
                    type="text"
                    value={editing.metricLabel}
                    onChange={(e) =>
                      setEditing({ ...editing, metricLabel: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">ค่าเป้าหมาย/ผลลัพธ์</label>
                  <input
                    type="text"
                    value={editing.metricValue}
                    onChange={(e) =>
                      setEditing({ ...editing, metricValue: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export const AudienceAndSettingsHub: React.FC<{
  mode: 'feedback' | 'settings';
  onRefreshStats: () => Promise<void>;
}> = ({ mode, onRefreshStats }) => {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [contacts, setContacts] = useState<ContactMessage[]>([]);
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [secrets, setSecrets] = useState({
    geminiApiKey: '',
    claudeApiKey: '',
    deepseekApiKey: '',
    openaiApiKey: '',
    vertexAccessToken: '',
    elevenlabsApiKey: '',
    resendApiKey: '',
    localApiKey: '',
  });
  const [savedNotice, setSavedNotice] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const loadData = async () => {
    if (mode === 'feedback') {
      const [c, s, m] = await Promise.all([
        api.getAllComments(),
        api.getSubscribers(),
        api.getContacts(),
      ]);
      setComments(c);
      setSubscribers(s);
      setContacts(m);
    } else {
      const st = await api.getAiSettings();
      setSettings(st);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  if (mode === 'settings') {
    const handleSaveSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!settings) return;
      await api.saveAiSettings({
        provider: settings.provider,
        geminiModel: settings.geminiModel,
        geminiImageModel: settings.geminiImageModel,
        geminiVideoModel: settings.geminiVideoModel,
        geminiApiKey: secrets.geminiApiKey.trim()
          ? secrets.geminiApiKey.trim()
          : '__KEEP__',
        claudeModel: settings.claudeModel,
        claudeApiKey: secrets.claudeApiKey.trim()
          ? secrets.claudeApiKey.trim()
          : '__KEEP__',
        deepseekModel: settings.deepseekModel,
        deepseekApiKey: secrets.deepseekApiKey.trim()
          ? secrets.deepseekApiKey.trim()
          : '__KEEP__',
        openaiModel: settings.openaiModel,
        openaiApiKey: secrets.openaiApiKey.trim()
          ? secrets.openaiApiKey.trim()
          : '__KEEP__',
        vertexProjectId: settings.vertexProjectId,
        vertexLocation: settings.vertexLocation,
        vertexVeoModel: settings.vertexVeoModel,
        vertexAccessToken: secrets.vertexAccessToken.trim()
          ? secrets.vertexAccessToken.trim()
          : '__KEEP__',
        elevenlabsVoiceId: settings.elevenlabsVoiceId,
        elevenlabsApiKey: secrets.elevenlabsApiKey.trim()
          ? secrets.elevenlabsApiKey.trim()
          : '__KEEP__',
        resendFromEmail: settings.resendFromEmail,
        resendApiKey: secrets.resendApiKey.trim()
          ? secrets.resendApiKey.trim()
          : '__KEEP__',
        localEndpoint: settings.localEndpoint,
        localModel: settings.localModel,
        localApiKey: secrets.localApiKey.trim()
          ? secrets.localApiKey.trim()
          : '__KEEP__',
      });
      setSecrets({
        geminiApiKey: '',
        claudeApiKey: '',
        deepseekApiKey: '',
        openaiApiKey: '',
        vertexAccessToken: '',
        elevenlabsApiKey: '',
        resendApiKey: '',
        localApiKey: '',
      });
      setSavedNotice(true);
      await loadData();
      setTimeout(() => setSavedNotice(false), 3000);
    };

    const runLiveTest = async (
      provider: 'gemini' | 'claude' | 'deepseek' | 'openai' | 'openai_compatible',
      model?: string,
      unsavedKey?: string
    ) => {
      setTestingProvider(provider);
      try {
        const res = await api.testAiProvider({
          provider,
          model,
          apiKey: unsavedKey?.trim() || undefined,
        });
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            ok: true,
            text: `✓ เชื่อมต่อ ${res.engineLabel} สำเร็จ (${res.latencyMs} ms) — ตอบกลับ: "${res.sampleReply}"`,
          },
        }));
      } catch (err) {
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            ok: false,
            text: `✗ ${(err as Error).message}`,
          },
        }));
      } finally {
        setTestingProvider(null);
      }
    };

    return (
      <div className="max-w-5xl space-y-5">
        {/* Top Vault Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] via-[#153969] to-[#0d2546] p-5 sm:p-6 text-white shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-amber-400/20 border border-amber-300/40 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 text-[10.5px] font-extrabold text-emerald-300">
                  100% REAL API ENGINE • ZERO MOCKUP MODE
                </span>
                <h2 className="mt-1 text-lg sm:text-xl font-extrabold">
                  ศูนย์จัดการ API Keys & AI Providers (Gemini • Veo • Flow • Claude • DeepSeek • ChatGPT)
                </h2>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-300 leading-relaxed">
            ระบบนี้เชื่อมต่อ Official REST / SDK API จริง 100% โดยไม่มีการจำลองข้อความหลอก (Zero Mockup) คีย์ทั้งหมดถูกเก็บในฐานข้อมูล SQLite ฝั่งเซิร์ฟเวอร์อย่างปลอดภัย (หรือตั้งค่าผ่านไฟล์ <code className="text-amber-300">.env</code> ก็ได้) และสามารถกดปุ่ม <strong>"ทดสอบยิง API จริง"</strong> เพื่อเช็คสถานะแต่ละค่ายได้ทันที
          </p>
        </div>

        {settings && (
          <form onSubmit={handleSaveSettings} className="space-y-5">
            {/* Default AI Router */}
            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-extrabold text-[#0d2546] flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#f59e0b]" />
                  ค่าเริ่มต้น AI Provider สำหรับระบบ 8-Agent Workflow & ผู้ช่วยเขียนโพสต์
                </label>
                <div className="flex flex-wrap gap-1.5 text-[10.5px] font-bold">
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasGeminiKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    Gemini: {settings.hasGeminiKey ? 'พร้อมใช้' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasClaudeKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    Claude: {settings.hasClaudeKey ? 'พร้อมใช้' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasDeepseekKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    DeepSeek: {settings.hasDeepseekKey ? 'พร้อมใช้' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasOpenaiKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    ChatGPT: {settings.hasOpenaiKey ? 'พร้อมใช้' : 'ยังไม่ใส่คีย์'}
                  </span>
                </div>
              </div>
              <select
                value={settings.provider}
                onChange={(e) =>
                  setSettings({ ...settings, provider: e.target.value as any })
                }
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-[#0d2546]"
              >
                <option value="auto">
                  Auto Router (เลือกคีย์จริงที่พร้อมใช้งานอัตโนมัติ: Gemini → Claude → DeepSeek → ChatGPT → Custom Server)
                </option>
                <option value="gemini">Google Gemini API (@google/genai Interactions API)</option>
                <option value="claude">Anthropic Claude API (api.anthropic.com)</option>
                <option value="deepseek">DeepSeek API V3 / R1 (api.deepseek.com)</option>
                <option value="openai">OpenAI ChatGPT API (api.openai.com)</option>
                <option value="openai_compatible">
                  Custom / Local OpenAI-Compatible Server (vLLM / Ollama / Omni AI)
                </option>
              </select>
            </div>

            {/* 4 Major LLM Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1. GOOGLE GEMINI + NANO BANANA + OMNI VIDEO + TTS */}
              <div className="rounded-2xl bg-white border-2 border-sky-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="rounded-full bg-sky-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      GOOGLE GEMINI + FLOW + VIDEO + TTS
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                      Google AI Studio (คีย์เดียวครบ: Chat, ภาพ, วิดีโอ & เสียงไทย)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'gemini'}
                    onClick={() =>
                      runLiveTest(
                        'gemini',
                        settings.geminiModel,
                        secrets.geminiApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-sky-50 border border-sky-200 px-3 py-1.5 text-xs font-extrabold text-sky-900 hover:bg-sky-100 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'gemini' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-sky-600" />
                    )}
                    ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    GEMINI_API_KEY{' '}
                    {settings.hasGeminiKey && (
                      <span className="text-emerald-600">
                        (บันทึกแล้ว: {settings.geminiKeyMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={secrets.geminiApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, geminiApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasGeminiKey
                        ? 'เว้นว่างหากใช้คีย์เดิม หรือวางคีย์ใหม่เพื่อเปลี่ยน...'
                        : 'วาง Google Gemini API Key (AIza...)'
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      โมเดล Chat & Multi-Agent
                    </label>
                    <select
                      value={settings.geminiModel}
                      onChange={(e) =>
                        setSettings({ ...settings, geminiModel: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                    >
                      <option value="gemini-3.8-flash">gemini-3.8-flash (แนะนำ)</option>
                      <option value="gemini-4-argon">gemini-4-argon (ลึกสุด)</option>
                      <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (เร็ว)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      โมเดลสร้างภาพจริง & Keyframes
                    </label>
                    <select
                      value={settings.geminiImageModel}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          geminiImageModel: e.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                    >
                      <option value="gemini-nano-banana-2.1">gemini-nano-banana-2.1</option>
                      <option value="gemini-3-pro-image">gemini-3-pro-image</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  * คีย์นี้ปลดล็อกวิดีโอ <strong>gemini-omni-1.1-flash</strong> (Text/Image/First-Last Frame Flow) และเสียงพากย์ไทย <strong>gemini-3.8-flash-tts</strong> ทันที
                </p>
                {testResults.gemini && (
                  <div
                    className={`rounded-xl p-2.5 text-xs font-semibold ${
                      testResults.gemini.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.gemini.text}
                  </div>
                )}
              </div>

              {/* 2. ANTHROPIC CLAUDE */}
              <div className="rounded-2xl bg-white border border-amber-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="rounded-full bg-amber-700 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      ANTHROPIC CLAUDE
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                      Claude 4 Sonnet / Opus & 3.7 Sonnet
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'claude'}
                    onClick={() =>
                      runLiveTest(
                        'claude',
                        settings.claudeModel,
                        secrets.claudeApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-extrabold text-amber-950 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'claude' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ANTHROPIC_API_KEY{' '}
                    {settings.hasClaudeKey && (
                      <span className="text-emerald-600">
                        (บันทึกแล้ว: {settings.claudeKeyMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={secrets.claudeApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, claudeApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasClaudeKey
                        ? 'เว้นว่างหากใช้คีย์เดิม...'
                        : 'วาง Anthropic API Key (sk-ant-...)'
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    รุ่นโมเดล Claude
                  </label>
                  <select
                    value={settings.claudeModel}
                    onChange={(e) =>
                      setSettings({ ...settings, claudeModel: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514 (แนะนำ)</option>
                    <option value="claude-opus-4-20250514">claude-opus-4-20250514 (สูงสุด)</option>
                    <option value="claude-3-7-sonnet-latest">claude-3-7-sonnet-latest</option>
                    <option value="claude-3-5-haiku-latest">claude-3-5-haiku-latest (เร็ว)</option>
                  </select>
                </div>

                {testResults.claude && (
                  <div
                    className={`rounded-xl p-2.5 text-xs font-semibold ${
                      testResults.claude.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.claude.text}
                  </div>
                )}
              </div>

              {/* 3. DEEPSEEK (V3 & R1) */}
              <div className="rounded-2xl bg-white border border-indigo-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      DEEPSEEK V3 & R1
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                      DeepSeek Chat (V3) & Reasoner (R1 Thinking)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'deepseek'}
                    onClick={() =>
                      runLiveTest(
                        'deepseek',
                        settings.deepseekModel,
                        secrets.deepseekApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-extrabold text-indigo-950 hover:bg-indigo-100 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'deepseek' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                    ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    DEEPSEEK_API_KEY{' '}
                    {settings.hasDeepseekKey && (
                      <span className="text-emerald-600">
                        (บันทึกแล้ว: {settings.deepseekKeyMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={secrets.deepseekApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, deepseekApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasDeepseekKey
                        ? 'เว้นว่างหากใช้คีย์เดิม...'
                        : 'วาง DeepSeek API Key (sk-...)'
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    รุ่นโมเดล DeepSeek
                  </label>
                  <select
                    value={settings.deepseekModel}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        deepseekModel: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    <option value="deepseek-chat">deepseek-chat (DeepSeek-V3 เร็วและคุ้มค่า)</option>
                    <option value="deepseek-reasoner">deepseek-reasoner (DeepSeek-R1 แสดงวิธีคิดเชิงลึก)</option>
                  </select>
                </div>

                {testResults.deepseek && (
                  <div
                    className={`rounded-xl p-2.5 text-xs font-semibold ${
                      testResults.deepseek.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.deepseek.text}
                  </div>
                )}
              </div>

              {/* 4. OPENAI CHATGPT + DALL-E + TTS */}
              <div className="rounded-2xl bg-white border border-emerald-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      OPENAI CHATGPT + DALL-E + TTS
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                      GPT-4.1 / GPT-4o / o3-mini + DALL-E 3
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'openai'}
                    onClick={() =>
                      runLiveTest(
                        'openai',
                        settings.openaiModel,
                        secrets.openaiApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-extrabold text-emerald-950 hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'openai' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                    ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    OPENAI_API_KEY{' '}
                    {settings.hasOpenaiKey && (
                      <span className="text-emerald-600">
                        (บันทึกแล้ว: {settings.openaiKeyMasked})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={secrets.openaiApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, openaiApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasOpenaiKey
                        ? 'เว้นว่างหากใช้คีย์เดิม...'
                        : 'วาง OpenAI API Key (sk-proj-...)'
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    รุ่นโมเดล ChatGPT
                  </label>
                  <select
                    value={settings.openaiModel}
                    onChange={(e) =>
                      setSettings({ ...settings, openaiModel: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    <option value="gpt-4.1">gpt-4.1 (แนะนำ)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4o-mini">gpt-4o-mini (ความเร็วสูง)</option>
                    <option value="o3-mini">o3-mini (Reasoning)</option>
                  </select>
                </div>

                {testResults.openai && (
                  <div
                    className={`rounded-xl p-2.5 text-xs font-semibold ${
                      testResults.openai.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.openai.text}
                  </div>
                )}
              </div>
            </div>

            {/* GOOGLE VEO 3.1 GA ON VERTEX AI ENTERPRISE */}
            <div className="rounded-2xl bg-white border border-purple-200 p-5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-700 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                    <Film className="w-3 h-3" /> GOOGLE VEO 3.1 / 3.0 GA (VERTEX AI ENTERPRISE)
                  </span>
                  <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                    การเชื่อมต่อ Google Cloud Vertex AI Veo (:predictLongRunning)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ทางเลือกเพิ่มเติมสำหรับองค์กรที่ใช้ GCP Vertex AI (หากมีเพียง GEMINI_API_KEY ด้านบน สามารถสร้างวิดีโอด้วย <strong>gemini-omni-1.1-flash</strong> ในเมนู Google Flow & Veo Studio ได้ทันทีโดยไม่ต้องกรอกส่วนนี้)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    GCP Project ID
                  </label>
                  <input
                    type="text"
                    value={settings.vertexProjectId}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        vertexProjectId: e.target.value,
                      })
                    }
                    placeholder="my-gcp-project-id"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vertex Region
                  </label>
                  <input
                    type="text"
                    value={settings.vertexLocation}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        vertexLocation: e.target.value,
                      })
                    }
                    placeholder="us-central1"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รุ่นโมเดล Google Veo GA
                  </label>
                  <select
                    value={settings.vertexVeoModel}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        vertexVeoModel: e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    <option value="veo-3.1-generate-001">veo-3.1-generate-001</option>
                    <option value="veo-3.1-fast-generate-001">veo-3.1-fast-generate-001</option>
                    <option value="veo-3.0-generate-001">veo-3.0-generate-001</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    OAuth Bearer Token{' '}
                    {settings.hasVertexToken && (
                      <span className="text-emerald-600">({settings.vertexTokenMasked})</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={secrets.vertexAccessToken}
                    onChange={(e) =>
                      setSecrets({
                        ...secrets,
                        vertexAccessToken: e.target.value,
                      })
                    }
                    placeholder="เว้นว่างเพื่อใช้ gcloud auth อัตโนมัติ"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* ELEVENLABS TTS + RESEND EMAIL + LOCAL OPENAI SERVER */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
                <h3 className="font-extrabold text-sm text-[#0d2546]">
                  ElevenLabs Voice TTS & Resend Email Newsletter API
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      ELEVENLABS_API_KEY{' '}
                      {settings.hasElevenlabsKey && (
                        <span className="text-emerald-600">
                          ({settings.elevenlabsKeyMasked})
                        </span>
                      )}
                    </label>
                    <input
                      type="password"
                      value={secrets.elevenlabsApiKey}
                      onChange={(e) =>
                        setSecrets({
                          ...secrets,
                          elevenlabsApiKey: e.target.value,
                        })
                      }
                      placeholder="ElevenLabs API Key (ทางเลือก)"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      ElevenLabs Voice ID
                    </label>
                    <input
                      type="text"
                      value={settings.elevenlabsVoiceId}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          elevenlabsVoiceId: e.target.value,
                        })
                      }
                      placeholder="JBFqnCBsd6RMkjVDRZzb"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      RESEND_API_KEY (ส่ง Email จริง){' '}
                      {settings.hasResendKey && (
                        <span className="text-emerald-600">
                          ({settings.resendKeyMasked})
                        </span>
                      )}
                    </label>
                    <input
                      type="password"
                      value={secrets.resendApiKey}
                      onChange={(e) =>
                        setSecrets({ ...secrets, resendApiKey: e.target.value })
                      }
                      placeholder="re_xxxxxxxxx"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      อีเมลผู้ส่ง (Resend From)
                    </label>
                    <input
                      type="text"
                      value={settings.resendFromEmail}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          resendFromEmail: e.target.value,
                        })
                      }
                      placeholder="Komkrit <onboarding@resend.dev>"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-extrabold text-sm text-[#0d2546]">
                    Custom / Local OpenAI-Compatible Server
                  </h3>
                  <button
                    type="button"
                    disabled={testingProvider === 'openai_compatible'}
                    onClick={() =>
                      runLiveTest(
                        'openai_compatible',
                        settings.localModel,
                        secrets.localApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-600" /> ทดสอบเซิร์ฟเวอร์
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Endpoint URL (/v1/chat/completions)
                    </label>
                    <input
                      type="text"
                      value={settings.localEndpoint}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          localEndpoint: e.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Model ID
                    </label>
                    <input
                      type="text"
                      value={settings.localModel}
                      onChange={(e) =>
                        setSettings({ ...settings, localModel: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                </div>
                {testResults.openai_compatible && (
                  <div
                    className={`rounded-xl p-2 text-xs font-semibold ${
                      testResults.openai_compatible.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.openai_compatible.text}
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Save Bar */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                เมื่อกรอกคีย์แล้วกด <strong>"บันทึกการตั้งค่า API ทั้งหมด"</strong> เพื่อเปิดใช้งานทุกฟีเจอร์ทันที
              </div>
              <div className="flex items-center gap-3">
                {savedNotice && (
                  <span className="text-xs font-extrabold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> บันทึกคีย์และการตั้งค่าสำเร็จ!
                  </span>
                )}
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0d2546] px-6 py-2.5 text-xs font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shadow-xs"
                >
                  <Save className="w-4 h-4 text-amber-300" /> บันทึกการตั้งค่า API ทั้งหมด
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Audience Comments */}
      <div className="lg:col-span-6 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
        <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#f59e0b]" />
          เสียงสะท้อนจากผู้ชม & คอมเมนต์ ({comments.length})
        </h3>
        <div className="space-y-2.5 max-h-[460px] overflow-y-auto">
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-[#0d2546]">{c.authorName}</span>{' '}
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                    {c.authorRole}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    await api.deleteComment(c.id);
                    await loadData();
                    await onRefreshStats();
                  }}
                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-slate-700 font-body">{c.message}</p>
              <div className="mt-1 text-[10.5px] text-slate-400">
                ในโพสต์: {c.postTitle} • ★ {c.rating}/5 • {formatThaiDate(c.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contacts & Newsletter Subscribers */}
      <div className="lg:col-span-6 space-y-5">
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-600" />
            ข้อความติดต่อจากหน้าเว็บ ({contacts.length})
          </h3>
          {contacts.length === 0 ? (
            <p className="text-xs text-slate-400">ยังไม่มีข้อความติดต่อใหม่</p>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto">
              {contacts.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-200 p-3 text-xs"
                >
                  <div className="flex items-center justify-between font-bold text-[#0d2546]">
                    <span>
                      {m.name} ({m.email})
                    </span>
                    <button
                      onClick={async () => {
                        await api.deleteContact(m.id);
                        await loadData();
                        await onRefreshStats();
                      }}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-[11px] font-semibold text-amber-800">
                    {m.subject}
                  </div>
                  <p className="mt-1 text-slate-600">{m.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            สมาชิกรับข่าวสาร Email / Newsletter ({subscribers.length})
          </h3>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {subscribers.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-bold text-[#0d2546]">{s.email}</span>
                  {s.name && <span className="text-slate-500"> ({s.name})</span>}
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                    {s.role}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    await api.deleteSubscriber(s.id);
                    await loadData();
                    await onRefreshStats();
                  }}
                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
