import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Save,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Upload,
  FolderKanban,
  LayoutTemplate,
  Server,
  X,
} from 'lucide-react';
import { DomainStatusItem, SiteConfig, SpecialProject } from '../types';
import { api } from '../api';

interface Props {
  siteConfig: SiteConfig | null;
  specialProjects: SpecialProject[];
  onRefreshAll: () => Promise<void>;
}

const EMPTY_PROJECT_FORM = {
  badgeLabel: 'โครงการพิเศษ',
  title: '',
  subtitle: '',
  description: '',
  highlightsText: '',
  tagsText: '',
  ctaLabel: 'ดูรายละเอียด',
  ctaUrl: '',
  status: 'active' as 'active' | 'draft' | 'archived',
  sortOrder: 1,
};

export const SiteAndDomainManager: React.FC<Props> = ({
  siteConfig,
  specialProjects,
  onRefreshAll,
}) => {
  const [section, setSection] = useState<'site' | 'projects' | 'domains'>('site');
  const [form, setForm] = useState<SiteConfig | null>(siteConfig);
  const [domainsInput, setDomainsInput] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [uploadingField, setUploadingField] = useState<'hero' | 'author' | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Special Projects CRUD state
  const [editingProjId, setEditingProjId] = useState<number | null>(null);
  const [projModalOpen, setProjModalOpen] = useState(false);
  const [projForm, setProjForm] = useState(EMPTY_PROJECT_FORM);
  const [projSaving, setProjSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Live Domain DNS Check state
  const [domainChecking, setDomainChecking] = useState(false);
  const [domainResults, setDomainResults] = useState<DomainStatusItem[]>([]);
  const [recommendedTargets, setRecommendedTargets] = useState<{
    vpsIp: string;
    vercelIp: string;
    vercelCname: string;
  } | null>(null);
  const [lastDomainCheckAt, setLastDomainCheckAt] = useState<string>('');

  const showNotice = useCallback((type: 'ok' | 'err', text: string) => {
    setNotice({ type, text });
    setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  useEffect(() => {
    if (siteConfig) {
      setForm(siteConfig);
      setDomainsInput((siteConfig.domains || []).join('\n'));
    }
  }, [siteConfig]);

  const handleSaveSiteConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form) return;
    setSavingConfig(true);
    try {
      const parsedDomains = domainsInput
        .split(/[\n,]+/)
        .map((d) =>
          d
            .trim()
            .replace(/^https?:\/\//i, '')
            .replace(/\/.*$/, '')
            .toLowerCase()
        )
        .filter(Boolean);

      await api.updateSiteConfig({
        ...form,
        domains: parsedDomains.length > 0 ? Array.from(new Set(parsedDomains)) : [form.primaryDomain],
      });
      await onRefreshAll();
      showNotice('ok', 'บันทึกการตั้งค่าเว็บไซต์และโดเมนลงฐานข้อมูลเรียบร้อยแล้ว (อัปเดตหน้าเว็บทันที)');
    } catch (err) {
      showNotice('err', (err as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUploadImage = async (
    field: 'heroImageUrl' | 'authorImageUrl',
    file?: File
  ) => {
    if (!file || !form) return;
    setUploadingField(field === 'heroImageUrl' ? 'hero' : 'author');
    try {
      const url = await api.uploadFile(file);
      setForm({ ...form, [field]: url });
      showNotice('ok', 'อัปโหลดรูปภาพเรียบร้อยแล้ว กดบันทึกการตั้งค่าเพื่อใช้งานบนหน้าเว็บ');
    } catch (err) {
      showNotice('err', (err as Error).message);
    } finally {
      setUploadingField(null);
    }
  };

  const openNewProject = () => {
    setEditingProjId(null);
    setProjForm({
      ...EMPTY_PROJECT_FORM,
      sortOrder: specialProjects.length + 1,
    });
    setNotice(null);
    setProjModalOpen(true);
  };

  const openEditProject = (p: SpecialProject) => {
    setEditingProjId(p.id);
    setProjForm({
      badgeLabel: p.badgeLabel || 'โครงการพิเศษ',
      title: p.title,
      subtitle: p.subtitle || '',
      description: p.description || '',
      highlightsText: (p.highlights || []).join('\n'),
      tagsText: (p.tags || []).join(', '),
      ctaLabel: p.ctaLabel || 'ดูรายละเอียด',
      ctaUrl: p.ctaUrl || '',
      status: p.status || 'active',
      sortOrder: p.sortOrder || 1,
    });
    setNotice(null);
    setProjModalOpen(true);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projForm.title.trim()) return;
    setProjSaving(true);
    try {
      const payload = {
        badgeLabel: projForm.badgeLabel.trim() || 'โครงการพิเศษ',
        title: projForm.title.trim(),
        subtitle: projForm.subtitle.trim(),
        description: projForm.description.trim(),
        highlights: projForm.highlightsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        tags: projForm.tagsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ctaLabel: projForm.ctaLabel.trim() || 'ดูรายละเอียด',
        ctaUrl: projForm.ctaUrl.trim(),
        status: projForm.status,
        sortOrder: Number(projForm.sortOrder) || 1,
      };
      if (editingProjId) {
        await api.updateSpecialProject(editingProjId, payload);
        showNotice('ok', 'อัปเดตข้อมูลโครงการเรียบร้อยแล้ว');
      } else {
        await api.createSpecialProject(payload);
        showNotice('ok', 'เพิ่มโครงการใหม่ลงฐานข้อมูลเรียบร้อยแล้ว');
      }
      setProjModalOpen(false);
      await onRefreshAll();
    } catch (err) {
      showNotice('err', (err as Error).message);
    } finally {
      setProjSaving(false);
    }
  };

  const handleDeleteProject = async (id: number) => {
    try {
      await api.deleteSpecialProject(id);
      setConfirmDeleteId(null);
      await onRefreshAll();
      showNotice('ok', 'ลบโครงการออกจากฐานข้อมูลเรียบร้อยแล้ว');
    } catch (err) {
      showNotice('err', (err as Error).message);
    }
  };

  const handleRunDomainCheck = async () => {
    setDomainChecking(true);
    try {
      const res = await api.checkDomainsStatus();
      setDomainResults(res.results || []);
      setRecommendedTargets(res.recommendedTargets || null);
      setLastDomainCheckAt(res.checkedAt || new Date().toISOString());
    } catch (err) {
      showNotice('err', (err as Error).message);
    } finally {
      setDomainChecking(false);
    }
  };

  useEffect(() => {
    if (section === 'domains' && domainResults.length === 0) {
      handleRunDomainCheck();
    }
  }, [section]);

  if (!form) {
    return (
      <div className="rounded-lg bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
        กำลังโหลดข้อมูลการตั้งค่าเว็บไซต์จากฐานข้อมูล...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center gap-2 ${
            notice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-1.5">
        <button
          type="button"
          onClick={() => setSection('site')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
            section === 'site'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <LayoutTemplate className="w-4 h-4" />
          เนื้อหาหน้าแรก & โปรไฟล์ (DB CMS)
        </button>
        <button
          type="button"
          onClick={() => setSection('projects')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
            section === 'projects'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FolderKanban className="w-4 h-4" />
          โครงการพิเศษ ({specialProjects.length})
        </button>
        <button
          type="button"
          onClick={() => setSection('domains')}
          className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
            section === 'domains'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Globe className="w-4 h-4" />
          จัดการโดเมน & ตรวจสอบ DNS จริง
        </button>
      </div>

      {/* SECTION 1: SITE CMS (REAL-TIME DB EDITING) */}
      {section === 'site' && (
        <form onSubmit={handleSaveSiteConfig} className="space-y-5">
          <div className="rounded-lg bg-white border border-slate-200 p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  จัดการข้อความหน้าแรก แบนเนอร์ และข้อมูลผู้ก่อตั้ง (Real-Time Database)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ทุกข้อความบนหน้าแรกและหน้าเกี่ยวกับผมดึงจากฐานข้อมูล SQLite จริง แก้ไขแล้วมีผลทันทีโดยไม่ต้องแก้โค้ด
                </p>
              </div>
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {savingConfig ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อแบรนด์หลัก
                </label>
                <input
                  type="text"
                  value={form.brandTitle}
                  onChange={(e) => setForm({ ...form, brandTitle: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อรอง (Sub-brand)
                </label>
                <input
                  type="text"
                  value={form.brandSub}
                  onChange={(e) => setForm({ ...form, brandSub: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  สโลแกนหลัก (Hero Slogan)
                </label>
                <input
                  type="text"
                  value={form.slogan}
                  onChange={(e) => setForm({ ...form, slogan: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  คำอธิบายใต้สโลแกนหน้าแรก
                </label>
                <input
                  type="text"
                  value={form.heroSubtitle}
                  onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  คำคมประจำแบนเนอร์หน้าแรก (Hero Quote)
                </label>
                <input
                  type="text"
                  value={form.heroQuote}
                  onChange={(e) => setForm({ ...form, heroQuote: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รูปภาพ Hero หน้าแรก (URL หรืออัปโหลด)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.heroImageUrl}
                    onChange={(e) => setForm({ ...form, heroImageUrl: e.target.value })}
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-800"
                  />
                  <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingField === 'hero' ? 'กำลังอัปโหลด...' : 'อัปโหลด'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadImage('heroImageUrl', e.target.files?.[0])
                      }
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รูปโปรไฟล์ผู้ก่อตั้ง (URL หรืออัปโหลด)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.authorImageUrl}
                    onChange={(e) =>
                      setForm({ ...form, authorImageUrl: e.target.value })
                    }
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-800"
                  />
                  <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingField === 'author' ? 'กำลังอัปโหลด...' : 'อัปโหลด'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadImage('authorImageUrl', e.target.files?.[0])
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  คำแนะนำตัวการ์ดด้านขวา (Author Bio)
                </label>
                <textarea
                  rows={2}
                  value={form.authorBio}
                  onChange={(e) => setForm({ ...form, authorBio: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ข้อความ Quote ในการ์ดผู้ก่อตั้ง
                </label>
                <textarea
                  rows={2}
                  value={form.authorQuote}
                  onChange={(e) => setForm({ ...form, authorQuote: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  วิสัยทัศน์ (หน้าเกี่ยวกับผม)
                </label>
                <input
                  type="text"
                  value={form.aboutVision}
                  onChange={(e) => setForm({ ...form, aboutVision: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ลิงก์วิดีโอ YouTube เด่นหน้าหมวดวิดีโอ
                </label>
                <input
                  type="url"
                  value={form.featuredVideoUrl}
                  onChange={(e) =>
                    setForm({ ...form, featuredVideoUrl: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เรื่องราวองค์กร (หน้าเกี่ยวกับผม)
              </label>
              <textarea
                rows={3}
                value={form.aboutStory}
                onChange={(e) => setForm({ ...form, aboutStory: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div className="pt-3 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                ช่องทางโซเชียลมีเดียและข้อมูลติดต่อ (แสดงบน Header / Sidebar / Footer)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {[
                  { key: 'contactEmail', label: 'อีเมลติดต่อทางการ' },
                  { key: 'contactLocation', label: 'ที่ตั้ง / จังหวัด' },
                  { key: 'socialYoutube', label: 'YouTube URL' },
                  { key: 'socialFacebook', label: 'Facebook URL' },
                  { key: 'socialInstagram', label: 'Instagram URL' },
                  { key: 'socialX', label: 'X (Twitter) URL' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {f.label}
                    </label>
                    <input
                      type="text"
                      value={(form as any)[f.key] || ''}
                      onChange={(e) =>
                        setForm({ ...form, [f.key]: e.target.value })
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* SECTION 2: SPECIAL PROJECTS REAL-TIME CRUD */}
      {section === 'projects' && (
        <div className="rounded-lg bg-white border border-slate-200 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                จัดการโครงการพิเศษและกิจกรรมองค์กร (Real-Time CRUD)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                เพิ่ม แก้ไข หรือลบโครงการพิเศษที่แสดงบนหน้าแรกของเว็บไซต์ได้ทันที
              </p>
            </div>
            <button
              type="button"
              onClick={openNewProject}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              เพิ่มโครงการใหม่
            </button>
          </div>

          {specialProjects.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
              ยังไม่มีโครงการพิเศษในฐานข้อมูล กดปุ่ม "เพิ่มโครงการใหม่" ด้านบนได้เลยครับ
            </div>
          ) : (
            <div className="space-y-3">
              {specialProjects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-700">
                        {p.badgeLabel}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                          p.status === 'active'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.status === 'active' ? 'แสดงผลหน้าเว็บ' : 'ซ่อนไว้'}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-900">{p.title}</div>
                    {p.subtitle && (
                      <div className="text-xs text-slate-500">{p.subtitle}</div>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(p.tags || []).map((t, idx) => (
                        <span
                          key={idx}
                          className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditProject(p)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" /> แก้ไข
                    </button>
                    {confirmDeleteId === p.id ? (
                      <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1">
                        <span className="text-[11px] font-semibold text-rose-800">
                          ยืนยันลบ?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteProject(p.id)}
                          className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white cursor-pointer"
                        >
                          ลบ
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[11px] text-slate-500 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: PRODUCTION DOMAINS & LIVE DNS CHECK */}
      {section === 'domains' && (
        <div className="space-y-5">
          <div className="rounded-lg bg-white border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ตั้งค่าโดเมนหลักและการเชื่อมต่อ Production Domains
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ใช้สำหรับสร้าง Canonical URL, Sitemap (`/sitemap.xml`), Robots (`/robots.txt`) และตรวจสอบสถานะ DNS จริงแบบเรียลไทม์
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={domainChecking}
                  onClick={handleRunDomainCheck}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${domainChecking ? 'animate-spin' : ''}`}
                  />
                  {domainChecking ? 'กำลังตรวจสอบ DNS...' : 'ตรวจสอบ DNS จริง'}
                </button>
                <button
                  type="button"
                  disabled={savingConfig}
                  onClick={() => handleSaveSiteConfig()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  บันทึกโดเมน
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  โดเมนหลัก (Primary Domain)
                </label>
                <input
                  type="text"
                  value={form.primaryDomain}
                  onChange={(e) =>
                    setForm({ ...form, primaryDomain: e.target.value.trim() })
                  }
                  placeholder="komkid.in.th"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <a
                    href="/sitemap.xml"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 underline"
                  >
                    เปิดดู /sitemap.xml <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="/robots.txt"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 underline"
                  >
                    เปิดดู /robots.txt <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รายการโดเมนทั้งหมดที่ผูกกับระบบ (บรรทัดละ 1 โดเมน)
                </label>
                <textarea
                  rows={4}
                  value={domainsInput}
                  onChange={(e) => setDomainsInput(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800"
                />
              </div>
            </div>

            {/* Recommended DNS Targets Reference */}
            {recommendedTargets && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-4 text-xs space-y-1.5">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-slate-600" />
                  ค่า DNS Record สำหรับชี้โดเมนเข้าสู่ Production Server
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-slate-600">
                  <div className="rounded bg-white border border-slate-200 p-2.5">
                    <div className="font-semibold text-slate-800">
                      ตัวเลือกที่ 1: Contabo VPS + Coolify (Traefik SSL)
                    </div>
                    <div className="font-mono text-[11px] mt-1">
                      A Record (`@`, `www`, `api`) → <strong>{recommendedTargets.vpsIp}</strong>
                    </div>
                  </div>
                  <div className="rounded bg-white border border-slate-200 p-2.5">
                    <div className="font-semibold text-slate-800">
                      ตัวเลือกที่ 2: Vercel Production Edge
                    </div>
                    <div className="font-mono text-[11px] mt-1">
                      A (`@`) → <strong>{recommendedTargets.vercelIp}</strong> • CNAME (`www`) → <strong>{recommendedTargets.vercelCname}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Live DNS Lookup Results Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  ผลตรวจสอบ DNS & HTTPS จริง (Live Lookup — ไม่มีการจำลองข้อมูล)
                </span>
                {lastDomainCheckAt && (
                  <span className="text-[11px] text-slate-400">
                    ตรวจล่าสุด: {new Date(lastDomainCheckAt).toLocaleTimeString('th-TH')}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2.5 px-3">โดเมน</th>
                      <th className="py-2.5 px-3">DNS Record (A / CNAME)</th>
                      <th className="py-2.5 px-3">สถานะ DNS</th>
                      <th className="py-2.5 px-3">สถานะ HTTPS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {domainResults.map((d) => (
                      <tr key={d.domain} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          <a
                            href={`https://${d.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            {d.domain}
                            {d.isPrimary && (
                              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">
                                หลัก
                              </span>
                            )}
                          </a>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                          {d.resolvedIps.length > 0
                            ? d.resolvedIps.join(', ')
                            : d.cnames.length > 0
                            ? d.cnames.join(', ')
                            : 'ยังไม่พบการชี้ DNS'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              d.dnsConnected
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-900 border border-amber-200'
                            }`}
                          >
                            {!d.dnsConnected
                              ? 'รอตั้งค่า DNS'
                              : d.target === 'vps'
                              ? 'ชี้มา VPS นี้แล้ว'
                              : d.target === 'vercel'
                              ? 'ชี้มา Vercel แล้ว'
                              : 'ชี้ DNS แล้ว (ปลายทางอื่น)'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              d.httpsReachable
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {d.httpsReachable
                              ? `ออนไลน์ (HTTP ${d.httpStatus})`
                              : 'ยังไม่พร้อมใช้งาน'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {domainResults.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">
                          กดปุ่ม "ตรวจสอบ DNS จริง" ด้านบนเพื่อตรวจสอบสถานะโดเมนทั้งหมด
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Special Project */}
      {projModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto"
          onClick={() => setProjModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-lg bg-white border border-slate-200 p-5 sm:p-6 shadow-xl space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProjId ? 'แก้ไขโครงการพิเศษ' : 'เพิ่มโครงการพิเศษใหม่'}
              </h3>
              <button
                type="button"
                onClick={() => setProjModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProject} className="space-y-3.5">
              {notice?.type === 'err' && (
                <div
                  role="alert"
                  className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
                >
                  {notice.text}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ป้ายกำกับ (Badge)
                  </label>
                  <input
                    type="text"
                    value={projForm.badgeLabel}
                    onChange={(e) =>
                      setProjForm({ ...projForm, badgeLabel: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    สถานะการแสดงผล
                  </label>
                  <select
                    value={projForm.status}
                    onChange={(e) =>
                      setProjForm({
                        ...projForm,
                        status: e.target.value as 'active' | 'draft' | 'archived',
                      })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                  >
                    <option value="active">แสดงผลบนหน้าเว็บไซต์</option>
                    <option value="draft">ฉบับร่าง (ซ่อนไว้ก่อน)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อโครงการ *
                </label>
                <input
                  type="text"
                  required
                  value={projForm.title}
                  onChange={(e) =>
                    setProjForm({ ...projForm, title: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ชื่อรองภาษาอังกฤษ / คำโปรยสั้น
                </label>
                <input
                  type="text"
                  value={projForm.subtitle}
                  onChange={(e) =>
                    setProjForm({ ...projForm, subtitle: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  รายละเอียดโครงการ
                </label>
                <textarea
                  rows={3}
                  value={projForm.description}
                  onChange={(e) =>
                    setProjForm({ ...projForm, description: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  จุดเด่นของโครงการ (บรรทัดละ 1 ข้อ)
                </label>
                <textarea
                  rows={3}
                  value={projForm.highlightsText}
                  onChange={(e) =>
                    setProjForm({ ...projForm, highlightsText: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    แท็กจุดเด่น (คั่นด้วยลูกน้ำ ,)
                  </label>
                  <input
                    type="text"
                    value={projForm.tagsText}
                    onChange={(e) =>
                      setProjForm({ ...projForm, tagsText: e.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ลิงก์ภายนอก (ถ้ามี — ว่างไว้เพื่อเปิดหน้าต่างรายละเอียด)
                  </label>
                  <input
                    type="text"
                    value={projForm.ctaUrl}
                    onChange={(e) =>
                      setProjForm({ ...projForm, ctaUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setProjModalOpen(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={projSaving}
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-60"
                >
                  {projSaving ? 'กำลังบันทึก...' : 'บันทึกโครงการ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
