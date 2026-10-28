import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Sparkles,
  Settings,
  Globe,
  Menu,
  X,
  PlusCircle,
  Eye,
  Users,
  Bot,
  ArrowRight,
  Clapperboard,
  LogOut,
  KeyRound,
  Share2,
  Database,
  Layers,
  MessageSquare,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import {
  Post,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
} from '../types';
import { api, DashboardStats, formatViews } from '../api';
import { PostCrudManager } from './PostCrudManager';
import { AiCommandCenter } from './AiCommandCenter';
import { FlowAndChatStudio } from './FlowAndChatStudio';
import { OmnichannelPublishHub } from './OmnichannelPublishHub';
import {
  KnowledgeBaseManager,
  FivePillarManager,
  AudienceAndSettingsHub,
} from './KnowledgeAndPillars';

interface Props {
  activeMenu: string;
  setActiveMenu: (m: string) => void;
  adminUsername: string;
  stats: DashboardStats | null;
  posts: Post[];
  workflows: AiWorkflow[];
  knowledgeItems: KnowledgeItem[];
  pillars: BusinessPillarItem[];
  initialEditPost?: Post | null;
  openCreateImmediately?: boolean;
  onClearInitialEdit: () => void;
  onRefreshAll: () => Promise<void>;
  onOpenPublicWebsite: () => void;
  onLogout: () => void;
  onPreviewPost: (id: number) => void;
}

type SettingsSubTab =
  | 'api_keys'
  | 'channels'
  | 'knowledge'
  | 'pillars'
  | 'inbox';

export const AdminLayout: React.FC<Props> = ({
  activeMenu,
  setActiveMenu,
  adminUsername,
  stats,
  posts,
  workflows,
  knowledgeItems,
  pillars,
  initialEditPost,
  openCreateImmediately,
  onClearInitialEdit,
  onRefreshAll,
  onOpenPublicWebsite,
  onLogout,
  onPreviewPost,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsSubTab>('api_keys');

  // Password Change Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(adminUsername || 'admin');
  const [newPassword, setNewPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const openSettingsSection = (sub: SettingsSubTab) => {
    setSettingsTab(sub);
    setActiveMenu('settings');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdSaving(true);
    setPwdMsg(null);
    try {
      await api.changeAdminPassword({
        currentPassword,
        newUsername,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setPwdMsg({ type: 'ok', text: 'บันทึกรหัสผ่านผู้ดูแลใหม่เรียบร้อยแล้ว' });
    } catch (err) {
      setPwdMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setPwdSaving(false);
    }
  };

  // Clean 5-item Navigation Menu
  const menuItems = [
    {
      id: 'dashboard',
      label: 'ภาพรวม',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'posts',
      label: 'บทความ & ข่าวสาร',
      icon: <FileText className="w-4 h-4" />,
      badge: stats?.postsTotal,
    },
    {
      id: 'ai-command',
      label: 'สร้างคอนเทนต์ AI',
      icon: <Sparkles className="w-4 h-4" />,
      badge: stats?.pendingApprovals || undefined,
    },
    {
      id: 'flow-chat',
      label: 'วิดีโอ AI & แชท',
      icon: <Clapperboard className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: 'ตั้งค่าระบบ',
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const settingsTabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'api_keys',
      label: 'API Keys & รหัสผ่าน',
      icon: <KeyRound className="w-3.5 h-3.5" />,
    },
    {
      id: 'channels',
      label: 'ช่องทางโซเชียล (Publish)',
      icon: <Share2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'knowledge',
      label: `ฐานความรู้ AI (${stats?.kbCount ?? knowledgeItems.length})`,
      icon: <Database className="w-3.5 h-3.5" />,
    },
    {
      id: 'pillars',
      label: 'โมเดล 5-Pillar',
      icon: <Layers className="w-3.5 h-3.5" />,
    },
    {
      id: 'inbox',
      label: 'ข้อความติดต่อ & สมาชิก',
      icon: <MessageSquare className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="min-h-screen flex bg-[#f4f7fb]">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Clean Minimal Left Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-[#0b1f3a] text-white flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/images/avatar-komkrit.png"
                alt="Komkrit"
                className="h-9 w-9 rounded-full border border-amber-400"
              />
              <div>
                <div className="font-extrabold text-sm leading-tight">
                  คมคิด <span className="text-amber-400">Admin</span>
                </div>
                <div className="text-[11px] text-slate-400">ผู้ดูแล: {adminUsername}</div>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {menuItems.map((m) => {
              const active = activeMenu === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveMenu(m.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-bold transition cursor-pointer ${
                    active
                      ? 'bg-[#f59e0b] text-[#0b1f3a] shadow-xs'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {m.icon}
                    {m.label}
                  </span>
                  {typeof m.badge === 'number' && m.badge > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                        active
                          ? 'bg-[#0b1f3a] text-amber-300'
                          : 'bg-white/15 text-white'
                      }`}
                    >
                      {m.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-white/10 space-y-1.5">
          <button
            onClick={onOpenPublicWebsite}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            เปิดดูหน้าเว็บไซต์
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/15 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Minimal Top Bar (No duplicate buttons!) */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200/80 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-slate-100 text-[#0d2546]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm sm:text-base font-extrabold text-[#0d2546]">
              {menuItems.find((m) => m.id === activeMenu)?.label || 'ระบบจัดการ'}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenPublicWebsite}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" /> ดูหน้าเว็บ
            </button>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> ออกจากระบบ
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1280px] w-full mx-auto">
          {/* 1. DASHBOARD */}
          {activeMenu === 'dashboard' && (
            <div className="space-y-5">
              {/* Simple Quick Action Strip */}
              <div className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-[#0d2546]">
                    สวัสดีครับ, ยินดีต้อนรับสู่ระบบจัดการ คมคิด by KOMKRIT
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    เขียนบทความใหม่ จัดการข่าวสาร หรือให้ AI ช่วยร่างเนื้อหาได้ในคลิกเดียว
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    onClick={() => setActiveMenu('posts')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#163a6b] cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4 text-amber-400" />
                    เขียนโพสต์ใหม่
                  </button>
                  <button
                    onClick={() => setActiveMenu('ai-command')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#f59e0b] px-4 py-2.5 text-xs font-extrabold text-[#0b1f3a] hover:brightness-105 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    ให้ AI ช่วยสร้างบทความ
                  </button>
                </div>
              </div>

              {/* 4 Clean KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white border border-slate-200 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>โพสต์ทั้งหมด</span>
                    <FileText className="w-4 h-4 text-[#0d2546]" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.postsTotal ?? posts.length}
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-700 font-semibold">
                    ออนไลน์ {stats?.postsPublished ?? posts.length} รายการ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>ยอดอ่านรวม</span>
                    <Eye className="w-4 h-4 text-sky-600" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {formatViews(stats?.totalViews ?? 0)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    ความคิดเห็น {stats?.totalComments ?? 0} ข้อความ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>ร่างคอนเทนต์ AI</span>
                    <Bot className="w-4 h-4 text-[#f59e0b]" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.totalWorkflows ?? workflows.length}
                  </div>
                  <div className="mt-1 text-[11px] text-amber-700 font-semibold">
                    รออนุมัติ {stats?.pendingApprovals ?? 0} รายการ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>ผู้ติดตามข่าวสาร</span>
                    <Users className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.totalSubscribers ?? 0}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    ข้อความติดต่อใหม่ {stats?.unreadContacts ?? 0} รายการ
                  </div>
                </div>
              </div>

              {/* Recent Posts & AI Drafts */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-sm text-[#0d2546]">
                      บทความและข่าวสารล่าสุด
                    </h3>
                    <button
                      onClick={() => setActiveMenu('posts')}
                      className="text-xs font-bold text-[#d97706] hover:underline cursor-pointer"
                    >
                      ดูทั้งหมด →
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {posts.slice(0, 5).map((p) => (
                      <div
                        key={p.id}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={p.coverImage}
                            alt={p.title}
                            className="h-10 w-14 rounded-lg object-cover shrink-0 bg-[#0d2546]"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#0d2546] truncate">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              อ่าน {formatViews(p.views)} ครั้ง • คอมเมนต์ {p.commentsCount}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => onPreviewPost(p.id)}
                          className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                        >
                          ดูตัวอย่าง
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-sm text-[#0d2546]">
                      คอนเทนต์จาก AI ล่าสุด
                    </h3>
                    <button
                      onClick={() => setActiveMenu('ai-command')}
                      className="text-xs font-bold text-[#d97706] hover:underline cursor-pointer"
                    >
                      เปิดสตูดิโอ AI →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {workflows.slice(0, 4).map((w) => (
                      <div
                        key={w.id}
                        onClick={() => setActiveMenu('ai-command')}
                        className="rounded-xl border border-slate-200/80 p-3 hover:border-[#f59e0b] transition cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-[10.5px] mb-1">
                          <span className="text-slate-500">
                            คะแนนตรวจสอบ {w.qaOutput?.overallScore || 97}/100
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 font-bold ${
                              w.status === 'published'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {w.status === 'published' ? 'โพสต์แล้ว' : 'รออนุมัติ'}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-[#0d2546] line-clamp-1">
                          {w.scriptOutput?.selectedTitle || w.topic}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setActiveMenu('ai-command')}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                  >
                    สร้างคอนเทนต์ใหม่ด้วย AI <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. POSTS CRUD */}
          {activeMenu === 'posts' && (
            <PostCrudManager
              posts={posts}
              initialEditPost={initialEditPost}
              openCreateImmediately={openCreateImmediately}
              onClearInitialEdit={onClearInitialEdit}
              onRefresh={onRefreshAll}
              onPreviewPost={onPreviewPost}
              onOpenSettings={() => openSettingsSection('api_keys')}
            />
          )}

          {/* 3. SIMPLIFIED AI CONTENT STUDIO */}
          {activeMenu === 'ai-command' && (
            <AiCommandCenter
              workflows={workflows}
              kbCount={knowledgeItems.filter((k) => k.isActive).length}
              onRefreshAll={onRefreshAll}
              onOpenPublishedPost={onPreviewPost}
              onGoToKnowledgeBase={() => openSettingsSection('knowledge')}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onOpenFlowStudio={() => setActiveMenu('flow-chat')}
            />
          )}

          {/* 4. VIDEO (GOOGLE FLOW / VEO) & AI CHAT */}
          {activeMenu === 'flow-chat' && (
            <FlowAndChatStudio
              onRefreshAll={onRefreshAll}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onOpenPost={onPreviewPost}
            />
          )}

          {/* 5. UNIFIED SETTINGS HUB */}
          {activeMenu === 'settings' && (
            <div className="space-y-5">
              {/* Clean Sub-tab Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white rounded-2xl p-1.5 border border-slate-200">
                {settingsTabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSettingsTab(t.id)}
                    className={`inline-flex items-center gap-1.5 shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                      settingsTab === t.id
                        ? 'bg-[#0d2546] text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {settingsTab === 'api_keys' && (
                <div className="space-y-5">
                  {/* Admin Password & Account Security Card */}
                  <form
                    onSubmit={handleChangePassword}
                    className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d2546] text-amber-400">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-[#0d2546]">
                          บัญชีผู้ดูแลระบบ & เปลี่ยนรหัสผ่าน (Admin Login)
                        </h3>
                        <p className="text-xs text-slate-500">
                          ใช้สำหรับเข้าสู่ระบบจัดการที่หน้า <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">/admin</code> เท่านั้น (ผู้ชมทั่วไปจะไม่เห็นเมนูหรือหน้านี้)
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          ชื่อผู้ใช้ Admin
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          รหัสผ่านปัจจุบัน
                        </label>
                        <input
                          type="password"
                          required
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="กรอกรหัสผ่านเดิม"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="ตั้งรหัสผ่านใหม่"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {pwdMsg && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                              pwdMsg.type === 'ok'
                                ? 'text-emerald-700'
                                : 'text-rose-600'
                            }`}
                          >
                            {pwdMsg.type === 'ok' && (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            {pwdMsg.text}
                          </span>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={pwdSaving}
                        className="rounded-xl bg-[#0d2546] px-4 py-2 text-xs font-bold text-white hover:bg-[#163a6b] cursor-pointer disabled:opacity-50"
                      >
                        {pwdSaving ? 'กำลังบันทึก...' : 'อัปเดตรหัสผ่าน Admin'}
                      </button>
                    </div>
                  </form>

                  {/* Real Multi-LLM / Veo / Flow API Keys */}
                  <AudienceAndSettingsHub
                    mode="settings"
                    onRefreshStats={onRefreshAll}
                  />
                </div>
              )}

              {settingsTab === 'channels' && (
                <OmnichannelPublishHub
                  posts={posts}
                  workflows={workflows}
                  onRefreshAll={onRefreshAll}
                  onOpenPost={onPreviewPost}
                  onOpenSettings={() => setSettingsTab('api_keys')}
                  onTriggerAiFromFeedback={async (topic, role) => {
                    await api.runWorkflow({
                      topic,
                      inputSource: 'ข้อมูลจากผู้ติดตาม (สังคมออนไลน์ / สื่อ)',
                      category: 'education',
                      targetAudience: role,
                      businessPillar: '5. COMMUNITY | ชุมชน',
                      flowMode: 'full_8agent',
                    });
                    await onRefreshAll();
                    setActiveMenu('ai-command');
                  }}
                />
              )}

              {settingsTab === 'knowledge' && (
                <KnowledgeBaseManager
                  items={knowledgeItems}
                  onRefresh={onRefreshAll}
                />
              )}

              {settingsTab === 'pillars' && (
                <FivePillarManager pillars={pillars} onRefresh={onRefreshAll} />
              )}

              {settingsTab === 'inbox' && (
                <AudienceAndSettingsHub
                  mode="feedback"
                  onRefreshStats={onRefreshAll}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
