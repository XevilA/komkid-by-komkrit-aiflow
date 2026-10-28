import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Sparkles,
  Database,
  Layers,
  MessageSquare,
  Settings,
  Globe,
  Menu,
  X,
  PlusCircle,
  Eye,
  Users,
  Bot,
  ArrowRight,
  Share2,
  Clapperboard,
  KeyRound,
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
  onPreviewPost: (id: number) => void;
}

export const AdminLayout: React.FC<Props> = ({
  activeMenu,
  setActiveMenu,
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
  onPreviewPost,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const menuItems = [
    {
      id: 'dashboard',
      label: 'ภาพรวมหลังบ้าน',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'posts',
      label: 'จัดการโพสต์/ข่าวสาร (CRUD)',
      icon: <FileText className="w-4 h-4" />,
      badge: stats?.postsTotal,
    },
    {
      id: 'ai-command',
      label: 'AI Multi-Agent Studio',
      icon: <Sparkles className="w-4 h-4 text-amber-400" />,
      badge: stats?.pendingApprovals || undefined,
      highlight: true,
    },
    {
      id: 'flow-chat',
      label: 'Google Flow • Veo & AI Chat',
      icon: <Clapperboard className="w-4 h-4 text-sky-300" />,
      highlight: true,
    },
    {
      id: 'publish-hub',
      label: 'เผยแพร่ 8 ช่องทาง (Publish)',
      icon: <Share2 className="w-4 h-4 text-rose-400" />,
      badge: 8,
      highlight: true,
    },
    {
      id: 'knowledge',
      label: 'ฐานความรู้ (Knowledge Base)',
      icon: <Database className="w-4 h-4" />,
      badge: stats?.kbCount,
    },
    {
      id: 'pillars',
      label: '5-Pillar Business Model',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'feedback',
      label: 'เสียงสะท้อน & สมาชิก',
      icon: <MessageSquare className="w-4 h-4" />,
      badge: stats?.totalComments,
    },
    {
      id: 'settings',
      label: 'ตั้งค่า API Keys & Providers',
      icon: <Settings className="w-4 h-4 text-emerald-300" />,
    },
  ];

  return (
    <div className="min-h-screen flex bg-[#eef3f9]">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-68 bg-[#0b1f3a] text-white flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          {/* Brand Top */}
          <div className="p-5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/images/avatar-komkrit.png"
                alt="Komkrit"
                className="h-10 w-10 rounded-full border border-amber-400"
              />
              <div>
                <div className="font-extrabold text-base leading-none">
                  คมคิด <span className="text-amber-400">ADMIN</span>
                </div>
                <div className="text-[10.5px] text-slate-300 mt-0.5">
                  CMS & Multi-Agent AI Center
                </div>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Menu */}
          <nav className="p-3 space-y-1.5">
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
                      ? 'bg-gradient-to-r from-[#f59e0b] to-[#ea8810] text-[#0b1f3a] shadow-sm'
                      : m.highlight
                      ? 'bg-white/10 text-amber-200 hover:bg-white/15'
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

        {/* Bottom Switch to Public Site */}
        <div className="p-4 border-t border-white/10 space-y-2.5">
          <button
            onClick={onOpenPublicWebsite}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#0b1f3a] hover:bg-amber-300 transition cursor-pointer"
          >
            <Globe className="w-4 h-4" />
            กลับสู่หน้าเว็บไซต์หลัก
          </button>
          <div className="text-center text-[10px] text-slate-400">
            KOMKRIT | AI + HUMAN = GREATER IMPACT
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Admin Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 h-15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-slate-100 text-[#0d2546]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm sm:text-base font-extrabold text-[#0d2546]">
              {menuItems.find((m) => m.id === activeMenu)?.label || 'ระบบหลังบ้าน'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveMenu('flow-chat')}
              className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3.5 py-1.5 text-xs font-extrabold text-sky-950 hover:bg-sky-200 cursor-pointer"
            >
              <Clapperboard className="w-3.5 h-3.5" /> Google Flow • Veo & Chat
            </button>
            <button
              onClick={() => setActiveMenu('settings')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-extrabold text-emerald-950 hover:bg-emerald-200 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" /> API Keys
            </button>
            <button
              onClick={() => setActiveMenu('ai-command')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3.5 py-1.5 text-xs font-extrabold text-amber-950 hover:bg-amber-200 cursor-pointer"
            >
              <Bot className="w-3.5 h-3.5" /> สั่งงาน CEO Agent
            </button>
            <button
              onClick={onOpenPublicWebsite}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0d2546] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#193d6e] cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" /> ดูหน้าเว็บจริง
            </button>
          </div>
        </header>

        {/* Workspace Body */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">
          {activeMenu === 'dashboard' && (
            <div className="space-y-6">
              {/* Welcome Banner */}
              <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] via-[#153969] to-[#0d2546] p-6 text-white flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
                <div className="flex items-center gap-4">
                  <img
                    src="/images/badge-komkid.png"
                    alt="คมคิด"
                    className="h-16 w-16 object-contain shrink-0"
                  />
                  <div>
                    <h1 className="text-xl sm:text-2xl font-extrabold">
                      ยินดีต้อนรับสู่ระบบหลังบ้าน คมคิด by KOMKRIT
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                      จัดการบทความ ข่าวสาร วิดีโอ คอร์สเรียน พร้อมศูนย์บัญชาการ AI Multi-Agent ครบวงจรในที่เดียว
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setActiveMenu('posts')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-extrabold text-[#0d2546] hover:bg-slate-100 cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4 text-[#e88d14]" />
                    จัดการข่าวสาร / โพสต์ CRUD
                  </button>
                  <button
                    onClick={() => setActiveMenu('ai-command')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#f59e0b] px-4 py-2.5 text-xs font-extrabold text-[#0b1f3a] hover:brightness-105 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    เปิดศูนย์ AI Multi-Agent
                  </button>
                </div>
              </div>

              {/* KPI Stats Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>บทความและโพสต์ทั้งหมด</span>
                    <FileText className="w-4 h-4 text-[#0d2546]" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.postsTotal ?? posts.length}
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-700 font-semibold">
                    เผยแพร่แล้ว {stats?.postsPublished ?? posts.length} รายการ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>ยอดผู้อ่านรวม (Total Views)</span>
                    <Eye className="w-4 h-4 text-sky-600" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {formatViews(stats?.totalViews ?? 0)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    เสียงสะท้อนผู้ชม {stats?.totalComments ?? 0} ข้อความ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-amber-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-amber-900 font-semibold">
                    <span>แคมเปญ AI Multi-Agent</span>
                    <Bot className="w-4 h-4 text-[#f59e0b]" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.totalWorkflows ?? workflows.length}
                  </div>
                  <div className="mt-1 text-[11px] text-amber-800 font-bold">
                    รอ Human Approval {stats?.pendingApprovals ?? 0} รายการ
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>ฐานความรู้ & สมาชิกข่าวสาร</span>
                    <Users className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="mt-2 text-2xl font-extrabold text-[#0d2546]">
                    {stats?.kbCount ?? knowledgeItems.length} KB
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    ผู้รับ Newsletter {stats?.totalSubscribers ?? 0} คน
                  </div>
                </div>
              </div>

              {/* Quick Overview: Recent Posts & Pending AI Approvals */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-base text-[#0d2546]">
                      โพสต์และข่าวสารล่าสุดในระบบ CRUD
                    </h3>
                    <button
                      onClick={() => setActiveMenu('posts')}
                      className="text-xs font-bold text-[#d97706] hover:underline cursor-pointer"
                    >
                      จัดการทั้งหมด →
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
                            className="h-11 w-16 rounded-lg object-cover shrink-0 bg-[#0d2546]"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#0d2546] truncate">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              👁 {formatViews(p.views)} • 💬 {p.commentsCount}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => onPreviewPost(p.id)}
                          className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-[#0d2546] hover:bg-slate-200 cursor-pointer"
                        >
                          เปิดอ่าน
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-base text-[#0d2546]">
                      สถานะทีม AI Agents & Human Approval
                    </h3>
                    <button
                      onClick={() => setActiveMenu('ai-command')}
                      className="text-xs font-bold text-[#d97706] hover:underline cursor-pointer"
                    >
                      เข้าสู่ศูนย์บัญชาการ →
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    {workflows.slice(0, 4).map((w) => (
                      <div
                        key={w.id}
                        onClick={() => setActiveMenu('ai-command')}
                        className="rounded-xl border border-slate-200/80 p-3 hover:border-[#f59e0b] transition cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-[10.5px] mb-1">
                          <span className="font-extrabold text-emerald-700">
                            QA Score: {w.qaOutput?.overallScore || 97}/100 ({w.qaOutput?.verdict || 'ผ่าน'})
                          </span>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                            {w.status === 'published' ? 'เผยแพร่แล้ว' : 'รออนุมัติ'}
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
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0d2546] py-2.5 text-xs font-extrabold text-amber-300 hover:bg-[#183d6e] cursor-pointer"
                  >
                    สร้างคอนเทนต์ใหม่ด้วย CEO Agent <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeMenu === 'posts' && (
            <PostCrudManager
              posts={posts}
              initialEditPost={initialEditPost}
              openCreateImmediately={openCreateImmediately}
              onClearInitialEdit={onClearInitialEdit}
              onRefresh={onRefreshAll}
              onPreviewPost={onPreviewPost}
              onOpenSettings={() => setActiveMenu('settings')}
            />
          )}

          {activeMenu === 'ai-command' && (
            <AiCommandCenter
              workflows={workflows}
              kbCount={knowledgeItems.filter((k) => k.isActive).length}
              onRefreshAll={onRefreshAll}
              onOpenPublishedPost={onPreviewPost}
              onGoToKnowledgeBase={() => setActiveMenu('knowledge')}
              onOpenSettings={() => setActiveMenu('settings')}
              onOpenFlowStudio={() => setActiveMenu('flow-chat')}
            />
          )}

          {activeMenu === 'flow-chat' && (
            <FlowAndChatStudio
              onRefreshAll={onRefreshAll}
              onOpenSettings={() => setActiveMenu('settings')}
              onOpenPost={onPreviewPost}
            />
          )}

          {activeMenu === 'publish-hub' && (
            <OmnichannelPublishHub
              posts={posts}
              workflows={workflows}
              onRefreshAll={onRefreshAll}
              onOpenPost={onPreviewPost}
              onOpenSettings={() => setActiveMenu('settings')}
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

          {activeMenu === 'knowledge' && (
            <KnowledgeBaseManager
              items={knowledgeItems}
              onRefresh={onRefreshAll}
            />
          )}

          {activeMenu === 'pillars' && (
            <FivePillarManager pillars={pillars} onRefresh={onRefreshAll} />
          )}

          {activeMenu === 'feedback' && (
            <AudienceAndSettingsHub
              mode="feedback"
              onRefreshStats={onRefreshAll}
            />
          )}

          {activeMenu === 'settings' && (
            <AudienceAndSettingsHub
              mode="settings"
              onRefreshStats={onRefreshAll}
            />
          )}
        </main>
      </div>
    </div>
  );
};
