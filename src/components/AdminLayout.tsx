import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Sparkles,
  Settings,
  Globe,
  Menu,
  X,
  Eye,
  Users,
  Clapperboard,
  LogOut,
  KeyRound,
  Share2,
  Database,
  Layers,
  MessageSquare,
  Lock,
  CheckCircle2,
  Bot,
  Image as ImageIcon,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
} from 'lucide-react';
import {
  Post,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
  AiEngineSettings,
} from '../types';
import { api, DashboardStats, formatViews } from '../api';
import { PostCrudManager } from './PostCrudManager';
import { AiCommandCenter } from './AiCommandCenter';
import { AiChatStudio, MediaAgentHandoff } from './AiChatStudio';
import { MediaGenStudio } from './MediaGenStudio';
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
  | 'inbox'
  | 'api_keys'
  | 'channels'
  | 'knowledge'
  | 'pillars';

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
  const [settingsTab, setSettingsTab] = useState<SettingsSubTab>('inbox');
  const [mediaHandoff, setMediaHandoff] = useState<MediaAgentHandoff | null>(null);
  const [prefillNewPost, setPrefillNewPost] = useState<Partial<Post> | null>(null);
  const [aiStatus, setAiStatus] = useState<AiEngineSettings | null>(null);

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
      setPwdMsg({ type: 'ok', text: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้วครับ' });
    } catch (err) {
      setPwdMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setPwdSaving(false);
    }
  };

  // 5 LARGE, PLAIN-THAI MENUS (Elder-friendly, dedicated AI Chat + Image/VDO Gen!)
  const menuItems = [
    {
      id: 'posts',
      label: 'จัดการข่าวและบทความ',
      sub: 'ลงข่าวใหม่ • แก้ไข • ลบข่าว',
      icon: <FileText className="w-5 h-5" />,
      badge: stats?.postsTotal ?? posts.length,
    },
    {
      id: 'ai-chat',
      label: 'แชทคุยกับ AI (สั่งงาน)',
      sub: 'คุยปกติ • เขียนข่าว • คิด Prompt',
      icon: <Bot className="w-5 h-5" />,
    },
    {
      id: 'media-gen',
      label: 'สร้างรูปภาพ & วิดีโอ AI',
      sub: 'สร้างภาพ • คลิป VDO • ดูตัวอย่าง',
      icon: <ImageIcon className="w-5 h-5" />,
    },
    {
      id: 'ai-command',
      label: 'ให้ทีม AI เขียนบทความชุดใหญ่',
      sub: 'วิเคราะห์ลึก • แชร์หลายช่องทาง',
      icon: <Sparkles className="w-5 h-5" />,
    },
    {
      id: 'settings',
      label: 'ข้อความติดต่อ & ตั้งค่า',
      sub: 'ดูคนติดต่อ • คีย์ AI • รหัสผ่าน',
      icon: <Settings className="w-5 h-5" />,
      badge: stats?.unreadContacts || undefined,
    },
  ];

  const settingsTabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'inbox',
      label: 'ข้อความจากผู้ชม & สมาชิก',
      icon: <MessageSquare className="w-4 h-4" />,
    },
    {
      id: 'api_keys',
      label: 'รหัสผ่าน & เชื่อมต่อคีย์ AI',
      icon: <KeyRound className="w-4 h-4" />,
    },
    {
      id: 'channels',
      label: 'ตั้งค่าแชร์โซเชียล',
      icon: <Share2 className="w-4 h-4" />,
    },
    {
      id: 'knowledge',
      label: 'คลังข้อมูลสอน AI',
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: 'pillars',
      label: 'แผนเป้าหมาย 5 ด้าน',
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  const isAiChatActive = activeMenu === 'ai-chat';

  return (
    <div
      className={`${
        isAiChatActive ? 'h-screen overflow-hidden' : 'min-h-screen'
      } flex bg-[#f4f7fb]`}
    >
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Large, Clear Left Tab Menu (Collapsible on Desktop & Mobile) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#0b1f3a] text-white flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${desktopMenuCollapsed ? 'lg:hidden' : 'lg:static lg:translate-x-0'}`}
      >
        <div>
          <div className="p-5 border-b border-white/10 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/images/avatar-komkrit.png"
                alt="Komkrit"
                className="h-11 w-11 rounded-full border-2 border-amber-400 shrink-0"
              />
              <div className="min-w-0">
                <div className="font-extrabold text-base leading-tight truncate">
                  ระบบจัดการเว็บไซต์
                </div>
                <div className="text-xs text-amber-300 font-bold mt-0.5 truncate">
                  คมคิด by KOMKRIT
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => toggleDesktopMenu(true)}
                title="พับปิดเมนูแท็บด้านซ้าย"
                className="hidden lg:inline-flex items-center justify-center p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <PanelLeftClose className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 text-slate-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <nav className="p-3.5 space-y-2">
            {menuItems.map((m) => {
              const active = activeMenu === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveMenu(m.id);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-2xl px-4 py-3.5 text-left transition cursor-pointer ${
                    active
                      ? 'bg-[#f59e0b] text-[#0b1f3a] shadow-sm'
                      : 'text-slate-100 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="shrink-0">{m.icon}</span>
                    <span>
                      <span className="block text-sm sm:text-base font-extrabold leading-snug">
                        {m.label}
                      </span>
                      <span
                        className={`block text-xs mt-0.5 ${
                          active ? 'text-[#0b1f3a]/80 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        {m.sub}
                      </span>
                    </span>
                  </span>
                  {typeof m.badge === 'number' && m.badge > 0 && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
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

        <div className="p-4 border-t border-white/10 space-y-2">
          <button
            onClick={onOpenPublicWebsite}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-[#0b1f3a] hover:bg-amber-300 transition cursor-pointer"
          >
            <Globe className="w-4 h-4" />
            เปิดดูหน้าเว็บจริง
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-rose-300 hover:bg-rose-500/15 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Clean Large-Font Top Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0d2546] text-white text-sm font-bold cursor-pointer shrink-0"
            >
              <Menu className="w-5 h-5" />
              เมนู
            </button>
            {desktopMenuCollapsed && (
              <button
                type="button"
                onClick={() => toggleDesktopMenu(false)}
                title="เปิดแสดงเมนูแท็บด้านซ้าย"
                className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0d2546] text-white text-xs sm:text-sm font-extrabold hover:bg-[#163a6b] transition cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="w-4 h-4 text-amber-300" />
                เปิดเมนูแท็บ
              </button>
            )}
            <h1 className="text-base sm:text-lg font-extrabold text-[#0d2546] truncate">
              {menuItems.find((m) => m.id === activeMenu)?.label || 'จัดการข่าวและบทความ'}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {isAiChatActive && (
              <button
                type="button"
                onClick={() => toggleChatFullScreen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0d2546] px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-extrabold text-amber-300 hover:bg-[#163a6b] transition cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
                <span className="hidden sm:inline">เต็มจอ 100%</span>
              </button>
            )}
            {aiStatus && (
              <button
                type="button"
                onClick={() => openSettingsSection('api_keys')}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                  connectedProvidersCount > 0
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                    : 'bg-amber-400 text-[#0b1f3a] hover:brightness-105 shadow-xs'
                }`}
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                {connectedProvidersCount > 0
                  ? `เชื่อมต่อ AI จริงแล้ว (${connectedProvidersCount} ค่าย)`
                  : 'เชื่อมต่อคีย์ AI จริง'}
              </button>
            )}
            <button
              onClick={onOpenPublicWebsite}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-extrabold text-[#0d2546] hover:bg-slate-50 cursor-pointer"
            >
              <Globe className="w-4 h-4" /> <span className="hidden sm:inline">ดูหน้าเว็บจริง</span>
            </button>
            <button
              onClick={onLogout}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-rose-50 hover:text-rose-700 cursor-pointer"
            >
              <LogOut className="w-4 h-4" /> ออกจากระบบ
            </button>
          </div>
        </header>

        <main
          className={
            isAiChatActive
              ? 'flex-1 flex flex-col min-h-0 w-full overflow-hidden'
              : 'flex-1 p-4 sm:p-6 max-w-[1240px] w-full mx-auto space-y-5'
          }
        >
          {/* Guided 1-Click Callout Banner if AI Keys haven't been saved yet */}
          {aiStatus &&
            connectedProvidersCount === 0 &&
            (activeMenu === 'media-gen' || activeMenu === 'ai-command') && (
              <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm sm:text-base font-extrabold text-[#0d2546]">
                      เริ่มใช้งาน AI จริง: กรุณาใส่ API Key เพียงครั้งเดียวก่อนสั่งงานครับ
                    </div>
                    <p className="text-xs sm:text-sm text-slate-700 mt-0.5">
                      ระบบนี้ปิดโหมดจำลอง (Zero Mockup) 100% — แนะนำใส่คีย์{' '}
                      <strong>Google Gemini (AI Studio)</strong> เพียงตัวเดียว ใช้ได้ทั้งแชท, เขียนข่าว, สร้างภาพ และสร้างคลิปวิดีโอทันทีครับ
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openSettingsSection('api_keys')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0d2546] px-5 py-3 text-sm font-extrabold text-amber-300 hover:bg-[#163a6b] cursor-pointer shrink-0"
                >
                  <KeyRound className="w-4 h-4" /> ไปหน้าใส่คีย์ AI & ทดสอบทันที
                </button>
              </div>
            )}
          {/* 1. NEWS & ARTICLES CRUD (DEFAULT HOME SCREEN!) */}
          {(activeMenu === 'posts' || activeMenu === 'dashboard') && (
            <>
              {/* Clean 3-Box Summary Strip at Top */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-500">ข่าวและบทความทั้งหมด</div>
                    <div className="text-2xl font-extrabold text-[#0d2546] mt-0.5">
                      {stats?.postsTotal ?? posts.length} เรื่อง
                    </div>
                  </div>
                  <FileText className="w-8 h-8 text-[#0d2546]/20" />
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-500">ยอดคนเข้ามาอ่านรวม</div>
                    <div className="text-2xl font-extrabold text-[#0d2546] mt-0.5">
                      {formatViews(stats?.totalViews ?? 0)} ครั้ง
                    </div>
                  </div>
                  <Eye className="w-8 h-8 text-sky-600/25" />
                </div>

                <div
                  onClick={() => openSettingsSection('inbox')}
                  className="rounded-2xl bg-white border border-slate-200 px-5 py-4 flex items-center justify-between cursor-pointer hover:border-amber-400 transition"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-500">ผู้ติดตาม & คนติดต่อ</div>
                    <div className="text-2xl font-extrabold text-[#0d2546] mt-0.5">
                      {(stats?.totalSubscribers ?? 0) + (stats?.unreadContacts ?? 0)} คน
                    </div>
                  </div>
                  <Users className="w-8 h-8 text-emerald-600/25" />
                </div>
              </div>

              {/* Quick 2-Button AI Shortcuts right on Home */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={() => setActiveMenu('ai-chat')}
                  className="flex items-center justify-between rounded-2xl bg-[#0d2546] px-5 py-4 text-left text-white hover:bg-[#163a6b] transition cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400 text-[#0d2546] shrink-0">
                      <Bot className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-base font-extrabold">
                        แชทคุยกับ AI (ปรึกษา & สั่งเขียนข่าว)
                      </div>
                      <div className="text-xs sm:text-sm text-amber-200">
                        คุยว่าจะทำอะไร → ให้ AI เขียนข่าว หรือเขียน Full Prompt ส่งให้ Agent
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveMenu('media-gen')}
                  className="flex items-center justify-between rounded-2xl bg-white border-2 border-amber-400 px-5 py-4 text-left text-[#0d2546] hover:bg-amber-50 transition cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0d2546] text-amber-300 shrink-0">
                      <Clapperboard className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-base font-extrabold">
                        สร้างรูปภาพ & วิดีโอ AI (ดูตัวอย่างก่อนใช้)
                      </div>
                      <div className="text-xs sm:text-sm text-slate-600">
                        สั่ง Agent สร้างรูป/คลิป VDO จริง • ชอบเก็บไว้ หรือไม่ชอบกดลบทิ้งได้ทันที
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              <PostCrudManager
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
              />
            </>
          )}

          {/* 2. DEDICATED NORMAL AI CHAT + PROMPT EVALUATOR + NEWS WRITER */}
          {activeMenu === 'ai-chat' && (
            <AiChatStudio
              initialAiSettings={aiStatus}
              onSyncAiSettings={(nextSt) => setAiStatus(nextSt)}
              onRefreshAll={onRefreshAll}
              onOpenSettings={() => {
                toggleChatFullScreen(false);
                openSettingsSection('api_keys');
              }}
              onPreviewPost={(id) => {
                toggleChatFullScreen(false);
                onPreviewPost(id);
              }}
              onSendToMediaStudio={(handoff) => {
                toggleChatFullScreen(false);
                setMediaHandoff(handoff);
                setActiveMenu('media-gen');
              }}
              onOpenInPostEditor={(draft) => {
                toggleChatFullScreen(false);
                setPrefillNewPost(draft);
                setActiveMenu('posts');
              }}
              isTabMenuCollapsed={desktopMenuCollapsed}
              onToggleTabMenu={() => toggleDesktopMenu()}
              isFullScreen={chatFullScreen}
              onToggleFullScreen={() => toggleChatFullScreen()}
              onNavigateMenu={(menuId) => {
                toggleChatFullScreen(false);
                setActiveMenu(menuId);
              }}
              onOpenPublicWebsite={onOpenPublicWebsite}
            />
          )}

          {/* 3. DEDICATED IMAGE & VIDEO GENERATOR WITH RECHECK PREVIEW */}
          {(activeMenu === 'media-gen' || activeMenu === 'flow-chat') && (
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

          {/* 4. MULTI-AGENT AI ARTICLE WORKFLOW */}
          {activeMenu === 'ai-command' && (
            <AiCommandCenter
              workflows={workflows}
              kbCount={knowledgeItems.filter((k) => k.isActive).length}
              onRefreshAll={onRefreshAll}
              onOpenPublishedPost={onPreviewPost}
              onGoToKnowledgeBase={() => openSettingsSection('knowledge')}
              onOpenSettings={() => openSettingsSection('api_keys')}
              onOpenFlowStudio={() => setActiveMenu('media-gen')}
            />
          )}

          {/* 4. MESSAGES & SETTINGS */}
          {activeMenu === 'settings' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar bg-white rounded-2xl p-2 border border-slate-200">
                {settingsTabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSettingsTab(t.id)}
                    className={`inline-flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-sm font-extrabold transition cursor-pointer ${
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
                    className="rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0d2546] text-amber-400">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-[#0d2546]">
                          เปลี่ยนรหัสผ่านเข้าหน้าผู้ดูแลระบบ
                        </h3>
                        <p className="text-sm text-slate-500">
                          ใช้สำหรับล็อกอินเข้าหน้า <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">/admin</code>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          ชื่อผู้ใช้
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          รหัสผ่านเดิม
                        </label>
                        <input
                          type="password"
                          required
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="กรอกรหัสผ่านปัจจุบัน"
                          className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                          รหัสผ่านใหม่ (6 ตัวขึ้นไป)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="ตั้งรหัสผ่านใหม่"
                          className="w-full rounded-xl border-2 border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#0d2546] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {pwdMsg && (
                          <span
                            className={`inline-flex items-center gap-1.5 text-sm font-bold ${
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
                        className="rounded-xl bg-[#0d2546] px-5 py-2.5 text-sm font-extrabold text-white hover:bg-[#163a6b] cursor-pointer disabled:opacity-50"
                      >
                        {pwdSaving ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
