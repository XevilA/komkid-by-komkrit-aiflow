import React, { useCallback, useEffect, useState } from 'react';
import {
  Zap,
  FileText,
  Database,
  Share2,
  Settings,
  LogOut,
  Globe,
  Menu,
  X,
  MessageSquare,
  Layers,
  Lock,
  CheckCircle2,
  KeyRound,
  Image as ImageIcon,
  Bot,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Workflow,
  Eye,
  Users,
  Plus,
  Building2,
  BookOpen,
} from 'lucide-react';
import {
  AiEngineSettings,
  Post,
  AiWorkflow,
  KnowledgeItem,
  BusinessPillarItem,
  DashboardStats,
} from '../types';
import { api, formatViews } from '../api';
import { AiCommandCenter } from './AiCommandCenter';
import {
  KnowledgeBaseManager,
  FivePillarManager,
  AudienceAndSettingsHub,
} from './KnowledgeAndPillars';
import { OmnichannelPublishHub } from './OmnichannelPublishHub';
import { AgentWorkspace } from './AgentWorkspace';
import { ContentManager } from './ContentManager';
import { MediaGenStudio, MediaAgentHandoff } from './MediaGenStudio';
import { SiteAndDomainManager } from './SiteAndDomainManager';
import { AiRoutingPanel } from './AiRoutingPanel';
import { ChannelConnect } from './ChannelConnect';
import { SiteConfig, SpecialProject } from '../types';

interface Props {
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  stats: DashboardStats | null;
  posts: Post[];
  workflows: AiWorkflow[];
  knowledgeItems: KnowledgeItem[];
  pillars: BusinessPillarItem[];
  siteConfig: SiteConfig | null;
  specialProjects: SpecialProject[];
  initialEditPost: Post | null;
  openCreateImmediately?: boolean;
  onClearInitialEdit: () => void;
  onRefreshAll: () => Promise<void>;
  onPreviewPost: (id: number) => void;
  onOpenPublicWebsite: () => void;
  adminUsername: string;
  onLogout: () => void;
}

type SettingsSubTab =
  | 'site_domain'
  | 'ai_routing'
  | 'inbox'
  | 'channels'
  | 'knowledge'
  | 'pillars'
  | 'api_keys';

export const AdminLayout: React.FC<Props> = ({
  activeMenu,
  setActiveMenu,
  stats,
  posts,
  workflows,
  knowledgeItems,
  pillars,
  siteConfig,
  specialProjects,
  initialEditPost,
  openCreateImmediately,
  onClearInitialEdit,
  onRefreshAll,
  onPreviewPost,
  onOpenPublicWebsite,
  adminUsername,
  onLogout,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopMenuCollapsed, setDesktopMenuCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('komkrit_admin_menu_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [chatFullScreen, setChatFullScreen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('komkrit_chat_fullscreen') === '1';
    } catch {
      return false;
    }
  });
  const [settingsTab, setSettingsTab] = useState<SettingsSubTab>(() =>
    new URLSearchParams(window.location.search).get('connect') ? 'channels' : 'inbox'
  );
  const [aiStatus, setAiStatus] = useState<AiEngineSettings | null>(null);
  const [blueprintOpen, setBlueprintOpen] = useState(false);

  const [mediaHandoff, setMediaHandoff] = useState<MediaAgentHandoff | null>(null);
  const [workspaceRequest, setWorkspaceRequest] = useState<{ kind: 'post' | 'workflow'; id: number } | null>(null);
  const [prefillNewPost, setPrefillNewPost] = useState<Partial<Post> | null>(null);

  const toggleDesktopMenu = useCallback((next?: boolean) => {
    setDesktopMenuCollapsed((prev) => {
      const val = typeof next === 'boolean' ? next : !prev;
      try {
        localStorage.setItem('komkrit_admin_menu_collapsed', val ? '1' : '0');
      } catch {
        // ignore
      }
      return val;
    });
  }, []);

  const toggleChatFullScreen = useCallback((next?: boolean) => {
    setChatFullScreen((prev) => {
      const val = typeof next === 'boolean' ? next : !prev;
      try {
        localStorage.setItem('komkrit_chat_fullscreen', val ? '1' : '0');
      } catch {
        // ignore
      }
      return val;
    });
  }, []);

  const refreshAiStatus = useCallback(async () => {
    try {
      const s = await api.getAiSettings();
      setAiStatus(s);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshAiStatus();
  }, [refreshAiStatus]);

  const connectedProvidersCount = aiStatus
    ? [
        aiStatus.hasGeminiKey,
        aiStatus.hasClaudeKey,
        aiStatus.hasDeepseekKey,
        aiStatus.hasOpenaiKey,
      ].filter(Boolean).length
    : 0;

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
      setPwdMsg({ type: 'ok', text: 'บันทึกการเปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
    } catch (err) {
      setPwdMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setPwdSaving(false);
    }
  };

  const menuItems = [
    {
      id: 'posts',
      label: 'เนื้อหาและบทความ',
      shortLabel: 'เนื้อหา',
      sub: 'ข่าวสาร บทความ วิดีโอ และหลักสูตร',
      icon: <FileText className="w-4 h-4" />,
      badge: stats?.postsTotal ?? posts.length,
    },
    {
      id: 'ai-chat',
      label: 'CEO Agent: สั่งงานทีม AI',
      shortLabel: 'CEO Agent',
      sub: 'สนทนา ร่างบทความ และสั่งผลิตสื่อ',
      icon: <Bot className="w-4 h-4" />,
    },
    {
      id: 'ai-command',
      label: 'แคมเปญ AI 8 Agent',
      shortLabel: 'แคมเปญ AI',
      sub: 'กระบวนการวิจัย เขียน และตรวจสอบคุณภาพ',
      icon: <Workflow className="w-4 h-4" />,
      badge: workflows.length || undefined,
    },
    {
      id: 'media-gen',
      label: 'สตูดิโอสื่อภาพและวิดีโอ',
      shortLabel: 'สตูดิโอสื่อ',
      sub: 'สร้างภาพประกอบ วิดีโอ และสตอรีบอร์ด',
      icon: <ImageIcon className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: 'ตั้งค่าระบบ',
      shortLabel: 'ตั้งค่า',
      sub: 'สมาชิก ช่องทางเผยแพร่ คลังความรู้ และ API',
      icon: <Settings className="w-4 h-4" />,
      badge: stats?.unreadContacts || undefined,
    },
  ];

  const settingsTabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'site_domain',
      label: 'เว็บไซต์ โครงการ และโดเมน',
      icon: <Globe className="w-4 h-4" />,
    },
    {
      id: 'ai_routing',
      label: 'AI สลับอัตโนมัติ',
      icon: <Zap className="w-4 h-4" />,
    },
    {
      id: 'inbox',
      label: 'ข้อมูลติดต่อและสมาชิก',
      icon: <MessageSquare className="w-4 h-4" />,
    },
    {
      id: 'channels',
      label: 'ช่องทางเผยแพร่ (Omnichannel)',
      icon: <Share2 className="w-4 h-4" />,
    },
    {
      id: 'knowledge',
      label: 'คลังความรู้ (Knowledge Base)',
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: 'pillars',
      label: 'โครงสร้างหน่วยธุรกิจ',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'api_keys',
      label: 'การเชื่อมต่อ API และรหัสผ่าน',
      icon: <KeyRound className="w-4 h-4" />,
    },
  ];

  const publishedPostsCount = posts.filter((p) => p.status === 'published').length;
  const draftPostsCount = posts.filter((p) => p.status === 'draft').length;
  const activeKbCount = knowledgeItems.filter((k) => k.isActive).length;

  const isAiChatActive = activeMenu === 'ai-chat';
  const normalizedMenu = activeMenu === 'dashboard' ? 'posts' : activeMenu;
  const activeMenuItem =
    menuItems.find((m) => m.id === normalizedMenu) || menuItems[0];

  const navLink = (active: boolean) =>
    `flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
      active ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased lg:flex-row">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col justify-between border-r border-slate-200 bg-white transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          desktopMenuCollapsed
            ? 'lg:hidden'
            : 'lg:sticky lg:top-0 lg:bottom-auto lg:h-screen lg:shrink-0 lg:self-start lg:translate-x-0'
        }`}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="flex h-14 items-center justify-between gap-2 border-b border-slate-200 px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <img src="/images/avatar-komkrit.png" alt="" className="h-7 w-7 shrink-0 rounded-full" />
              <div className="min-w-0 text-sm font-semibold tracking-tight text-slate-900">
                คมคิด <span className="font-normal text-slate-500">ผู้ดูแลระบบ</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => toggleDesktopMenu(true)}
                title="พับเก็บเมนู"
                className="hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer lg:inline-flex"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="ปิดเมนู"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer lg:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="space-y-0.5 p-3" aria-label="เมนูหลัก">
            {menuItems.map((m) => {
              const active = normalizedMenu === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setActiveMenu(m.id);
                    setSidebarOpen(false);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={navLink(active)}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="text-slate-500">{m.icon}</span>
                    {m.shortLabel}
                  </span>
                  {typeof m.badge === 'number' && m.badge > 0 && (
                    <span className="text-xs tabular-nums text-slate-400">{m.badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-3">
            <div className="px-3 pb-1.5 text-xs font-medium text-slate-400">การตั้งค่า</div>
            <div className="space-y-0.5">
              {settingsTabs.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    openSettingsSection(st.id);
                    setSidebarOpen(false);
                  }}
                  className={navLink(normalizedMenu === 'settings' && settingsTab === st.id)}
                >
                  <span className="truncate">{st.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setBlueprintOpen(true);
                  setSidebarOpen(false);
                }}
                className={navLink(false)}
              >
                เอกสารสถาปัตยกรรมระบบ
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-200 p-3">
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span className="truncate">ผู้ดูแล: {adminUsername || 'admin'}</span>
            <span className={connectedProvidersCount > 0 ? 'text-emerald-700' : 'text-slate-700'}>
              AI {connectedProvidersCount}/4 ค่าย
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenPublicWebsite}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              หน้าเว็บหลัก
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-14 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="เปิดเมนู"
              className="shrink-0 rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 cursor-pointer lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            {desktopMenuCollapsed && (
              <button
                type="button"
                onClick={() => toggleDesktopMenu(false)}
                className="hidden shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer lg:inline-flex"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" /> เมนู
              </button>
            )}
            <h1 className="truncate text-sm font-semibold text-slate-900 sm:text-base">{activeMenuItem.label}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {aiStatus && (
              <button
                type="button"
                onClick={() => openSettingsSection('api_keys')}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {connectedProvidersCount > 0 ? `เชื่อมต่อ AI ${connectedProvidersCount} ค่าย` : 'ตั้งค่า API Key'}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenPublicWebsite}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              ดูหน้าเว็บไซต์
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-4 sm:p-6">
          {aiStatus &&
            connectedProvidersCount === 0 &&
            (normalizedMenu === 'media-gen' || normalizedMenu === 'ai-command') && (
              <div className="flex flex-col justify-between gap-3 rounded-md border border-slate-300 bg-slate-100 p-4 sm:flex-row sm:items-center">
                <div>
                  <div className="text-sm font-medium text-slate-900">ยังไม่ได้กำหนดค่า API Key สำหรับ AI</div>
                  <p className="mt-0.5 text-sm text-slate-600">
                    เชื่อมต่อคีย์ของ Google Gemini, OpenAI, Anthropic หรือ DeepSeek อย่างน้อยหนึ่งค่าย เพื่อเปิดใช้งานทีม AI
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openSettingsSection('api_keys')}
                  className="shrink-0 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 cursor-pointer"
                >
                  ตั้งค่า API Key
                </button>
              </div>
            )}

          {/* 1. CONTENT MANAGEMENT + EXECUTIVE KPI SUMMARY */}
          {normalizedMenu === 'posts' && (
            <>
              {/* Formal Executive Summary Bar */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="rounded-lg bg-white border border-slate-200 p-3.5 sm:p-4 ">
                  <div className="flex items-center justify-between gap-1 text-xs font-medium text-slate-500">
                    <span className="truncate">เนื้อหาทั้งหมดในระบบ</span>
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                  <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {stats?.postsTotal ?? posts.length}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      เผยแพร่ {publishedPostsCount} • ร่าง {draftPostsCount}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg bg-white border border-slate-200 p-3.5 sm:p-4 ">
                  <div className="flex items-center justify-between gap-1 text-xs font-medium text-slate-500">
                    <span className="truncate">จำนวนการเข้าชมสะสม</span>
                    <Eye className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                  <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-0.5 sm:gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {formatViews(stats?.totalViews ?? 0)}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      ครั้ง
                    </span>
                  </div>
                </div>

                <div
                  onClick={() => openSettingsSection('knowledge')}
                  className="rounded-lg bg-white border border-slate-200 p-4 hover:border-slate-300 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>ฐานความรู้ & เวิร์กโฟลว์</span>
                    <Database className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {activeKbCount}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      แคมเปญ AI {workflows.length} รายการ
                    </span>
                  </div>
                </div>

                <div
                  onClick={() => openSettingsSection('inbox')}
                  className="rounded-lg bg-white border border-slate-200 p-4 hover:border-slate-300 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>สมาชิกและข้อความติดต่อ</span>
                    <Users className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {(stats?.totalSubscribers ?? 0) + (stats?.unreadContacts ?? 0)}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        (stats?.unreadContacts ?? 0) > 0
                          ? 'text-slate-700 font-semibold'
                          : 'text-slate-500'
                      }`}
                    >
                      ข้อความใหม่ {stats?.unreadContacts ?? 0} รายการ
                    </span>
                  </div>
                </div>
              </div>

              <ContentManager
                posts={posts}
                initialEditPost={initialEditPost}
                prefillNewPost={prefillNewPost}
                openCreateImmediately={openCreateImmediately}
                onClearInitialEdit={() => {
                  setPrefillNewPost(null);
                  onClearInitialEdit();
                }}
                onRefresh={onRefreshAll}
                onPreviewPost={onPreviewPost}
                onOpenSettings={() => openSettingsSection('api_keys')}
                onEditWithCeo={(postId) => {
                  setWorkspaceRequest({ kind: 'post', id: postId });
                  setActiveMenu('ai-chat');
                }}
                onWriteWithCeo={() => setActiveMenu('ai-chat')}
              />
            </>
          )}

          {/* 2. AI CO-WORK & CHAT WORKSPACE */}
          {normalizedMenu === 'ai-chat' && (
            <AgentWorkspace
              request={workspaceRequest}
              onRequestHandled={() => setWorkspaceRequest(null)}
              onRefreshAll={onRefreshAll}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onPreviewPost={onPreviewPost}
            />
          )}

          {/* 3. AI MEDIA & VIDEO PRODUCTION STUDIO */}
          {normalizedMenu === 'media-gen' && (
            <MediaGenStudio
              incomingHandoff={mediaHandoff}
              onClearHandoff={() => setMediaHandoff(null)}
              onRefreshAll={onRefreshAll}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onPreviewPost={onPreviewPost}
              onOpenInPostEditor={(draft) => {
                setPrefillNewPost(draft);
                setActiveMenu('posts');
              }}
              onGoToChat={() => setActiveMenu('ai-chat')}
            />
          )}

          {/* 4. MULTI-AGENT WORKFLOW CONSOLE (01-08) */}
          {normalizedMenu === 'ai-command' && (
            <AiCommandCenter
              onOpenInCeo={(id) => {
                setWorkspaceRequest({ kind: 'workflow', id });
                setActiveMenu('ai-chat');
              }}
              workflows={workflows}
              kbCount={activeKbCount}
              onRefreshAll={onRefreshAll}
              onOpenPublishedPost={onPreviewPost}
              onGoToKnowledgeBase={() => openSettingsSection('knowledge')}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onOpenFlowStudio={() => setActiveMenu('media-gen')}
            />
          )}

          {/* 5. SYSTEM SETTINGS, OMNICHANNEL, KNOWLEDGE BASE & CRM */}
          {normalizedMenu === 'settings' && (
            <div className="space-y-5">
              {/* Formal Sub-Navigation Bar */}
              <div className="border-b border-slate-200 bg-white rounded-t-lg px-2 pt-2">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                  {settingsTabs.map((t) => {
                    const active = settingsTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSettingsTab(t.id)}
                        className={`inline-flex items-center gap-2 shrink-0 border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                          active
                            ? 'border-slate-900 text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {settingsTab === 'site_domain' && (
                <SiteAndDomainManager
                  siteConfig={siteConfig}
                  specialProjects={specialProjects}
                  onRefreshAll={onRefreshAll}
                />
              )}

              {settingsTab === 'ai_routing' && <AiRoutingPanel />}

              {settingsTab === 'inbox' && (
                <AudienceAndSettingsHub
                  mode="feedback"
                  onRefreshStats={onRefreshAll}
                />
              )}

              {settingsTab === 'api_keys' && (
                <div className="space-y-5">
                  <form
                    onSubmit={handleChangePassword}
                    className="rounded-lg bg-white border border-slate-200 p-5 space-y-4 "
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
                          <Lock className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">
                            การจัดการบัญชีผู้ดูแลระบบ
                          </h3>
                          <p className="text-xs text-slate-500">
                            แก้ไขชื่อผู้ใช้งานและรหัสผ่านสำหรับเข้าสู่ระบบหลังบ้าน
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          ชื่อผู้ใช้งาน (Username)
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          รหัสผ่านปัจจุบัน
                        </label>
                        <input
                          type="password"
                          required
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="ระบุรหัสผ่านเดิม"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="ระบุรหัสผ่านใหม่"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-sm focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div>
                        {pwdMsg && (
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                              pwdMsg.type === 'ok'
                                ? 'text-emerald-700'
                                : 'text-rose-600'
                            }`}
                          >
                            {pwdMsg.type === 'ok' && (
                              <CheckCircle2 className="w-4 h-4" />
                            )}
                            {pwdMsg.text}
                          </span>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={pwdSaving}
                        className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        {pwdSaving ? 'กำลังบันทึก...' : 'อัปเดตรหัสผ่าน'}
                      </button>
                    </div>
                  </form>

                  <AudienceAndSettingsHub
                    mode="settings"
                    onRefreshStats={async () => {
                      await refreshAiStatus();
                      await onRefreshAll();
                    }}
                  />
                </div>
              )}

              {settingsTab === 'channels' && (
                <div className="space-y-8">
                <ChannelConnect />
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
                      businessPillar: '1. Content Creation | ผลิตสื่อ & ยอดวิว',
                      flowMode: 'full_8agent',
                    });
                    await onRefreshAll();
                    setActiveMenu('ai-command');
                  }}
                />
                </div>
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
            </div>
          )}
        </main>

        {/* Mobile Bottom Navigation Bar (Responsive < lg) */}
        <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5 h-14 lg:hidden">
          {menuItems.map((m) => {
            const active = normalizedMenu === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveMenu(m.id)}
                className={`flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'text-slate-900 font-bold bg-slate-50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className={active ? 'text-slate-900' : 'text-slate-400'}>
                  {m.icon}
                </span>
                <span className="truncate max-w-[64px]">{m.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* SYSTEM ARCHITECTURE REFERENCE MODAL */}
      {blueprintOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 overflow-y-auto"
          onClick={() => setBlueprintOpen(false)}
        >
          <div
            className="my-auto w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-5 sm:p-6 space-y-5 border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  SYSTEM ARCHITECTURE
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  แผนผังสถาปัตยกรรม AI Content Creation Flow (01–08) & โครงสร้างธุรกิจ
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBlueprintOpen(false)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  1. AI Content Creation Flow — ระบบปฏิบัติการ Agent 01–08
                </div>
                <img
                  src="/images/blueprint-8agent-flow.jpg"
                  alt="AI Content Creation Flow"
                  className="w-full rounded-md border border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  2. KOM KID AI Co-work — 4 หน่วยธุรกิจหลักและระบบสนับสนุน
                </div>
                <img
                  src="/images/blueprint-komkid-cowork.jpg"
                  alt="KOM KID AI Co-work"
                  className="w-full rounded-md border border-slate-200"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
