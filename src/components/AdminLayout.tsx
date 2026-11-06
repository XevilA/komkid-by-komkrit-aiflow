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
  Crown,
  GraduationCap,
  ShoppingBag,
  Handshake,
  ArrowUpRight,
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
  const [blueprintOpen, setBlueprintOpen] = useState(false);

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

  // EXECUTIVE NAVIGATION ALIGNED WITH AGENT CEO (01-08) & AI CO-WORK BLUEPRINT
  const menuItems = [
    {
      id: 'ai-chat',
      label: 'AI Co-work & Chat',
      sub: 'สั่งงานผ่าน CEO • เขียน + รูป + VDO',
      icon: <Bot className="w-4 h-4" />,
    },
    {
      id: 'ai-command',
      label: 'Agent CEO Flow (01–08)',
      sub: '8 Agents อัจฉริยะ • ตรวจ & กระจายสื่อ',
      icon: <Crown className="w-4 h-4" />,
      badge: workflows.length || undefined,
    },
    {
      id: 'posts',
      label: 'จัดการคอนเทนต์เว็บไซต์',
      sub: 'บทความ • ข่าว • วิดีโอ • คอร์สเรียน',
      icon: <FileText className="w-4 h-4" />,
      badge: stats?.postsTotal ?? posts.length,
    },
    {
      id: 'media-gen',
      label: 'สตูดิโอภาพ & วิดีโอ AI',
      sub: 'Visual 04 • Video 05 • Google Flow',
      icon: <ImageIcon className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: 'ชุมชน • ช่องทาง • ตั้งค่า',
      sub: 'CRM & Feedback • โซเชียล • API Vault',
      icon: <Settings className="w-4 h-4" />,
      badge: stats?.unreadContacts || undefined,
    },
  ];

  const settingsTabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'inbox',
      label: 'Audience Feedback & CRM',
      icon: <MessageSquare className="w-4 h-4" />,
    },
    {
      id: 'api_keys',
      label: 'API Vault & รหัสผ่าน',
      icon: <KeyRound className="w-4 h-4" />,
    },
    {
      id: 'channels',
      label: 'Publish & Distribute (โซเชียล)',
      icon: <Share2 className="w-4 h-4" />,
    },
    {
      id: 'knowledge',
      label: 'Knowledge Base (01 Research)',
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: 'pillars',
      label: '4 ธุรกิจหลัก & โมเดลรายได้',
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  const revenueEngines = [
    {
      id: 'content',
      title: '1. Content Creation',
      desc: 'บทความ • วิดีโอ • Infographic',
      metric: `${stats?.postsTotal ?? posts.length} ชิ้นงาน`,
      icon: <Clapperboard className="w-4 h-4 text-sky-600" />,
      onClick: () => setActiveMenu('ai-command'),
    },
    {
      id: 'sponsor',
      title: '2. School Sponsorship',
      desc: 'เครือข่ายโรงเรียน & พันธมิตร',
      metric: 'CRM & Proposal',
      icon: <Handshake className="w-4 h-4 text-emerald-600" />,
      onClick: () => openSettingsSection('pillars'),
    },
    {
      id: 'courses',
      title: '3. Online Courses',
      desc: 'หลักสูตรพัฒนาทักษะอนาคต',
      metric: `${posts.filter((p) => p.contentType === 'course').length} หลักสูตร`,
      icon: <GraduationCap className="w-4 h-4 text-amber-600" />,
      onClick: () => setActiveMenu('posts'),
    },
    {
      id: 'marketplace',
      title: '4. Marketplace',
      desc: 'สื่อการเรียนรู้ & Affiliate',
      metric: 'Omnichannel',
      icon: <ShoppingBag className="w-4 h-4 text-purple-600" />,
      onClick: () => openSettingsSection('channels'),
    },
  ];

  const isAiChatActive = activeMenu === 'ai-chat';
  const activeMenuItem =
    menuItems.find((m) => m.id === activeMenu) || menuItems[2];

  return (
    <div
      className={`${
        isAiChatActive ? 'h-screen overflow-hidden' : 'min-h-screen'
      } flex bg-[#f6f7f9] text-slate-900 antialiased`}
    >
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-2xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* =================================================================== */}
      {/* MINIMAL-LUXURY EXECUTIVE SIDEBAR                                    */}
      {/* =================================================================== */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[272px] bg-[#0a101d] text-slate-200 border-r border-white/[0.07] flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${desktopMenuCollapsed ? 'lg:hidden' : 'lg:static lg:translate-x-0'}`}
      >
        <div>
          {/* Executive Brand Header */}
          <div className="px-5 py-5 border-b border-white/[0.07] flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <img
                  src="/images/avatar-komkrit.png"
                  alt="Komkrit"
                  className="h-10 w-10 rounded-full ring-1 ring-amber-300/60 object-cover"
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0a101d]" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300/90 font-semibold truncate">
                  KOMKID AI CO-WORK
                </div>
                <div className="font-bold text-sm text-white tracking-tight truncate mt-0.5">
                  คมคิด by KOMKRIT
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => toggleDesktopMenu(true)}
                title="ซ่อนแถบเมนู"
                className="hidden lg:inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Refined Navigation List */}
          <div className="px-3 pt-4 pb-2">
            <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Command & Production
            </div>
            <nav className="space-y-1">
              {menuItems.map((m) => {
                const active =
                  activeMenu === m.id ||
                  (activeMenu === 'dashboard' && m.id === 'posts');
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      setActiveMenu(m.id);
                      setSidebarOpen(false);
                    }}
                    className={`group relative w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left transition cursor-pointer ${
                      active
                        ? 'bg-white/[0.09] text-white ring-1 ring-amber-300/25 shadow-xs'
                        : 'text-slate-300/85 hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r bg-amber-300" />
                    )}
                    <span className="flex items-center gap-3 min-w-0">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition ${
                          active
                            ? 'bg-amber-300/15 text-amber-300'
                            : 'bg-white/[0.04] text-slate-400 group-hover:text-slate-200'
                        }`}
                      >
                        {m.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold leading-snug truncate">
                          {m.label}
                        </span>
                        <span
                          className={`block text-[11px] mt-0.5 truncate ${
                            active ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {m.sub}
                        </span>
                      </span>
                    </span>
                    {typeof m.badge === 'number' && m.badge > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? 'bg-amber-300/20 text-amber-200'
                            : 'bg-white/[0.07] text-slate-300'
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

          {/* Architecture Flow Reference Trigger */}
          <div className="px-4 pt-3">
            <button
              type="button"
              onClick={() => setBlueprintOpen(true)}
              className="w-full rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.05] to-transparent p-3 text-left hover:border-amber-300/30 transition cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-amber-200">
                <span>ผังสถาปัตยกรรม AI Flow</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-75" />
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Agent CEO (01–08) & AI Co-work 4 ธุรกิจหลัก
              </p>
            </button>
          </div>
        </div>

        {/* Bottom Sidebar Footer */}
        <div className="p-3.5 border-t border-white/[0.07] space-y-1.5">
          <button
            onClick={onOpenPublicWebsite}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white text-[#0a101d] px-3.5 py-2.5 text-xs font-bold hover:bg-amber-200 transition cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5" />
            เปิดดูหน้าเว็บไซต์จริง
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* =================================================================== */}
      {/* MAIN EXECUTIVE WORKSPACE                                            */}
      {/* =================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Frosted Minimal Executive Header */}
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/75 px-4 sm:px-7 h-15 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0a101d] text-white text-xs font-semibold cursor-pointer shrink-0"
            >
              <Menu className="w-4 h-4" />
              เมนู
            </button>
            {desktopMenuCollapsed && (
              <button
                type="button"
                onClick={() => toggleDesktopMenu(false)}
                title="เปิดแสดงแถบเมนู"
                className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition cursor-pointer shrink-0"
              >
                <PanelLeftOpen className="w-3.5 h-3.5 text-slate-500" />
                เปิดเมนูแท็บ
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                KOMKID STUDIO
              </span>
              <span className="hidden sm:inline text-slate-300">/</span>
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
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0a101d] px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-slate-800 transition cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">เต็มจอ</span>
              </button>
            )}
            {aiStatus && (
              <button
                type="button"
                onClick={() => openSettingsSection('api_keys')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  connectedProvidersCount > 0
                    ? 'bg-emerald-50 border border-emerald-200/80 text-emerald-800 hover:bg-emerald-100/70'
                    : 'bg-amber-100 border border-amber-300 text-amber-950 hover:bg-amber-200/70'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                {connectedProvidersCount > 0
                  ? `API Vault • ${connectedProvidersCount} ค่าย`
                  : 'เชื่อมต่อ API Key'}
              </button>
            )}
            <button
              onClick={() => setBlueprintOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-amber-600" />
              ผัง AI Flow
            </button>
            <button
              onClick={onOpenPublicWebsite}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">หน้าเว็บจริง</span>
            </button>
          </div>
        </header>

        <main
          className={
            isAiChatActive
              ? 'flex-1 flex flex-col min-h-0 w-full overflow-hidden'
              : 'flex-1 p-4 sm:p-7 max-w-[1320px] w-full mx-auto space-y-6'
          }
        >
          {/* Subtle Executive API Key Callout if zero keys connected */}
          {aiStatus &&
            connectedProvidersCount === 0 &&
            (activeMenu === 'media-gen' || activeMenu === 'ai-command') && (
              <div className="rounded-2xl bg-white border border-amber-200/90 p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700 shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      เชื่อมต่อ API Key เพียงครั้งเดียวเพื่อเปิดระบบ Real Multi-Agent
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      คีย์ถูกเข้ารหัสด้วย AES-256-GCM อัตโนมัติ แนะนำใส่คีย์ Google Gemini หรือ OpenAI เพื่อสั่งงานทั้งแชท บทความ รูปภาพ และวิดีโอ
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openSettingsSection('api_keys')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0a101d] px-4 py-2.5 text-xs font-semibold text-amber-200 hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" /> ตั้งค่า API Vault
                </button>
              </div>
            )}

          {/* 1. CONTENT MANAGEMENT + EXECUTIVE OVERVIEW */}
          {(activeMenu === 'posts' || activeMenu === 'dashboard') && (
            <>
              {/* Executive KPI + AI Co-work Hero Banner */}
              <div className="rounded-2xl bg-gradient-to-r from-[#0a101d] via-[#101c33] to-[#162747] text-white p-5 sm:p-6 shadow-sm border border-slate-900/10">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300">
                      <Crown className="w-3.5 h-3.5" />
                      CEO / KOM KID AI MANAGER • ศูนย์กลางบริหารงานด้วย AI
                    </div>
                    <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                      คิดต่างอย่างสร้างสรรค์ — สั่งงานทีม AI Agent สร้างสื่อการศึกษาครบวงจร
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-300/85 max-w-2xl">
                      เชื่อมโยง Agent นักวิจัย นักเขียน นักสร้างภาพ นักสร้างวิดีโอ และผู้ตรวจคุณภาพเข้าสู่เนื้อหาเว็บไซต์และโซเชียลในที่เดียว
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveMenu('ai-chat')}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#0a101d] hover:bg-amber-200 transition cursor-pointer"
                    >
                      <Bot className="w-4 h-4" />
                      เปิด AI Co-work Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMenu('ai-command')}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-white/[0.14] transition cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      สั่งงาน Agent CEO (01–08)
                    </button>
                  </div>
                </div>

                {/* Minimal KPI Row */}
                <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/10">
                  <div>
                    <div className="text-[11px] text-slate-400">คอนเทนต์บนเว็บไซต์</div>
                    <div className="text-lg sm:text-2xl font-bold text-white mt-0.5">
                      {stats?.postsTotal ?? posts.length}{' '}
                      <span className="text-xs font-normal text-slate-400">เรื่อง</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">ยอดการเข้าชมสะสม</div>
                    <div className="text-lg sm:text-2xl font-bold text-white mt-0.5">
                      {formatViews(stats?.totalViews ?? 0)}{' '}
                      <span className="text-xs font-normal text-slate-400">ครั้ง</span>
                    </div>
                  </div>
                  <div
                    onClick={() => openSettingsSection('inbox')}
                    className="cursor-pointer group"
                  >
                    <div className="text-[11px] text-slate-400 group-hover:text-amber-300 transition">
                      ชุมชนผู้ติดตาม & ข้อความ
                    </div>
                    <div className="text-lg sm:text-2xl font-bold text-white mt-0.5 flex items-center gap-1.5">
                      {(stats?.totalSubscribers ?? 0) + (stats?.unreadContacts ?? 0)}{' '}
                      <span className="text-xs font-normal text-slate-400">รายการ</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Revenue Engines Strip (From Blueprint 2: KOM KID by Komkrit) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {revenueEngines.map((eng) => (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={eng.onClick}
                    className="group rounded-2xl bg-white border border-slate-200/80 p-4 text-left hover:border-slate-300 hover:shadow-xs transition cursor-pointer flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 border border-slate-100">
                        {eng.icon}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 bg-slate-100/80 rounded-full px-2.5 py-0.5">
                        {eng.metric}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-[#0d2546]">
                        {eng.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{eng.desc}</div>
                    </div>
                  </button>
                ))}
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

          {/* 2. AI CO-WORK & UNIFIED CHAT STUDIO */}
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

          {/* 3. VISUAL 04 & VIDEO 05 STUDIO */}
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

          {/* 4. AGENT CEO (01-08) COMMAND CENTER */}
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

          {/* 5. COMMUNITY, OMNICHANNEL & ENCRYPTED SETTINGS */}
          {activeMenu === 'settings' && (
            <div className="space-y-5">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white rounded-2xl p-1.5 border border-slate-200/80 shadow-2xs">
                {settingsTabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSettingsTab(t.id)}
                    className={`inline-flex items-center gap-2 shrink-0 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                      settingsTab === t.id
                        ? 'bg-[#0a101d] text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100/80'
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
                    className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 space-y-4 shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0a101d] text-amber-300">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900">
                          เปลี่ยนรหัสผ่านผู้ดูแลระบบ
                        </h3>
                        <p className="text-xs text-slate-500">
                          บัญชีสำหรับเข้าใช้งานหน้า <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">/admin</code>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          ชื่อผู้ใช้
                        </label>
                        <input
                          type="text"
                          required
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-slate-900 focus:outline-none"
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
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="ตั้งรหัสผ่านใหม่"
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
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
                        className="rounded-xl bg-[#0a101d] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
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
      </div>

      {/* ARCHITECTURE BLUEPRINT VIEWER MODAL (Shows Both Uploaded Flow Diagrams!) */}
      {blueprintOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={() => setBlueprintOpen(false)}
        >
          <div
            className="my-auto w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-7 shadow-2xl space-y-6 border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">
                  KOMKID BY KOMKRIT ARCHITECTURE
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-0.5">
                  แผนผัง AI Content Creation Flow (01–08) & AI Co-work 4 ธุรกิจหลัก
                </h3>
              </div>
              <button
                onClick={() => setBlueprintOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">
                  1. AI Content Creation Flow — สั่งงาน วางแผน ติดตาม ผ่าน AGENT CEO (01–08)
                </div>
                <img
                  src="/images/blueprint-8agent-flow.jpg"
                  alt="AI Content Creation Flow"
                  className="w-full rounded-xl border border-slate-200"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">
                  2. KOM KID AI Co-work — 4 ธุรกิจหลัก (Revenue Engines) & 3 ระบบสนับสนุนหลัก
                </div>
                <img
                  src="/images/blueprint-komkid-cowork.jpg"
                  alt="KOM KID AI Co-work"
                  className="w-full rounded-xl border border-slate-200"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
