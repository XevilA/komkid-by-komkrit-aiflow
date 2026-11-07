import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { PostCrudManager } from './PostCrudManager';
import { AiCommandCenter } from './AiCommandCenter';
import {
  KnowledgeBaseManager,
  FivePillarManager,
  AudienceAndSettingsHub,
} from './KnowledgeAndPillars';
import { OmnichannelPublishHub } from './OmnichannelPublishHub';
import { AiChatStudio, MediaAgentHandoff } from './AiChatStudio';
import { MediaGenStudio } from './MediaGenStudio';

interface Props {
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  stats: DashboardStats | null;
  posts: Post[];
  workflows: AiWorkflow[];
  knowledgeItems: KnowledgeItem[];
  pillars: BusinessPillarItem[];
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
  const [settingsTab, setSettingsTab] = useState<SettingsSubTab>('inbox');
  const [aiStatus, setAiStatus] = useState<AiEngineSettings | null>(null);
  const [blueprintOpen, setBlueprintOpen] = useState(false);

  const [mediaHandoff, setMediaHandoff] = useState<MediaAgentHandoff | null>(null);
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
      label: 'จัดการเนื้อหาและบทความ',
      shortLabel: 'เนื้อหา',
      sub: 'ข่าวสาร บทความ วิดีโอ และหลักสูตร',
      icon: <FileText className="w-4 h-4" />,
      badge: stats?.postsTotal ?? posts.length,
    },
    {
      id: 'ai-chat',
      label: 'ระบบผู้ช่วย AI (Co-Work)',
      shortLabel: 'AI Chat',
      sub: 'สนทนา ร่างบทความ และสั่งผลิตสื่อ',
      icon: <Bot className="w-4 h-4" />,
    },
    {
      id: 'ai-command',
      label: 'เวิร์กโฟลว์การผลิต (Agent 01–08)',
      shortLabel: 'เวิร์กโฟลว์',
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
      label: 'ตั้งค่าระบบและฐานข้อมูล',
      shortLabel: 'ตั้งค่าระบบ',
      sub: 'สมาชิก ช่องทางเผยแพร่ คลังความรู้ และ API',
      icon: <Settings className="w-4 h-4" />,
      badge: stats?.unreadContacts || undefined,
    },
  ];

  const settingsTabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
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

  return (
    <div
      className={`${
        isAiChatActive ? 'h-screen overflow-hidden' : 'min-h-screen'
      } flex flex-col lg:flex-row bg-slate-50 text-slate-900 antialiased`}
    >
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-2xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* =================================================================== */}
      {/* ENTERPRISE SIDEBAR NAVIGATION                                       */}
      {/* =================================================================== */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${desktopMenuCollapsed ? 'lg:hidden' : 'lg:static lg:translate-x-0 lg:shrink-0'}`}
      >
        <div className="flex-1 overflow-y-auto">
          {/* Organization Header */}
          <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/images/avatar-komkrit.png"
                alt="Komkrit"
                className="h-8 w-8 rounded-md border border-slate-700 object-cover shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold truncate">
                  ADMINISTRATION
                </div>
                <div className="font-bold text-xs text-white truncate">
                  คมคิด by KOMKRIT
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => toggleDesktopMenu(true)}
                title="พับเก็บแถบเมนู"
                className="hidden lg:inline-flex items-center justify-center p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Primary Navigation */}
          <div className="p-3">
            <div className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              ระบบจัดการหลัก
            </div>
            <nav className="space-y-1">
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
                    className={`group relative w-full flex items-center justify-between rounded-md px-3 py-2.5 text-left transition cursor-pointer ${
                      active
                        ? 'bg-slate-800 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-amber-400" />
                    )}
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-md shrink-0 transition ${
                          active
                            ? 'bg-slate-700 text-amber-400'
                            : 'bg-slate-800/80 text-slate-400 group-hover:text-slate-200'
                        }`}
                      >
                        {m.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold leading-tight truncate">
                          {m.label}
                        </span>
                        <span className="block text-[11px] text-slate-400 mt-0.5 truncate">
                          {m.sub}
                        </span>
                      </span>
                    </span>
                    {typeof m.badge === 'number' && m.badge > 0 && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${
                          active
                            ? 'bg-amber-400/20 text-amber-300'
                            : 'bg-slate-800 text-slate-400'
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

          {/* Quick Settings Shortcuts */}
          <div className="px-3 pt-2 pb-4 border-t border-slate-800/80">
            <div className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              ทางลัดการจัดการ
            </div>
            <div className="space-y-0.5">
              {settingsTabs.map((st) => {
                const isCurrent =
                  normalizedMenu === 'settings' && settingsTab === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      openSettingsSection(st.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs transition cursor-pointer ${
                      isCurrent
                        ? 'bg-slate-800/90 text-amber-300 font-semibold'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                    }`}
                  >
                    <span className="opacity-80 shrink-0">{st.icon}</span>
                    <span className="truncate">{st.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setBlueprintOpen(true);
                  setSidebarOpen(false);
                }}
                className="w-full flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800/40 hover:text-slate-200 transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4 opacity-80 shrink-0" />
                <span className="truncate">เอกสารสถาปัตยกรรมระบบ</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/95 space-y-1.5">
          <div className="px-2 py-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="truncate">ผู้ดูแล: {adminUsername || 'admin'}</span>
            <span
              className={`inline-flex items-center gap-1 font-medium ${
                connectedProvidersCount > 0 ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connectedProvidersCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              AI {connectedProvidersCount}/4
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onOpenPublicWebsite}
              className="flex items-center justify-center gap-1.5 rounded-md bg-slate-800 border border-slate-700 px-2.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              หน้าเว็บหลัก
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center justify-center gap-1.5 rounded-md bg-slate-800/60 border border-slate-800 px-2.5 py-2 text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 hover:border-rose-900/50 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>

      {/* =================================================================== */}
      {/* MAIN WORKSPACE CONTAINER                                            */}
      {/* =================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 pb-14 lg:pb-0">
        {/* Formal Top Header Bar */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center justify-center p-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
              aria-label="เปิดเมนูหลัก"
            >
              <Menu className="w-4 h-4" />
            </button>
            {desktopMenuCollapsed && (
              <button
                type="button"
                onClick={() => toggleDesktopMenu(false)}
                title="แสดงแถบเมนูด้านซ้าย"
                className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="w-3.5 h-3.5 text-slate-500" />
                เมนูหลัก
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                ระบบบริหารจัดการ
              </span>
              <span className="hidden md:inline text-slate-300">/</span>
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {activeMenuItem.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAiChatActive && (
              <button
                type="button"
                onClick={() => toggleChatFullScreen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">ขยายเต็มจอ</span>
              </button>
            )}

            {aiStatus && (
              <button
                type="button"
                onClick={() => openSettingsSection('api_keys')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border transition cursor-pointer ${
                  connectedProvidersCount > 0
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800 hover:bg-emerald-100/60'
                    : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100/70'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {connectedProvidersCount > 0
                    ? `เชื่อมต่อ AI แล้ว (${connectedProvidersCount} ค่าย)`
                    : 'ตั้งค่า API Key'}
                </span>
                <span className="sm:hidden">API ({connectedProvidersCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenPublicWebsite}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">ดูหน้าเว็บไซต์</span>
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main
          className={
            isAiChatActive
              ? 'flex-1 flex flex-col min-h-0 w-full overflow-hidden'
              : 'flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto space-y-6'
          }
        >
          {/* Formal API Configuration Notice */}
          {aiStatus &&
            connectedProvidersCount === 0 &&
            (normalizedMenu === 'media-gen' || normalizedMenu === 'ai-command') && (
              <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs sm:text-sm font-semibold text-slate-900">
                      ยังไม่ได้กำหนดค่า API Key สำหรับประมวลผล AI
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      กรุณาเชื่อมต่อคีย์ผู้ให้บริการ (เช่น Google Gemini, OpenAI, Anthropic หรือ DeepSeek) ในหน้าการเชื่อมต่อ API เพื่อเปิดใช้งานระบบอัตโนมัติ
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openSettingsSection('api_keys')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Key
                </button>
              </div>
            )}

          {/* 1. CONTENT MANAGEMENT + EXECUTIVE KPI SUMMARY */}
          {normalizedMenu === 'posts' && (
            <>
              {/* Formal Executive Summary Bar */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="rounded-lg bg-white border border-slate-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>เนื้อหาทั้งหมดในระบบ</span>
                    <FileText className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {stats?.postsTotal ?? posts.length}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      เผยแพร่ {publishedPostsCount} • ร่าง {draftPostsCount}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg bg-white border border-slate-200 p-4 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>จำนวนการเข้าชมสะสม</span>
                    <Eye className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {formatViews(stats?.totalViews ?? 0)}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      ครั้ง
                    </span>
                  </div>
                </div>

                <div
                  onClick={() => openSettingsSection('knowledge')}
                  className="rounded-lg bg-white border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>ฐานความรู้ & เวิร์กโฟลว์</span>
                    <Database className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-xl sm:text-2xl font-bold text-slate-900">
                      {activeKbCount}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      แคมเปญ AI {workflows.length} รายการ
                    </span>
                  </div>
                </div>

                <div
                  onClick={() => openSettingsSection('inbox')}
                  className="rounded-lg bg-white border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition cursor-pointer"
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
                      className={`text-[11px] font-medium ${
                        (stats?.unreadContacts ?? 0) > 0
                          ? 'text-amber-700 font-semibold'
                          : 'text-slate-500'
                      }`}
                    >
                      ข้อความใหม่ {stats?.unreadContacts ?? 0} รายการ
                    </span>
                  </div>
                </div>
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

          {/* 2. AI CO-WORK & CHAT WORKSPACE */}
          {normalizedMenu === 'ai-chat' && (
            <div
              className={
                chatFullScreen
                  ? 'fixed inset-0 z-50 bg-white flex flex-col'
                  : 'flex-1 flex flex-col min-h-0 h-full'
              }
            >
              <AiChatStudio
                onRefreshAll={onRefreshAll}
                onOpenSettings={() => {
                  toggleChatFullScreen(false);
                  openSettingsSection('api_keys');
                }}
                onPreviewPost={(postId) => {
                  toggleChatFullScreen(false);
                  onPreviewPost(postId);
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
                initialAiSettings={aiStatus}
                onSyncAiSettings={(st) => setAiStatus(st)}
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
              />
            </div>
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
                    className="rounded-lg bg-white border border-slate-200 p-5 space-y-4 shadow-2xs"
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
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition cursor-pointer ${
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={() => setBlueprintOpen(false)}
        >
          <div
            className="my-auto w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-5 sm:p-6 shadow-xl space-y-5 border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
