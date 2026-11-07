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
  Search,
  Copy,
  Layers,
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
  { id: 'policy', label: 'นโยบายการศึกษาและภาครัฐ (สพฐ., สช.)' },
  { id: 'research', label: 'งานวิจัย บทความวิชาการ และแหล่งอ้างอิง' },
  { id: 'komkrit_vision', label: 'วิสัยทัศน์และแนวคิดของผู้บริหาร (Komkrit)' },
  { id: 'regulation', label: 'กฎหมาย PDPA ระเบียบ และจริยธรรม' },
  { id: 'brand_guideline', label: 'มาตรฐานการสื่อสารองค์กร (Brand Guideline)' },
];

export const KnowledgeBaseManager: React.FC<{
  items: KnowledgeItem[];
  onRefresh: () => Promise<void>;
}> = ({ items, onRefresh }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [kbSearch, setKbSearch] = useState('');
  const [kbCategoryFilter, setKbCategoryFilter] = useState<string>('all');
  const [confirmDeleteKbId, setConfirmDeleteKbId] = useState<number | null>(
    null
  );
  const [form, setForm] = useState({
    title: '',
    category: 'research' as KnowledgeItem['category'],
    summary: '',
    content: '',
    sourceRef: '',
    isActive: true,
  });

  const handleDuplicateKb = async (k: KnowledgeItem) => {
    setErrorMsg(null);
    try {
      await api.createKnowledge({
        title: `${k.title} (สำเนา)`,
        category: k.category,
        summary: k.summary,
        content: k.content,
        sourceRef: k.sourceRef,
        isActive: k.isActive,
      });
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

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
    if (!form.title.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = {
        ...form,
        summary:
          form.summary.trim() ||
          form.content.trim().slice(0, 120) ||
          form.title.trim(),
      };
      if (editingId) {
        await api.updateKnowledge(editingId, payload);
      } else {
        await api.createKnowledge(payload);
      }
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message || 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (k: KnowledgeItem) => {
    try {
      await api.updateKnowledge(k.id, { isActive: !k.isActive });
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteKnowledge(id);
      await onRefresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const filteredItems = items.filter((k) => {
    if (kbCategoryFilter !== 'all' && k.category !== kbCategoryFilter) {
      return false;
    }
    if (!kbSearch.trim()) return true;
    const q = kbSearch.toLowerCase();
    return (
      k.title.toLowerCase().includes(q) ||
      k.summary.toLowerCase().includes(q) ||
      k.content.toLowerCase().includes(q) ||
      (k.sourceRef || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              คลังความรู้และข้อมูลอ้างอิงองค์กร (Knowledge Base)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ข้อมูลนโยบาย งานวิจัย และแนวคิดหลักสำหรับให้ระบบ AI ใช้อ้างอิงในการผลิตเนื้อหา (RAG)
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            เพิ่มข้อมูลอ้างอิงใหม่
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-7 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={kbSearch}
              onChange={(e) => setKbSearch(e.target.value)}
              placeholder="ค้นหาหัวข้อ เนื้อหา หรือแหล่งอ้างอิง..."
              className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-5">
            <select
              value={kbCategoryFilter}
              onChange={(e) => setKbCategoryFilter(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-700"
            >
              <option value="all">ทุกหมวดหมู่ ({items.length})</option>
              {KB_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-medium text-rose-800">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredItems.map((k) => {
          const catLabel =
            KB_CATEGORIES.find((c) => c.id === k.category)?.label || k.category;
          return (
            <div
              key={k.id}
              className={`rounded-lg bg-white border p-4 sm:p-5 shadow-2xs flex flex-col justify-between ${
                k.isActive
                  ? 'border-slate-200'
                  : 'border-slate-200 bg-slate-50 opacity-75'
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {catLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggle(k)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer ${
                      k.isActive
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        k.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                      }`}
                    />
                    {k.isActive ? 'เปิดใช้งานกับ AI' : 'ปิดชั่วคราว'}
                  </button>
                </div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900">
                  {k.title}
                </h3>
                <p className="mt-1 text-xs font-medium text-slate-700">
                  {k.summary}
                </p>
                <p className="mt-2 text-xs text-slate-500 font-body line-clamp-3">
                  {k.content}
                </p>
              </div>
              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate max-w-[180px]">
                  อ้างอิง: {k.sourceRef || '-'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(k)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateKb(k)}
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
                    title="ทำสำเนา"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {confirmDeleteKbId === k.id ? (
                    <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await handleDelete(k.id);
                          setConfirmDeleteKbId(null);
                        }}
                        className="text-[11px] font-semibold text-rose-700 cursor-pointer"
                      >
                        ยืนยันลบ
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteKbId(null)}
                        className="text-[11px] text-slate-500 cursor-pointer ml-1"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteKbId(k.id)}
                      className="rounded border border-slate-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-2xl rounded-lg bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between">
              <div className="font-bold text-sm">
                {editingId
                  ? 'แก้ไขข้อมูลในคลังความรู้'
                  : 'เพิ่มข้อมูลเข้าสู่คลังความรู้'}
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  หัวข้อข้อมูล <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    หมวดหมู่ข้อมูล
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as any })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm"
                  >
                    {KB_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    แหล่งอ้างอิง (Source Reference)
                  </label>
                  <input
                    type="text"
                    value={form.sourceRef}
                    onChange={(e) =>
                      setForm({ ...form, sourceRef: e.target.value })
                    }
                    placeholder="เช่น รายงาน สพฐ. 2026"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  สรุปใจความสำคัญ
                </label>
                <input
                  type="text"
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รายละเอียดเนื้อหาสำหรับให้ AI อ้างอิง <span className="text-rose-600">*</span>
                </label>
                <textarea
                  rows={5}
                  required
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm font-body"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
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
  const [creatingPillar, setCreatingPillar] = useState(false);
  const [confirmDeletePillarId, setConfirmDeletePillarId] = useState<
    number | null
  >(null);
  const [newPillarForm, setNewPillarForm] = useState({
    pillarNumber: pillars.length + 1,
    code: '',
    nameTh: '',
    nameEn: '',
    description: '',
    targetKpi: '',
    currentProgress: 50,
    status: 'active' as BusinessPillarItem['status'],
    leadAgent: 'AGENT CEO',
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await api.updatePillar(editing.id, editing);
    setEditing(null);
    await onRefresh();
  };

  const handleCreatePillar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPillarForm.nameTh.trim()) return;
    await api.createPillar(newPillarForm);
    setCreatingPillar(false);
    await onRefresh();
  };

  const handleDeletePillar = async (id: number) => {
    await api.deletePillar(id);
    setConfirmDeletePillarId(null);
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900">
            โครงสร้างหน่วยธุรกิจและเป้าหมายองค์กร (Business Pillars & KPI)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ติดตามตัวชี้วัดผลการดำเนินงานและความคืบหน้าของแต่ละหน่วยธุรกิจ
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewPillarForm({
              pillarNumber: pillars.length + 1,
              code: `PILLAR_${pillars.length + 1}`,
              nameTh: '',
              nameEn: '',
              description: '',
              targetKpi: '',
              currentProgress: 50,
              status: 'active',
              leadAgent: 'AGENT CEO',
            });
            setCreatingPillar(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          เพิ่มหน่วยธุรกิจใหม่
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pillars.map((p) => (
          <div
            key={p.id}
            className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
                  0{p.pillarNumber}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    p.status === 'active'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {p.status === 'active' ? 'ดำเนินการปกติ' : 'กำลังพัฒนา'}
                </span>
              </div>

              <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {p.nameEn}
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                {p.nameTh}
              </h3>
              <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                {p.description}
              </p>

              <div className="mt-4 rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">
                    ความคืบหน้า KPI
                  </span>
                  <span className="font-bold text-slate-900">
                    {p.currentProgress}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-slate-900"
                    style={{ width: `${p.currentProgress}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  เป้าหมาย: {p.targetKpi}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400 truncate max-w-[140px]">
                ผู้รับผิดชอบ: {p.leadAgent}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditing({ ...p })}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  แก้ไข
                </button>
                {confirmDeletePillarId === p.id ? (
                  <button
                    type="button"
                    onClick={() => handleDeletePillar(p.id)}
                    className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white cursor-pointer"
                  >
                    ยืนยันลบ
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeletePillarId(p.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              แก้ไขข้อมูลหน่วยธุรกิจ #{editing.pillarNumber}
            </h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อหน่วยธุรกิจ (ภาษาไทย)
                </label>
                <input
                  type="text"
                  value={editing.nameTh}
                  onChange={(e) =>
                    setEditing({ ...editing, nameTh: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รายละเอียดการดำเนินงาน
                </label>
                <textarea
                  rows={3}
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  เป้าหมายตัวชี้วัด (KPI)
                </label>
                <input
                  type="text"
                  value={editing.targetKpi}
                  onChange={(e) =>
                    setEditing({ ...editing, targetKpi: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ความคืบหน้า ({editing.currentProgress}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={editing.currentProgress}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      currentProgress: Number(e.target.value),
                    })
                  }
                  className="w-full accent-slate-900"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {creatingPillar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="my-auto w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              เพิ่มหน่วยธุรกิจใหม่
            </h3>
            <form onSubmit={handleCreatePillar} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ลำดับที่
                  </label>
                  <input
                    type="number"
                    required
                    value={newPillarForm.pillarNumber}
                    onChange={(e) =>
                      setNewPillarForm({
                        ...newPillarForm,
                        pillarNumber: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ชื่อภาษาอังกฤษ
                  </label>
                  <input
                    type="text"
                    value={newPillarForm.nameEn}
                    onChange={(e) =>
                      setNewPillarForm({
                        ...newPillarForm,
                        nameEn: e.target.value,
                      })
                    }
                    placeholder="เช่น Consulting"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อหน่วยธุรกิจ (ภาษาไทย) <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newPillarForm.nameTh}
                  onChange={(e) =>
                    setNewPillarForm({
                      ...newPillarForm,
                      nameTh: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รายละเอียดการดำเนินงาน
                </label>
                <textarea
                  rows={3}
                  value={newPillarForm.description}
                  onChange={(e) =>
                    setNewPillarForm({
                      ...newPillarForm,
                      description: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  เป้าหมาย KPI
                </label>
                <input
                  type="text"
                  value={newPillarForm.targetKpi}
                  onChange={(e) =>
                    setNewPillarForm({
                      ...newPillarForm,
                      targetKpi: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreatingPillar(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  บันทึกข้อมูล
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
  const [editingSubscriber, setEditingSubscriber] =
    useState<Subscriber | null>(null);
  const [editingComment, setEditingComment] = useState<PostComment | null>(
    null
  );
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<AiEngineSettings | null>(null);
  const [liveModels, setLiveModels] =
    useState<UnifiedLiveModelsResponse | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [fetchingSingle, setFetchingSingle] =
    useState<DiscoverableProvider | null>(null);
  const [secrets, setSecrets] = useState({
    geminiApiKey: '',
    claudeApiKey: '',
    deepseekApiKey: '',
    openaiApiKey: '',
    vertexAccessToken: '',
    elevenlabsApiKey: '',
  });
  const [savedNotice, setSavedNotice] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const loadAll = async () => {
    const [c, s, m, st, lm] = await Promise.all([
      api.getAllComments(),
      api.getSubscribers(),
      api.getContacts(),
      api.getAiSettings(),
      api.getLiveModels().catch(() => null),
    ]);
    setComments(c);
    setSubscribers(s);
    setContacts(m);
    setSettings(st);
    if (lm) setLiveModels(lm);
  };

  const applySingleProviderCatalog = (
    provider: DiscoverableProvider,
    catalog: UnifiedLiveModelsResponse['providers'][DiscoverableProvider]
  ) => {
    setLiveModels((prev) => {
      const base: UnifiedLiveModelsResponse = prev || {
        fetchedAt: new Date().toISOString(),
        providers: {
          gemini: {
            ok: false,
            textModels: [],
            imageModels: [],
            videoModels: [],
            ttsModels: [],
          },
          claude: { ok: false, textModels: [] },
          deepseek: { ok: false, textModels: [] },
          openai: {
            ok: false,
            textModels: [],
            imageModels: [],
            videoModels: [],
            ttsModels: [],
          },
          vertex_veo: { ok: false, textModels: [], videoModels: [] },
          elevenlabs: { ok: false, textModels: [], ttsModels: [] },
          openai_compatible: { ok: false, textModels: [] },
        },
      };
      return {
        fetchedAt: new Date().toISOString(),
        providers: {
          ...base.providers,
          [provider]: catalog,
        },
      };
    });

    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (provider === 'gemini') {
        if (
          catalog.textModels.length > 0 &&
          !catalog.textModels.some((m) => m.id === next.geminiModel)
        ) {
          next.geminiModel = catalog.textModels[0].id;
        }
        if (
          catalog.imageModels &&
          catalog.imageModels.length > 0 &&
          !catalog.imageModels.some((m) => m.id === next.imageModel)
        ) {
          next.imageModel = catalog.imageModels[0].id;
        }
        if (
          catalog.videoModels &&
          catalog.videoModels.length > 0 &&
          !catalog.videoModels.some((m) => m.id === next.veoModel)
        ) {
          next.veoModel = catalog.videoModels[0].id;
        }
      } else if (provider === 'claude') {
        if (
          catalog.textModels.length > 0 &&
          !catalog.textModels.some((m) => m.id === next.claudeModel)
        ) {
          next.claudeModel = catalog.textModels[0].id;
        }
      } else if (provider === 'deepseek') {
        if (
          catalog.textModels.length > 0 &&
          !catalog.textModels.some((m) => m.id === next.deepseekModel)
        ) {
          next.deepseekModel = catalog.textModels[0].id;
        }
      } else if (provider === 'openai') {
        if (
          catalog.textModels.length > 0 &&
          !catalog.textModels.some((m) => m.id === next.openaiModel)
        ) {
          next.openaiModel = catalog.textModels[0].id;
        }
      }
      return next;
    });
  };

  const handleFetchProviderModelsLive = async (
    provider: DiscoverableProvider,
    candidateKey?: string
  ) => {
    setFetchingSingle(provider);
    try {
      const cat = await api.discoverProviderModels({
        provider,
        apiKey: candidateKey?.trim() || undefined,
        vertexProjectId: settings?.vertexProjectId,
        vertexLocation: settings?.vertexLocation,
      });
      applySingleProviderCatalog(provider, cat);
    } catch {
      // ignore
    } finally {
      setFetchingSingle(null);
    }
  };

  const handleRefreshLiveModels = async () => {
    setRefreshingModels(true);
    try {
      const lm = await api.getLiveModels();
      setLiveModels(lm);
    } catch {
      // ignore
    } finally {
      setRefreshingModels(false);
    }
  };

  const renderLiveOptions = (
    options: LiveModelOption[] | undefined,
    currentVal: string | undefined,
    hasKey: boolean
  ) => {
    const val = currentVal || '';
    const list = options ? [...options] : [];
    if (list.length === 0) {
      return (
        <option value={val}>
          {hasKey
            ? val || 'กดปุ่มดึงรายชื่อโมเดลจาก API'
            : 'กรุณาบันทึก API Key ก่อนดึงรายชื่อโมเดล'}
        </option>
      );
    }
    if (val && !list.some((o) => o.id === val)) {
      list.unshift({
        id: val,
        label: `${val} (ค่าที่เลือกไว้)`,
        provider: 'custom',
        capability: 'text',
      });
    }
    return list.map((m) => (
      <option key={m.id} value={m.id}>
        {m.label}
      </option>
    ));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const updated = await api.updateAiSettings({
      ...settings,
      geminiApiKey: secrets.geminiApiKey.trim() || '__KEEP__',
      claudeApiKey: secrets.claudeApiKey.trim() || '__KEEP__',
      deepseekApiKey: secrets.deepseekApiKey.trim() || '__KEEP__',
      openaiApiKey: secrets.openaiApiKey.trim() || '__KEEP__',
      vertexAccessToken: secrets.vertexAccessToken.trim() || '__KEEP__',
      elevenlabsApiKey: secrets.elevenlabsApiKey.trim() || '__KEEP__',
    });
    setSettings(updated);
    setSecrets({
      geminiApiKey: '',
      claudeApiKey: '',
      deepseekApiKey: '',
      openaiApiKey: '',
      vertexAccessToken: '',
      elevenlabsApiKey: '',
    });
    await handleRefreshLiveModels();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3500);
  };

  const handleClearSingleKey = async (
    field:
      | 'geminiApiKey'
      | 'claudeApiKey'
      | 'deepseekApiKey'
      | 'openaiApiKey'
      | 'vertexAccessToken'
      | 'elevenlabsApiKey'
  ) => {
    if (!settings) return;
    const updated = await api.updateAiSettings({
      [field]: '__CLEAR__',
    } as any);
    setSettings(updated);
  };

  const handleTestLiveProvider = async (
    provider:
      | 'gemini'
      | 'claude'
      | 'deepseek'
      | 'openai'
      | 'vertex_veo'
      | 'elevenlabs',
    candidateKey?: string,
    model?: string
  ) => {
    setTestingKey(provider);
    try {
      const res = await api.testAiProvider({
        provider,
        apiKey: candidateKey?.trim() || undefined,
        model,
        vertexProjectId: settings?.vertexProjectId,
        vertexLocation: settings?.vertexLocation,
      });
      if (res.ok && provider !== 'elevenlabs') {
        handleFetchProviderModelsLive(
          provider as DiscoverableProvider,
          candidateKey
        );
      }
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          ok: res.ok,
          text: res.ok
            ? `เชื่อมต่อสำเร็จ (${res.latencyMs} ms): ${res.detail}`
            : `เชื่อมต่อไม่สำเร็จ: ${res.detail}`,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { ok: false, text: (err as Error).message },
      }));
    } finally {
      setTestingKey(null);
    }
  };

  if (mode === 'settings') {
    const connectedCount = [
      settings?.hasGeminiKey,
      settings?.hasClaudeKey,
      settings?.hasDeepseekKey,
      settings?.hasOpenaiKey,
    ].filter(Boolean).length;

    return (
      <div className="space-y-5">
        <div className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              การตั้งค่าการเชื่อมต่อผู้ให้บริการ AI (API Key Management)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              รหัส API Key ทั้งหมดจะถูกจัดเก็บในฐานข้อมูลฝั่งเซิร์ฟเวอร์และซ่อนค่าจริงเมื่อส่งกลับมายังหน้าจอผู้ดูแล
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800">
              เชื่อมต่อแล้ว {connectedCount} / 4 ผู้ให้บริการหลัก
            </span>
            <button
              type="button"
              onClick={handleRefreshLiveModels}
              disabled={refreshingModels}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  refreshingModels ? 'animate-spin' : ''
                }`}
              />
              ซิงก์รายชื่อโมเดลจาก API
            </button>
          </div>
        </div>

        {settings && (
          <form onSubmit={handleSaveSettings} className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1. Google Gemini */}
              <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      PRIMARY MULTIMODAL PROVIDER
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      1. Google Gemini (ข้อความ, ภาพนิ่ง, วิดีโอ Veo, เสียงบรรยาย)
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      settings.hasGeminiKey
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {settings.hasGeminiKey
                      ? `เชื่อมต่อแล้ว (${settings.geminiKeyMasked})`
                      : 'ยังไม่ได้ตั้งค่า'}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    GEMINI_API_KEY (จาก Google AI Studio)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={secrets.geminiApiKey}
                      onChange={(e) =>
                        setSecrets({ ...secrets, geminiApiKey: e.target.value })
                      }
                      onBlur={() => {
                        if (secrets.geminiApiKey.trim().length > 10) {
                          handleFetchProviderModelsLive(
                            'gemini',
                            secrets.geminiApiKey
                          );
                        }
                      }}
                      placeholder={
                        settings.hasGeminiKey
                          ? `ใช้คีย์ที่บันทึกไว้ (${settings.geminiKeyMasked}) หรือวางคีย์ใหม่เพื่อเปลี่ยน`
                          : 'วางคีย์ AIzaSy... ที่นี่'
                      }
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={testingKey === 'gemini'}
                      onClick={() =>
                        handleTestLiveProvider(
                          'gemini',
                          secrets.geminiApiKey,
                          settings.geminiModel
                        )
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      {testingKey === 'gemini' ? 'กำลังทดสอบ...' : 'ทดสอบคีย์'}
                    </button>
                    {settings.hasGeminiKey && (
                      <button
                        type="button"
                        onClick={() => handleClearSingleKey('geminiApiKey')}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                      >
                        ลบคีย์
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      โมเดลข้อความ
                    </label>
                    <select
                      value={settings.geminiModel}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          geminiModel: e.target.value,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {renderLiveOptions(
                        liveModels?.providers?.gemini?.textModels,
                        settings.geminiModel,
                        settings.hasGeminiKey
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      โมเดลรูปภาพ
                    </label>
                    <select
                      value={settings.imageModel}
                      onChange={(e) =>
                        setSettings({ ...settings, imageModel: e.target.value })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {renderLiveOptions(
                        liveModels?.providers?.gemini?.imageModels,
                        settings.imageModel,
                        settings.hasGeminiKey
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      โมเดลวิดีโอ
                    </label>
                    <select
                      value={settings.veoModel}
                      onChange={(e) =>
                        setSettings({ ...settings, veoModel: e.target.value })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {renderLiveOptions(
                        liveModels?.providers?.gemini?.videoModels,
                        settings.veoModel,
                        settings.hasGeminiKey
                      )}
                    </select>
                  </div>
                </div>

                {testResults.gemini && (
                  <div
                    className={`rounded-md p-2.5 text-xs font-medium ${
                      testResults.gemini.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.gemini.text}
                  </div>
                )}
              </div>

              {/* 2. Anthropic Claude */}
              <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      EDITORIAL & WRITING PROVIDER
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      2. Anthropic Claude (การเรียบเรียงบทความและตรวจทาน)
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      settings.hasClaudeKey
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {settings.hasClaudeKey
                      ? `เชื่อมต่อแล้ว (${settings.claudeKeyMasked})`
                      : 'ยังไม่ได้ตั้งค่า'}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ANTHROPIC_API_KEY
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={secrets.claudeApiKey}
                      onChange={(e) =>
                        setSecrets({ ...secrets, claudeApiKey: e.target.value })
                      }
                      placeholder={
                        settings.hasClaudeKey
                          ? `ใช้คีย์ที่บันทึกไว้ (${settings.claudeKeyMasked}) หรือวางคีย์ใหม่`
                          : 'วางคีย์ sk-ant-api03-...'
                      }
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={testingKey === 'claude'}
                      onClick={() =>
                        handleTestLiveProvider(
                          'claude',
                          secrets.claudeApiKey,
                          settings.claudeModel
                        )
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      {testingKey === 'claude' ? 'กำลังทดสอบ...' : 'ทดสอบคีย์'}
                    </button>
                    {settings.hasClaudeKey && (
                      <button
                        type="button"
                        onClick={() => handleClearSingleKey('claudeApiKey')}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700 cursor-pointer"
                      >
                        ลบคีย์
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    โมเดล Claude เริ่มต้น
                  </label>
                  <select
                    value={settings.claudeModel}
                    onChange={(e) =>
                      setSettings({ ...settings, claudeModel: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
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
                    className={`rounded-md p-2.5 text-xs font-medium ${
                      testResults.claude.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.claude.text}
                  </div>
                )}
              </div>

              {/* 3. DeepSeek */}
              <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      REASONING & RESEARCH PROVIDER
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      3. DeepSeek (การวิเคราะห์เชิงลึกและวิจัยข้อมูล)
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      settings.hasDeepseekKey
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {settings.hasDeepseekKey
                      ? `เชื่อมต่อแล้ว (${settings.deepseekKeyMasked})`
                      : 'ยังไม่ได้ตั้งค่า'}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    DEEPSEEK_API_KEY
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={secrets.deepseekApiKey}
                      onChange={(e) =>
                        setSecrets({
                          ...secrets,
                          deepseekApiKey: e.target.value,
                        })
                      }
                      placeholder={
                        settings.hasDeepseekKey
                          ? `ใช้คีย์ที่บันทึกไว้ (${settings.deepseekKeyMasked}) หรือวางคีย์ใหม่`
                          : 'วางคีย์ sk-...'
                      }
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={testingKey === 'deepseek'}
                      onClick={() =>
                        handleTestLiveProvider(
                          'deepseek',
                          secrets.deepseekApiKey,
                          settings.deepseekModel
                        )
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      {testingKey === 'deepseek' ? 'กำลังทดสอบ...' : 'ทดสอบคีย์'}
                    </button>
                    {settings.hasDeepseekKey && (
                      <button
                        type="button"
                        onClick={() => handleClearSingleKey('deepseekApiKey')}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700 cursor-pointer"
                      >
                        ลบคีย์
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    โมเดล DeepSeek เริ่มต้น
                  </label>
                  <select
                    value={settings.deepseekModel}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        deepseekModel: e.target.value,
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
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
                    className={`rounded-md p-2.5 text-xs font-medium ${
                      testResults.deepseek.ok
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                        : 'bg-rose-50 text-rose-900 border border-rose-200'
                    }`}
                  >
                    {testResults.deepseek.text}
                  </div>
                )}
              </div>

              {/* 4. OpenAI */}
              <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      OPENAI GPT & IMAGE PROVIDER
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">
                      4. OpenAI ChatGPT & Image Generation
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      settings.hasOpenaiKey
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {settings.hasOpenaiKey
                      ? `เชื่อมต่อแล้ว (${settings.openaiKeyMasked})`
                      : 'ยังไม่ได้ตั้งค่า'}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    OPENAI_API_KEY
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={secrets.openaiApiKey}
                      onChange={(e) =>
                        setSecrets({ ...secrets, openaiApiKey: e.target.value })
                      }
                      placeholder={
                        settings.hasOpenaiKey
                          ? `ใช้คีย์ที่บันทึกไว้ (${settings.openaiKeyMasked}) หรือวางคีย์ใหม่`
                          : 'วางคีย์ sk-proj-...'
                      }
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={testingKey === 'openai'}
                      onClick={() =>
                        handleTestLiveProvider(
                          'openai',
                          secrets.openaiApiKey,
                          settings.openaiModel
                        )
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      {testingKey === 'openai' ? 'กำลังทดสอบ...' : 'ทดสอบคีย์'}
                    </button>
                    {settings.hasOpenaiKey && (
                      <button
                        type="button"
                        onClick={() => handleClearSingleKey('openaiApiKey')}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-700 cursor-pointer"
                      >
                        ลบคีย์
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    โมเดล OpenAI เริ่มต้น
                  </label>
                  <select
                    value={settings.openaiModel}
                    onChange={(e) =>
                      setSettings({ ...settings, openaiModel: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
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
                    className={`rounded-md p-2.5 text-xs font-medium ${
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

            <div className="rounded-lg bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
              <div className="text-xs text-slate-500">
                {savedNotice ? (
                  <span className="font-semibold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    บันทึกการตั้งค่า API Key และโมเดลเรียบร้อยแล้ว
                  </span>
                ) : (
                  'คลิกปุ่มบันทึกด้านขวาเพื่ออัปเดตคีย์และโมเดลเริ่มต้นเข้าสู่ฐานข้อมูล'
                )}
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                <Save className="w-4 h-4 text-amber-400" />
                บันทึกการตั้งค่า API ทั้งหมด
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // =========================================================================
  // FEEDBACK, CONTACTS & SUBSCRIBERS CRM VIEW
  // =========================================================================
  const handleExportSubscribersCsv = () => {
    const header = 'id,name,email,role,interestTopic,createdAt\n';
    const rows = subscribers
      .map(
        (s) =>
          `${s.id},"${(s.name || '').replace(/"/g, '""')}","${(s.email || '').replace(/"/g, '""')}","${(s.role || '').replace(/"/g, '""')}","${(s.interestTopic || '').replace(/"/g, '""')}","${s.createdAt}"`
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

  const handleMarkAllContactsRead = async () => {
    const unread = contacts.filter((m) => m.status === 'unread');
    for (const m of unread) {
      await api.updateContactStatus(m.id, 'read');
    }
    await loadAll();
    await onRefreshStats();
  };

  const unreadContactCount = contacts.filter(
    (m) => m.status === 'unread'
  ).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* 1. Contact Messages */}
        <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-600" />
              ข้อความติดต่อ ({contacts.length})
            </h3>
            {unreadContactCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllContactsRead}
                className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
              >
                <MailCheck className="w-3 h-3" />
                ทำเครื่องหมายว่าอ่านแล้ว ({unreadContactCount})
              </button>
            )}
          </div>

          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {contacts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                ยังไม่มีข้อความติดต่อ
              </p>
            ) : (
              contacts.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-md border p-3.5 text-xs space-y-2 ${
                    m.status === 'unread'
                      ? 'bg-amber-50/40 border-amber-200'
                      : 'bg-slate-50/50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{m.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateContactStatus(
                          m.id,
                          m.status === 'unread' ? 'read' : 'unread'
                        );
                        await loadAll();
                        await onRefreshStats();
                      }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${
                        m.status === 'unread'
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {m.status === 'unread' ? 'ยังไม่อ่าน' : 'อ่านแล้ว'}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {m.email} {m.phone && `• ${m.phone}`}
                  </div>
                  <div className="font-semibold text-slate-800">{m.subject}</div>
                  <p className="text-slate-600">{m.message}</p>
                  <div className="pt-1.5 border-t border-slate-200/70 flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteContact(m.id);
                        await loadAll();
                        await onRefreshStats();
                      }}
                      className="text-[11px] text-rose-600 hover:underline cursor-pointer"
                    >
                      ลบข้อความ
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. Newsletter Subscribers */}
        <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-600" />
              สมาชิกรับข่าวสาร ({subscribers.length})
            </h3>
            {subscribers.length > 0 && (
              <button
                type="button"
                onClick={handleExportSubscribersCsv}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Download className="w-3 h-3" /> ส่งออก CSV
              </button>
            )}
          </div>

          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {subscribers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                ยังไม่มีสมาชิกลงทะเบียน
              </p>
            ) : (
              subscribers.map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border border-slate-200 bg-slate-50/50 p-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 truncate">
                      {s.name}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {s.email} • {s.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingSubscriber({ ...s })}
                      className="p-1 text-slate-400 hover:text-slate-800 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDeleteKey === `sub-${s.id}` ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteSubscriber(s.id);
                          setConfirmDeleteKey(null);
                          await loadAll();
                          await onRefreshStats();
                        }}
                        className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                      >
                        ยืนยันลบ
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteKey(`sub-${s.id}`)}
                        className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 3. Reader Comments */}
        <div className="rounded-lg bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-slate-600" />
              ความคิดเห็นท้ายบทความ ({comments.length})
            </h3>
          </div>

          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
            {comments.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                ยังไม่มีความคิดเห็นท้ายบทความ
              </p>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-md border border-slate-200 bg-slate-50/50 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">
                      {c.authorName}{' '}
                      <span className="font-normal text-slate-500">
                        ({c.authorRole})
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingComment({ ...c })}
                        className="p-1 text-slate-400 hover:text-slate-800 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteKey === `cmt-${c.id}` ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.deleteComment(c.id);
                            setConfirmDeleteKey(null);
                            await loadAll();
                            await onRefreshStats();
                          }}
                          className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                        >
                          ยืนยันลบ
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteKey(`cmt-${c.id}`)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-slate-700">{c.message}</p>
                  <div className="text-[10px] text-slate-400">
                    โพสต์ #{c.postId} • {formatThaiDate(c.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit Comment Modal */}
      {editingComment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              แก้ไขความคิดเห็น
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await api.updateComment(editingComment.id, editingComment);
                setEditingComment(null);
                await loadAll();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อผู้แสดงความคิดเห็น
                </label>
                <input
                  type="text"
                  required
                  value={editingComment.authorName}
                  onChange={(e) =>
                    setEditingComment({
                      ...editingComment,
                      authorName: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ข้อความความคิดเห็น
                </label>
                <textarea
                  rows={3}
                  required
                  value={editingComment.message}
                  onChange={(e) =>
                    setEditingComment({
                      ...editingComment,
                      message: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 p-2.5 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingComment(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Subscriber Modal */}
      {editingSubscriber && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              แก้ไขข้อมูลสมาชิก
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await api.updateSubscriber(
                  editingSubscriber.id,
                  editingSubscriber
                );
                setEditingSubscriber(null);
                await loadAll();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อ-นามสกุล
                </label>
                <input
                  type="text"
                  required
                  value={editingSubscriber.name}
                  onChange={(e) =>
                    setEditingSubscriber({
                      ...editingSubscriber,
                      name: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  อีเมล
                </label>
                <input
                  type="email"
                  required
                  value={editingSubscriber.email}
                  onChange={(e) =>
                    setEditingSubscriber({
                      ...editingSubscriber,
                      email: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  บทบาท / อาชีพ
                </label>
                <input
                  type="text"
                  value={editingSubscriber.role}
                  onChange={(e) =>
                    setEditingSubscriber({
                      ...editingSubscriber,
                      role: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSubscriber(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
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
