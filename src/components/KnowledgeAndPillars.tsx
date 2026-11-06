import React, { useEffect, useState } from 'react';
import {
  Database,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  X,
  MessageSquare,
  Users,
  Mail,
  Save,
  KeyRound,
  Zap,
  AlertTriangle,
  RefreshCw,
  Film,
  Bot,
  ExternalLink,
  Download,
  MailCheck,
} from 'lucide-react';
import {
  KnowledgeItem,
  BusinessPillarItem,
  PostComment,
  Subscriber,
  ContactMessage,
  AiEngineSettings,
  DiscoverableProvider,
  LiveModelOption,
  UnifiedLiveModelsResponse,
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
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
    setErrorMsg(null);
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
    setErrorMsg(null);
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
    setSaving(true);
    setErrorMsg(null);
    try {
      if (editingId) {
        await api.updateKnowledge(editingId, form);
      } else {
        await api.createKnowledge(form);
      }
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (k: KnowledgeItem) => {
    setErrorMsg(null);
    try {
      await api.updateKnowledge(k.id, { isActive: !k.isActive });
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    setErrorMsg(null);
    try {
      await api.deleteKnowledge(id);
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
        <div>
          <h2 className="text-xl font-extrabold text-[#0d2546] flex items-center gap-2">
            <Database className="w-5 h-5 text-[#f59e0b]" />
            คลังข้อมูลสอน AI (Knowledge Base) — ทั้งหมด {items.length} รายการ
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            ข้อมูลที่เปิดใช้งานจะถูกส่งให้ AI แชท, นักเขียนข่าว และทีม AI อ้างอิงอัตโนมัติทุกครั้ง
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2.5 text-sm font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4 text-amber-300" /> เพิ่มข้อมูลสอน AI ใหม่
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

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
                    title="ลบรายการนี้"
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
                {editingId ? 'แก้ไขข้อมูลสอน AI' : 'เพิ่มข้อมูลสอน AI ใหม่'}
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
                <label className="block text-xs font-bold mb-1">ชื่อหัวข้อข้อมูล *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">หมวดหมู่ข้อมูล</label>
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
                <label className="block text-xs font-bold mb-1">สรุปใจความสำคัญ *</label>
                <input
                  type="text"
                  required
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">รายละเอียดเนื้อหาสำหรับสอน AI *</label>
                <textarea
                  rows={4}
                  required
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-body"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">แหล่งอ้างอิง (ถ้ามี)</label>
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
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
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
  const [saving, setSaving] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setErrText(null);
    try {
      await api.updatePillar(editing.id, editing);
      setEditing(null);
      await onRefresh();
    } catch (err) {
      setErrText((err as Error).message);
    } finally {
      setSaving(false);
    }
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
          จัดการเป้าหมายและตัวชี้วัดทั้ง 5 ด้านที่แสดงบนหน้าเว็บไซต์หลัก (กดปุ่มดินสอเพื่อแก้ไขได้ทันที)
        </p>
      </div>

      {errText && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs font-bold text-rose-800">
          {errText}
        </div>
      )}

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
                  title="แก้ไขเสาหลักนี้"
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
                <label className="block text-xs font-bold mb-1">หัวข้อหลัก</label>
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
                />
              </div>
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
              <div>
                <label className="block text-xs font-bold mb-1">ป้ายสถานะ (Badge)</label>
                <input
                  type="text"
                  value={editing.statusBadge || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, statusBadge: e.target.value })
                  }
                  placeholder="เช่น กำลังดำเนินการ / เป้าหมายปี 2569"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#0d2546] px-5 py-2 text-xs font-extrabold text-white cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
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
  const [savingAll, setSavingAll] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [liveModels, setLiveModels] = useState<UnifiedLiveModelsResponse | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [fetchingSingle, setFetchingSingle] = useState<string | null>(null);

  // Quick Add Subscriber state in Inbox mode
  const [newSubEmail, setNewSubEmail] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  const loadData = async (forceModelRefresh = false) => {
    try {
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
        const [st, lm] = await Promise.all([
          api.getAiSettings(),
          api.getLiveModels(forceModelRefresh),
        ]);
        setSettings(st);
        setLiveModels(lm);
      }
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const handleRefreshAllModels = async () => {
    setRefreshingModels(true);
    setActionError(null);
    try {
      const lm = await api.getLiveModels(true);
      setLiveModels(lm);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setRefreshingModels(false);
    }
  };

  const handleFetchProviderModelsLive = async (
    provider: DiscoverableProvider,
    typedKey?: string
  ) => {
    setFetchingSingle(provider);
    setActionError(null);
    try {
      const cat = await api.discoverProviderModels({
        provider,
        apiKey: typedKey?.trim() || undefined,
        endpoint: provider === 'openai_compatible' ? settings?.localEndpoint : undefined,
        projectId: provider === 'vertex_veo' ? settings?.vertexProjectId : undefined,
        location: provider === 'vertex_veo' ? settings?.vertexLocation : undefined,
      });
      setLiveModels((prev) => ({
        fetchedAt: new Date().toISOString(),
        providers: {
          ...(prev?.providers || ({} as any)),
          [provider]: cat,
        },
      }));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setFetchingSingle(null);
    }
  };

  const renderLiveOptions = (
    options: LiveModelOption[] | undefined,
    currentVal: string | undefined,
    hasKey: boolean
  ) => {
    const list = options || [];
    const val = (currentVal || '').trim();
    const autoLabel =
      list.length > 0
        ? `✨ ดึงรุ่นใหม่ล่าสุดอัตโนมัติ (${list[0].id})`
        : hasKey
        ? '✨ ดึงรุ่นใหม่ล่าสุดจาก API อัตโนมัติ'
        : 'เชื่อมต่อ API Key เพื่อดึงโมเดลล่าสุดอัตโนมัติ';

    return (
      <>
        <option value="">{autoLabel}</option>
        {val && !list.some((m) => m.id === val) && (
          <option value={val}>{val}</option>
        )}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </>
    );
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const persistCurrentSettingsToCloud = async (
    currentSettings: AiEngineSettings,
    currentSecrets: typeof secrets
  ) => {
    await api.saveAiSettings({
      provider: currentSettings.provider,
      geminiModel: currentSettings.geminiModel,
      geminiImageModel: currentSettings.geminiImageModel,
      geminiVideoModel: currentSettings.geminiVideoModel,
      geminiTtsModel: currentSettings.geminiTtsModel || '',
      geminiApiKey: currentSecrets.geminiApiKey.trim()
        ? currentSecrets.geminiApiKey.trim()
        : '__KEEP__',
      claudeModel: currentSettings.claudeModel,
      claudeApiKey: currentSecrets.claudeApiKey.trim()
        ? currentSecrets.claudeApiKey.trim()
        : '__KEEP__',
      deepseekModel: currentSettings.deepseekModel,
      deepseekApiKey: currentSecrets.deepseekApiKey.trim()
        ? currentSecrets.deepseekApiKey.trim()
        : '__KEEP__',
      openaiModel: currentSettings.openaiModel,
      openaiApiKey: currentSecrets.openaiApiKey.trim()
        ? currentSecrets.openaiApiKey.trim()
        : '__KEEP__',
      vertexProjectId: currentSettings.vertexProjectId,
      vertexLocation: currentSettings.vertexLocation,
      vertexVeoModel: currentSettings.vertexVeoModel,
      vertexAccessToken: currentSecrets.vertexAccessToken.trim()
        ? currentSecrets.vertexAccessToken.trim()
        : '__KEEP__',
      elevenlabsModel: currentSettings.elevenlabsModel || '',
      elevenlabsVoiceId: currentSettings.elevenlabsVoiceId,
      elevenlabsApiKey: currentSecrets.elevenlabsApiKey.trim()
        ? currentSecrets.elevenlabsApiKey.trim()
        : '__KEEP__',
      resendFromEmail: currentSettings.resendFromEmail,
      resendApiKey: currentSecrets.resendApiKey.trim()
        ? currentSecrets.resendApiKey.trim()
        : '__KEEP__',
      localEndpoint: currentSettings.localEndpoint,
      localModel: currentSettings.localModel,
      localApiKey: currentSecrets.localApiKey.trim()
        ? currentSecrets.localApiKey.trim()
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
    await loadData(true);
    await onRefreshStats();
  };

  if (mode === 'settings') {
    const handleSaveSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!settings) return;
      setSavingAll(true);
      setActionError(null);
      try {
        await persistCurrentSettingsToCloud(settings, secrets);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 4000);
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        setSavingAll(false);
      }
    };

    // 1-CLICK AUTO-SAVE + LIVE PING VERIFICATION!
    const saveAndRunLiveTest = async (
      provider: 'gemini' | 'claude' | 'deepseek' | 'openai' | 'openai_compatible',
      model?: string,
      typedKey?: string
    ) => {
      if (!settings) return;
      setTestingProvider(provider);
      setActionError(null);
      try {
        // Save any newly typed keys/models to Encrypted Cloud SQLite FIRST so user never loses them!
        await persistCurrentSettingsToCloud(settings, secrets);
        const res = await api.testAiProvider({
          provider,
          model,
          apiKey: typedKey?.trim() || undefined,
        });
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            ok: true,
            text: `✓ บันทึกคีย์ถาวร & เชื่อมต่อ ${res.engineLabel} สำเร็จ (${res.latencyMs} ms) — ตอบกลับจริง: "${res.sampleReply}"`,
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

    const saveAndTestExtra = async (
      service: 'elevenlabs' | 'resend',
      typedKey?: string
    ) => {
      if (!settings) return;
      setTestingProvider(service);
      setActionError(null);
      try {
        await persistCurrentSettingsToCloud(settings, secrets);
        const res = await api.testExtraService({
          service,
          apiKey: typedKey?.trim() || undefined,
        });
        setTestResults((prev) => ({
          ...prev,
          [service]: {
            ok: true,
            text: `✓ บันทึกคีย์ถาวร & ${res.detail} (${res.latencyMs} ms)`,
          },
        }));
      } catch (err) {
        setTestResults((prev) => ({
          ...prev,
          [service]: {
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
                  🔒 เข้ารหัส AES-256-GCM รายฟิลด์ • จำคีย์ถาวรไม่หาย • ดึงโมเดลล่าสุดจาก API เสมอ
                </span>
                <h2 className="mt-1 text-lg sm:text-xl font-extrabold">
                  ตู้นิรภัยคีย์ AI (วางคีย์แล้วกด "บันทึก & ทดสอบยิง API จริง" ระบบจะเข้ารหัสและจำคีย์ไว้ถาวร)
                </h2>
              </div>
            </div>
            <button
              type="button"
              disabled={refreshingModels}
              onClick={handleRefreshAllModels}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 border border-white/25 px-3.5 py-2 text-xs font-extrabold text-amber-300 hover:bg-white/25 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshingModels ? 'animate-spin' : ''}`}
              />
              {refreshingModels
                ? 'กำลังดึงโมเดลล่าสุดจาก API...'
                : 'ดึงรายชื่อโมเดลล่าสุดจาก API สด'}
            </button>
          </div>
          <p className="mt-2 text-xs sm:text-sm text-slate-200 leading-relaxed">
            <strong>วิธีง่ายที่สุด:</strong> เพียงวางคีย์ช่อง <strong>Google Gemini (AI Studio)</strong> ช่องเดียวแล้วกดปุ่ม{' '}
            <strong className="text-amber-300">"บันทึก & ทดสอบยิง API จริง"</strong> ระบบจะดึงรายชื่อโมเดลใหม่ล่าสุดจาก API ของแต่ละค่ายโดยตรงและตั้งค่าให้พร้อมใช้ทั้ง แชท AI, เขียนข่าว, สร้างภาพปก, สร้างวิดีโอ Google Veo และเสียงพากย์ภาษาไทยทันทีครับ
          </p>
        </div>

        {actionError && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-bold text-rose-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {settings && (
          <form onSubmit={handleSaveSettings} className="space-y-5">
            {/* Default AI Router */}
            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-extrabold text-[#0d2546] flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#f59e0b]" />
                  เลือกค่าย AI หลักที่ต้องการใช้เป็นค่าเริ่มต้น
                </label>
                <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasGeminiKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    Gemini: {settings.hasGeminiKey ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasClaudeKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    Claude: {settings.hasClaudeKey ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasDeepseekKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    DeepSeek: {settings.hasDeepseekKey ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่ใส่คีย์'}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 ${
                      settings.hasOpenaiKey
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    ChatGPT: {settings.hasOpenaiKey ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่ใส่คีย์'}
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
                  เลือกอัตโนมัติ (ใช้คีย์ที่เชื่อมต่อแล้วทันที: Gemini → Claude → ChatGPT → DeepSeek)
                </option>
                <option value="gemini">Google Gemini API</option>
                <option value="claude">Anthropic Claude API</option>
                <option value="deepseek">DeepSeek API (V3 / R1)</option>
                <option value="openai">OpenAI ChatGPT API</option>
                <option value="openai_compatible">
                  เซิร์ฟเวอร์ AI ส่วนตัว (OpenAI-Compatible)
                </option>
              </select>
            </div>

            {/* 4 Major LLM Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1. GOOGLE GEMINI + NANO BANANA + VEO / OMNI VIDEO + TTS */}
              <div className="rounded-2xl bg-white border-2 border-sky-300 p-5 shadow-2xs space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <span className="rounded-full bg-sky-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      แนะนำอันดับ 1 • GOOGLE GEMINI + VEO + FLOW + TTS
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm sm:text-base text-[#0d2546]">
                      Google AI Studio (คีย์เดียวได้ครบ: แชท, ภาพ, คลิปวิดีโอ & เสียงไทย)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'gemini'}
                    onClick={() =>
                      saveAndRunLiveTest(
                        'gemini',
                        settings.geminiModel,
                        secrets.geminiApiKey
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-sky-700 cursor-pointer disabled:opacity-50 shadow-2xs"
                  >
                    {testingProvider === 'gemini' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-amber-300" />
                    )}
                    บันทึก & ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      GEMINI_API_KEY{' '}
                      {settings.hasGeminiKey && (
                        <span className="text-emerald-600 font-extrabold">
                          (เชื่อมต่อแล้ว: {settings.geminiKeyMasked})
                        </span>
                      )}
                    </label>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-sky-700 hover:underline"
                    >
                      ขอรับคีย์ที่ Google AI Studio <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={secrets.geminiApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, geminiApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasGeminiKey
                        ? `เข้ารหัสและจำคีย์ไว้แล้ว (${settings.geminiKeyMasked}) — วางคีย์ใหม่เฉพาะเมื่อต้องการเปลี่ยน`
                        : 'วางคีย์ที่ขึ้นต้นด้วย AIza... แล้วกดปุ่มสีฟ้าด้านบน'
                    }
                    className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-sky-800">
                    รายชื่อโมเดลสดจาก Google `/v1beta/models`:
                  </span>
                  <button
                    type="button"
                    disabled={fetchingSingle === 'gemini'}
                    onClick={() =>
                      handleFetchProviderModelsLive('gemini', secrets.geminiApiKey)
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:underline cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${
                        fetchingSingle === 'gemini' ? 'animate-spin' : ''
                      }`}
                    />
                    รีเฟรชโมเดลจาก API
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      โมเดลแชท & เขียนข่าว
                    </label>
                    <select
                      value={settings.geminiModel}
                      onChange={(e) =>
                        setSettings({ ...settings, geminiModel: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                    >
                      {renderLiveOptions(
                        liveModels?.providers.gemini.textModels,
                        settings.geminiModel,
                        settings.hasGeminiKey || Boolean(secrets.geminiApiKey.trim())
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      โมเดลสร้างรูปภาพจริง
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
                      {renderLiveOptions(
                        liveModels?.providers.gemini.imageModels,
                        settings.geminiImageModel,
                        settings.hasGeminiKey || Boolean(secrets.geminiApiKey.trim())
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      โมเดลสร้างวิดีโอจริง
                    </label>
                    <select
                      value={settings.geminiVideoModel}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          geminiVideoModel: e.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                    >
                      {renderLiveOptions(
                        liveModels?.providers.gemini.videoModels,
                        settings.geminiVideoModel,
                        settings.hasGeminiKey || Boolean(secrets.geminiApiKey.trim())
                      )}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  * ระบบดึงรายชื่อโมเดลแชท ภาพ วิดีโอ Veo และเสียงพากย์ TTS รุ่นล่าสุดจาก Google API โดยอัตโนมัติเสมอ
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
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <span className="rounded-full bg-amber-700 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      ANTHROPIC CLAUDE
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm sm:text-base text-[#0d2546]">
                      Anthropic Claude (ดึงโมเดลล่าสุดจาก `/v1/models`)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'claude'}
                    onClick={() =>
                      saveAndRunLiveTest(
                        'claude',
                        settings.claudeModel,
                        secrets.claudeApiKey
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-amber-800 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'claude' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-amber-200" />
                    )}
                    บันทึก & ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      ANTHROPIC_API_KEY{' '}
                      {settings.hasClaudeKey && (
                        <span className="text-emerald-600 font-extrabold">
                          (เชื่อมต่อแล้ว: {settings.claudeKeyMasked})
                        </span>
                      )}
                    </label>
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-800 hover:underline"
                    >
                      ขอรับคีย์ Claude <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={secrets.claudeApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, claudeApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasClaudeKey
                        ? `เข้ารหัสและจำคีย์ไว้แล้ว (${settings.claudeKeyMasked}) — วางคีย์ใหม่หากต้องการเปลี่ยน`
                        : 'วางคีย์ที่ขึ้นต้นด้วย sk-ant-...'
                    }
                    className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      รุ่นโมเดล Claude (ดึงสดจาก Anthropic /v1/models)
                    </label>
                    <button
                      type="button"
                      disabled={fetchingSingle === 'claude' || refreshingModels}
                      onClick={() =>
                        handleFetchProviderModelsLive('claude', secrets.claudeApiKey)
                      }
                      className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-amber-800 hover:underline cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${
                          fetchingSingle === 'claude' ? 'animate-spin' : ''
                        }`}
                      />
                      ดึงโมเดลล่าสุด
                    </button>
                  </div>
                  <select
                    value={settings.claudeModel}
                    onChange={(e) =>
                      setSettings({ ...settings, claudeModel: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    {renderLiveOptions(
                      liveModels?.providers?.claude?.textModels,
                      settings.claudeModel,
                      settings.hasClaudeKey
                    )}
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
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      DEEPSEEK V3 & R1
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm sm:text-base text-[#0d2546]">
                      DeepSeek Chat (V3) & Reasoner (R1 คิดวิเคราะห์)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'deepseek'}
                    onClick={() =>
                      saveAndRunLiveTest(
                        'deepseek',
                        settings.deepseekModel,
                        secrets.deepseekApiKey
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-indigo-700 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'deepseek' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-amber-200" />
                    )}
                    บันทึก & ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      DEEPSEEK_API_KEY{' '}
                      {settings.hasDeepseekKey && (
                        <span className="text-emerald-600 font-extrabold">
                          (เชื่อมต่อแล้ว: {settings.deepseekKeyMasked})
                        </span>
                      )}
                    </label>
                    <a
                      href="https://platform.deepseek.com/api_keys"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-indigo-700 hover:underline"
                    >
                      ขอรับคีย์ DeepSeek <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={secrets.deepseekApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, deepseekApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasDeepseekKey
                        ? `เข้ารหัสและจำคีย์ไว้แล้ว (${settings.deepseekKeyMasked}) — วางคีย์ใหม่หากต้องการเปลี่ยน`
                        : 'วางคีย์ที่ขึ้นต้นด้วย sk-...'
                    }
                    className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      รุ่นโมเดล DeepSeek (ดึงสดจาก DeepSeek /models)
                    </label>
                    <button
                      type="button"
                      disabled={fetchingSingle === 'deepseek' || refreshingModels}
                      onClick={() =>
                        handleFetchProviderModelsLive(
                          'deepseek',
                          secrets.deepseekApiKey
                        )
                      }
                      className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-indigo-700 hover:underline cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${
                          fetchingSingle === 'deepseek' ? 'animate-spin' : ''
                        }`}
                      />
                      ดึงโมเดลล่าสุด
                    </button>
                  </div>
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
                    {renderLiveOptions(
                      liveModels?.providers?.deepseek?.textModels,
                      settings.deepseekModel,
                      settings.hasDeepseekKey
                    )}
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

              {/* 4. OPENAI CHATGPT + GPT-IMAGE-1 / DALL-E + TTS */}
              <div className="rounded-2xl bg-white border border-emerald-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                      OPENAI CHATGPT + IMAGE + TTS
                    </span>
                    <h3 className="mt-1 font-extrabold text-sm sm:text-base text-[#0d2546]">
                      OpenAI ChatGPT + Image + TTS (ดึงโมเดลล่าสุดจาก `/v1/models`)
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={testingProvider === 'openai'}
                    onClick={() =>
                      saveAndRunLiveTest(
                        'openai',
                        settings.openaiModel,
                        secrets.openaiApiKey
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
                  >
                    {testingProvider === 'openai' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5 text-amber-200" />
                    )}
                    บันทึก & ทดสอบยิง API จริง
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      OPENAI_API_KEY{' '}
                      {settings.hasOpenaiKey && (
                        <span className="text-emerald-600 font-extrabold">
                          (เชื่อมต่อแล้ว: {settings.openaiKeyMasked})
                        </span>
                      )}
                    </label>
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700 hover:underline"
                    >
                      ขอรับคีย์ OpenAI <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={secrets.openaiApiKey}
                    onChange={(e) =>
                      setSecrets({ ...secrets, openaiApiKey: e.target.value })
                    }
                    placeholder={
                      settings.hasOpenaiKey
                        ? `เข้ารหัสและจำคีย์ไว้แล้ว (${settings.openaiKeyMasked}) — วางคีย์ใหม่หากต้องการเปลี่ยน`
                        : 'วางคีย์ที่ขึ้นต้นด้วย sk-proj-...'
                    }
                    className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      รุ่นโมเดล ChatGPT (ดึงสดจาก OpenAI /v1/models)
                    </label>
                    <button
                      type="button"
                      disabled={fetchingSingle === 'openai' || refreshingModels}
                      onClick={() =>
                        handleFetchProviderModelsLive('openai', secrets.openaiApiKey)
                      }
                      className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-emerald-700 hover:underline cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${
                          fetchingSingle === 'openai' ? 'animate-spin' : ''
                        }`}
                      />
                      ดึงโมเดลล่าสุด
                    </button>
                  </div>
                  <select
                    value={settings.openaiModel}
                    onChange={(e) =>
                      setSettings({ ...settings, openaiModel: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                  >
                    {renderLiveOptions(
                      liveModels?.providers?.openai?.textModels,
                      settings.openaiModel,
                      settings.hasOpenaiKey
                    )}
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

            {/* GOOGLE VEO 3.1 GA ON VERTEX AI ENTERPRISE (OPTIONAL) */}
            <div className="rounded-2xl bg-white border border-purple-200 p-5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-700 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
                    <Film className="w-3 h-3" /> ทางเลือกเสริมองค์กร • GOOGLE CLOUD VERTEX AI VEO
                  </span>
                  <h3 className="mt-1 font-extrabold text-sm text-[#0d2546]">
                    เชื่อมต่อ Google Veo ผ่าน Google Cloud Project (ไม่ต้องกรอกหากใส่ GEMINI_API_KEY ด้านบนแล้ว)
                  </h3>
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
                    รุ่นโมเดล Google Veo (ดึงสดจาก API)
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
                    {renderLiveOptions(
                      liveModels?.providers?.vertex_veo?.videoModels?.length
                        ? liveModels.providers.vertex_veo.videoModels
                        : liveModels?.providers?.gemini?.videoModels,
                      settings.vertexVeoModel,
                      settings.hasVertexToken || settings.hasGeminiKey
                    )}
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
                    placeholder="ไม่บังคับ"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* ELEVENLABS TTS + RESEND EMAIL + LOCAL OPENAI SERVER */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
                <h3 className="font-extrabold text-sm text-[#0d2546]">
                  เสียงพากย์ ElevenLabs & ระบบส่งอีเมลสมาชิก Resend (ทางเลือกเสริม)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        ELEVENLABS_API_KEY{' '}
                        {settings.hasElevenlabsKey && (
                          <span className="text-emerald-600">
                            ({settings.elevenlabsKeyMasked})
                          </span>
                        )}
                      </label>
                      <a
                        href="https://elevenlabs.io/app/settings/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10.5px] font-bold text-sky-700 hover:underline"
                      >
                        ขอคีย์
                      </a>
                    </div>
                    <input
                      type="password"
                      value={secrets.elevenlabsApiKey}
                      onChange={(e) =>
                        setSecrets({
                          ...secrets,
                          elevenlabsApiKey: e.target.value,
                        })
                      }
                      placeholder="ElevenLabs API Key"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      disabled={testingProvider === 'elevenlabs'}
                      onClick={() =>
                        saveAndTestExtra('elevenlabs', secrets.elevenlabsApiKey)
                      }
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                    >
                      <Zap className="w-3 h-3 text-amber-600" /> บันทึก & ทดสอบ ElevenLabs
                    </button>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      เสียงพากย์ ElevenLabs (ดึงจาก API สด)
                    </label>
                    {(liveModels?.providers.elevenlabs.voices?.length || 0) > 0 ? (
                      <select
                        value={settings.elevenlabsVoiceId}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            elevenlabsVoiceId: e.target.value,
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                      >
                        {renderLiveOptions(
                          liveModels?.providers.elevenlabs.voices,
                          settings.elevenlabsVoiceId,
                          settings.hasElevenlabsKey
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.elevenlabsVoiceId}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            elevenlabsVoiceId: e.target.value,
                          })
                        }
                        placeholder="ว่างไว้เพื่อดึงเสียงจาก API อัตโนมัติ"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        RESEND_API_KEY (ส่งอีเมล){' '}
                        {settings.hasResendKey && (
                          <span className="text-emerald-600">
                            ({settings.resendKeyMasked})
                          </span>
                        )}
                      </label>
                      <a
                        href="https://resend.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10.5px] font-bold text-sky-700 hover:underline"
                      >
                        ขอคีย์
                      </a>
                    </div>
                    <input
                      type="password"
                      value={secrets.resendApiKey}
                      onChange={(e) =>
                        setSecrets({ ...secrets, resendApiKey: e.target.value })
                      }
                      placeholder="re_xxxxxxxxx"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      disabled={testingProvider === 'resend'}
                      onClick={() => saveAndTestExtra('resend', secrets.resendApiKey)}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                    >
                      <Zap className="w-3 h-3 text-emerald-600" /> บันทึก & ทดสอบ Resend
                    </button>
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
                {(testResults.elevenlabs || testResults.resend) && (
                  <div className="space-y-1.5 pt-1">
                    {testResults.elevenlabs && (
                      <div
                        className={`rounded-xl p-2 text-xs font-semibold ${
                          testResults.elevenlabs.ok
                            ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                            : 'bg-rose-50 text-rose-900 border border-rose-200'
                        }`}
                      >
                        {testResults.elevenlabs.text}
                      </div>
                    )}
                    {testResults.resend && (
                      <div
                        className={`rounded-xl p-2 text-xs font-semibold ${
                          testResults.resend.ok
                            ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                            : 'bg-rose-50 text-rose-900 border border-rose-200'
                        }`}
                      >
                        {testResults.resend.text}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-extrabold text-sm text-[#0d2546]">
                    เซิร์ฟเวอร์ AI ส่วนตัว (OpenAI-Compatible)
                  </h3>
                  <button
                    type="button"
                    disabled={testingProvider === 'openai_compatible'}
                    onClick={() =>
                      saveAndRunLiveTest(
                        'openai_compatible',
                        settings.localModel,
                        secrets.localApiKey
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-600" /> บันทึก & ทดสอบ
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Endpoint URL
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-600">
                        Model (Live `/models`)
                      </label>
                      <button
                        type="button"
                        disabled={fetchingSingle === 'openai_compatible'}
                        onClick={() =>
                          handleFetchProviderModelsLive(
                            'openai_compatible',
                            secrets.localApiKey
                          )
                        }
                        className="text-[10.5px] font-bold text-sky-700 hover:underline cursor-pointer"
                      >
                        ดึงโมเดล
                      </button>
                    </div>
                    {(liveModels?.providers.openai_compatible.textModels?.length ||
                      0) > 0 ? (
                      <select
                        value={settings.localModel}
                        onChange={(e) =>
                          setSettings({ ...settings, localModel: e.target.value })
                        }
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                      >
                        {renderLiveOptions(
                          liveModels?.providers.openai_compatible.textModels,
                          settings.localModel,
                          true
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.localModel}
                        onChange={(e) =>
                          setSettings({ ...settings, localModel: e.target.value })
                        }
                        placeholder="ว่างไว้ = ดึงจาก /models อัตโนมัติ"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      />
                    )}
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

            {/* Save All Bar */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="text-xs sm:text-sm text-slate-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                คีย์ทุกตัวถูกเข้ารหัสเก็บใน Cloud อัตโนมัติ ไม่ต้องตั้งค่าใหม่เมื่อปิดเครื่องครับ
              </div>
              <div className="flex items-center gap-3">
                {savedNotice && (
                  <span className="text-xs sm:text-sm font-extrabold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> บันทึกคีย์และการตั้งค่าทั้งหมดเรียบร้อยแล้ว!
                  </span>
                )}
                <button
                  type="submit"
                  disabled={savingAll}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#0d2546] px-6 py-3 text-sm font-extrabold text-white hover:bg-[#193d6e] cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-amber-300" />
                  {savingAll ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าทั้งหมด'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    );
  }

  // ==========================================================================
  // INBOX & AUDIENCE MANAGEMENT MODE (COMMENTS, CONTACTS, SUBSCRIBERS)
  // ==========================================================================
  const handleAddSubscriberManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubEmail.trim()) return;
    setAddingSub(true);
    setActionError(null);
    try {
      await api.subscribe({
        email: newSubEmail.trim(),
        name: newSubName.trim(),
        role: 'สมาชิกเพิ่มโดยผู้ดูแล',
      });
      setNewSubEmail('');
      setNewSubName('');
      await loadData();
      await onRefreshStats();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setAddingSub(false);
    }
  };

  const handleExportSubscribersCsv = () => {
    const header = 'email,name,role,createdAt\n';
    const rows = subscribers
      .map(
        (s) =>
          `"${(s.email || '').replace(/"/g, '""')}","${(s.name || '').replace(
            /"/g,
            '""'
          )}","${(s.role || '').replace(/"/g, '""')}","${s.createdAt}"`
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `komkrit-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unreadContactCount = contacts.filter((c) => c.status === 'unread').length;

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Audience Comments */}
        <div className="lg:col-span-6 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#f59e0b]" />
              ความคิดเห็นท้ายข่าวจากผู้อ่าน ({comments.length})
            </h3>
            <button
              type="button"
              onClick={() => loadData()}
              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-[#0d2546] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
            </button>
          </div>
          {comments.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              ยังไม่มีความคิดเห็นใหม่
            </p>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-sm text-[#0d2546]">
                        {c.authorName}
                      </span>{' '}
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                        {c.authorRole}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await api.deleteComment(c.id);
                          await loadData();
                          await onRefreshStats();
                        } catch (err) {
                          setActionError((err as Error).message);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> ลบ
                    </button>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700 font-body">
                    {c.message}
                  </p>
                  <div className="mt-1.5 text-[11px] text-slate-400">
                    ในข่าว: {c.postTitle} • ★ {c.rating}/5 •{' '}
                    {formatThaiDate(c.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contacts & Newsletter Subscribers */}
        <div className="lg:col-span-6 space-y-5">
          {/* Contact Messages */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-600" />
                ข้อความติดต่อจากหน้าเว็บ ({contacts.length})
              </h3>
              {unreadContactCount > 0 && (
                <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-extrabold text-[#0b1f3a]">
                  ยังไม่อ่าน {unreadContactCount} ข้อความ
                </span>
              )}
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                ยังไม่มีข้อความติดต่อเข้ามา
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
                {contacts.map((m) => {
                  const isUnread = m.status === 'unread';
                  return (
                    <div
                      key={m.id}
                      className={`rounded-xl border p-3.5 text-xs ${
                        isUnread
                          ? 'border-amber-300 bg-amber-50/50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-extrabold text-sm text-[#0d2546] flex items-center gap-1.5">
                          <span>
                            {m.name} ({m.email})
                          </span>
                          {isUnread && (
                            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold text-[#0b1f3a]">
                              ใหม่
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isUnread && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await api.markContactRead(m.id);
                                  await loadData();
                                  await onRefreshStats();
                                } catch (err) {
                                  setActionError((err as Error).message);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-extrabold text-emerald-900 hover:bg-emerald-200 cursor-pointer"
                            >
                              <MailCheck className="w-3.5 h-3.5" /> อ่านแล้ว
                            </button>
                          )}
                          <a
                            href={`mailto:${m.email}?subject=${encodeURIComponent(
                              `ตอบกลับจาก คมคิด by KOMKRIT: ${m.subject}`
                            )}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1 text-[11px] font-bold text-sky-900 hover:bg-sky-100"
                          >
                            ตอบอีเมล
                          </a>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.deleteContact(m.id);
                                await loadData();
                                await onRefreshStats();
                              } catch (err) {
                                setActionError((err as Error).message);
                              }
                            }}
                            className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-600 hover:text-white cursor-pointer"
                            title="ลบข้อความนี้"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs font-bold text-amber-800 mt-1">
                        หัวข้อ: {m.subject}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{m.message}</p>
                      <div className="mt-1 text-[10.5px] text-slate-400">
                        ส่งเมื่อ {formatThaiDate(m.createdAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Subscribers */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-extrabold text-base text-[#0d2546] flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                สมาชิกรับข่าวสารทางอีเมล ({subscribers.length} คน)
              </h3>
              {subscribers.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportSubscribersCsv}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> ดาวน์โหลดรายชื่อ CSV
                </button>
              )}
            </div>

            {/* Quick Add Subscriber Form */}
            <form
              onSubmit={handleAddSubscriberManual}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <input
                type="email"
                required
                value={newSubEmail}
                onChange={(e) => setNewSubEmail(e.target.value)}
                placeholder="เพิ่มอีเมลสมาชิกใหม่..."
                className="sm:col-span-5 rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="ชื่อ (ไม่บังคับ)"
                className="sm:col-span-4 rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={addingSub}
                className="sm:col-span-3 inline-flex items-center justify-center gap-1 rounded-xl bg-[#0d2546] px-3 py-2 text-xs font-extrabold text-white hover:bg-[#193d6e] cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 text-amber-300" /> เพิ่มสมาชิก
              </button>
            </form>

            <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
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
                    type="button"
                    onClick={async () => {
                      try {
                        await api.deleteSubscriber(s.id);
                        await loadData();
                        await onRefreshStats();
                      } catch (err) {
                        setActionError((err as Error).message);
                      }
                    }}
                    className="text-slate-400 hover:text-rose-600 cursor-pointer p-1"
                    title="ลบสมาชิกนี้"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
