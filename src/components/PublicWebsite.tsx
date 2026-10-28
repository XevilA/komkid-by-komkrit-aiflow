import React, { useRef, useState } from 'react';
import {
  Search,
  Menu,
  X,
  Mail,
  ArrowRight,
  ChevronRight,
  GraduationCap,
  Lightbulb,
  Users,
  Globe,
  Briefcase,
  Cpu,
  BookOpen,
  Calendar,
  Eye,
  MessageSquare,
  Sparkles,
  LayoutDashboard,
  Play,
  PlusCircle,
  CheckCircle2,
  Send,
  Award,
  Building2,
  Languages,
} from 'lucide-react';
import {
  Post,
  CategoryId,
  CATEGORIES,
  BusinessPillarItem,
} from '../types';
import { api, formatThaiDate, formatViews } from '../api';

export type PublicTab =
  | 'home'
  | 'articles'
  | 'videos'
  | 'courses'
  | 'about'
  | 'contact';

interface Props {
  posts: Post[];
  pillars: BusinessPillarItem[];
  pendingApprovalsCount: number;
  onOpenPost: (id: number) => void;
  onGoToAdmin: (initialTab?: string) => void;
  onQuickCreatePost: () => void;
}

const CATEGORY_ICONS: Record<CategoryId, React.ReactNode> = {
  education: <GraduationCap className="w-5 h-5 text-white" />,
  innovation: <Lightbulb className="w-5 h-5 text-white" />,
  society: <Users className="w-5 h-5 text-white" />,
  international: <Globe className="w-5 h-5 text-white" />,
  career: <Briefcase className="w-5 h-5 text-white" />,
  'ai-tech': <Cpu className="w-5 h-5 text-white" />,
  special: <BookOpen className="w-5 h-5 text-white" />,
};

export const PublicWebsite: React.FC<Props> = ({
  posts,
  pillars,
  pendingApprovalsCount,
  onOpenPost,
  onGoToAdmin,
  onQuickCreatePost,
}) => {
  const [activeTab, setActiveTab] = useState<PublicTab>('home');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Modals
  const [newsletterOpen, setNewsletterOpen] = useState(false);
  const [specialProjectOpen, setSpecialProjectOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveySent, setSurveySent] = useState(false);
  const [surveyData, setSurveyData] = useState({
    respondentName: '',
    respondentRole: 'ครู / บุคลากรทางการศึกษา',
    schoolOrOrg: '',
    preferredChannel: 'LINE OA',
    requestedTopic: '',
    satisfactionScore: 5,
    feedbackDetail: '',
  });
  const [subEmail, setSubEmail] = useState('');
  const [subName, setSubName] = useState('');
  const [subRole, setSubRole] = useState('ครู / บุคลากรทางการศึกษา');
  const [subSuccess, setSubSuccess] = useState(false);

  // Contact form
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: 'ติดต่องานบรรยาย / เวิร์กช็อป AI for Education',
    message: '',
  });
  const [contactSent, setContactSent] = useState(false);

  const catScrollRef = useRef<HTMLDivElement>(null);

  const publishedPosts = posts.filter((p) => p.status === 'published');

  const featuredPost =
    publishedPosts.find((p) => p.isFeatured) || publishedPosts[0] || null;

  const filteredPosts = publishedPosts.filter((p) => {
    if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.excerpt.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const latestSidebarPosts = (
    selectedCategory === 'all' && !searchQuery.trim()
      ? publishedPosts.filter((p) => p.id !== featuredPost?.id)
      : filteredPosts
  ).slice(0, 4);

  const videoPosts = publishedPosts.filter(
    (p) => p.contentType === 'video' || Boolean(p.videoUrl)
  );
  const coursePosts = publishedPosts.filter((p) => p.contentType === 'course');

  const handleCategoryClick = (catId: CategoryId) => {
    if (selectedCategory === catId) {
      setSelectedCategory('all');
    } else {
      setSelectedCategory(catId);
      if (activeTab !== 'home' && activeTab !== 'articles') {
        setActiveTab('articles');
      }
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subEmail.trim()) return;
    await api.subscribe({ email: subEmail, name: subName, role: subRole });
    setSubSuccess(true);
    setSubEmail('');
    setSubName('');
    setTimeout(() => {
      setSubSuccess(false);
      setNewsletterOpen(false);
    }, 1800);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.sendContact(contactForm);
    setContactSent(true);
    setContactForm({
      name: '',
      email: '',
      subject: 'ติดต่องานบรรยาย / เวิร์กช็อป AI for Education',
      message: '',
    });
    setTimeout(() => setContactSent(false), 3500);
  };

  const navItems: { id: PublicTab; label: string }[] = [
    { id: 'home', label: 'หน้าแรก' },
    { id: 'articles', label: 'บทความ' },
    { id: 'videos', label: 'วิดีโอ' },
    { id: 'courses', label: 'คอร์ส/เวิร์กช็อป' },
    { id: 'about', label: 'เกี่ยวกับผม' },
    { id: 'contact', label: 'ติดต่อ' },
  ];

  const getCategoryBadge = (catId: CategoryId) =>
    CATEGORIES.find((c) => c.id === catId) || CATEGORIES[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#f3f6fb]">
      {/* Top Navbar (Desktop matches Image 2, Mobile matches Image 3) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md shadow-xs border-b border-slate-200/70">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 h-16 sm:h-[70px] flex items-center justify-between gap-3">
          {/* Brand Logo */}
          <button
            onClick={() => {
              setActiveTab('home');
              setSelectedCategory('all');
              setSearchQuery('');
            }}
            className="flex items-center gap-2.5 text-left cursor-pointer shrink-0"
          >
            <img
              src="/images/avatar-komkrit.png"
              alt="คมคิด by KOMKRIT"
              className="h-10 w-10 sm:h-11 sm:w-11 rounded-full object-cover shadow-xs"
            />
            <div className="leading-none">
              <div className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#0d2546]">
                คมคิด
              </div>
              <div className="text-[11px] sm:text-xs font-bold tracking-wide text-[#e88d14]">
                by KOMKRIT
              </div>
            </div>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-2 text-[14.5px] font-semibold transition cursor-pointer ${
                    active
                      ? 'text-[#0d2546]'
                      : 'text-slate-600 hover:text-[#0d2546]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-[#f59e0b]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Desktop Search + Social + CTA + Admin/AI Studio */}
          <div className="hidden lg:flex items-center gap-2.5">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeTab !== 'home' && activeTab !== 'articles') {
                    setActiveTab('articles');
                  }
                }}
                placeholder="ค้นหาบทความ, คอร์ส, เนื้อหา..."
                className="w-52 xl:w-60 rounded-full border border-slate-200 bg-slate-50 pl-4 pr-9 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#f59e0b] focus:bg-white focus:outline-none transition"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            </div>

            {/* Social Icons */}
            <div className="hidden xl:flex items-center gap-1.5">
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white text-[11px] font-bold hover:opacity-85"
                title="X (Twitter)"
              >
                𝕏
              </a>
              <a
                href="https://www.youtube.com/watch?v=VxQwQ9vQkkc"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ef4444] text-white text-[10px] font-bold hover:opacity-85"
                title="YouTube"
              >
                ▶
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1877f2] text-white text-xs font-bold hover:opacity-85"
                title="Facebook"
              >
                f
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white text-[10px] font-bold hover:opacity-85"
                title="Instagram"
              >
                IG
              </a>
            </div>

            <button
              onClick={() => setNewsletterOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0d2546] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173966] transition cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              สมัครรับข่าวสาร
            </button>

            <button
              onClick={() => onGoToAdmin('ai-command')}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#d97706] px-3.5 py-2 text-xs font-bold text-[#0b1e38] shadow-xs hover:brightness-105 transition cursor-pointer"
              title="เข้าสู่ระบบหลังบ้าน CRUD & AI Multi-Agent Command Center"
            >
              <Sparkles className="w-3.5 h-3.5" />
              หลังบ้าน & AI Studio
              {pendingApprovalsCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0d2546] px-1 text-[10px] font-bold text-amber-300">
                  {pendingApprovalsCount}
                </span>
              )}
            </button>
          </div>

          {/* Mobile Right Icons (Matches Image 3: Search + Admin shortcut + Hamburger) */}
          <div className="flex lg:hidden items-center gap-1.5">
            <button
              onClick={() => onGoToAdmin('ai-command')}
              className="inline-flex items-center gap-1 rounded-full bg-amber-400/95 px-2.5 py-1.5 text-[11px] font-bold text-[#0d2546] shadow-2xs cursor-pointer"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>หลังบ้าน/AI</span>
            </button>
            <button
              onClick={() => setMobileSearchOpen((v) => !v)}
              className="p-2 rounded-full text-[#0d2546] hover:bg-slate-100 cursor-pointer"
              aria-label="ค้นหา"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="p-2 rounded-full text-[#0d2546] hover:bg-slate-100 cursor-pointer"
              aria-label="เมนู"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        {mobileSearchOpen && (
          <div className="lg:hidden border-t border-slate-100 bg-white px-4 py-2.5">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาบทความ, ความรู้, คอร์ส..."
                autoFocus
                className="w-full rounded-full border border-slate-200 bg-slate-50 pl-4 pr-9 py-2 text-sm focus:border-[#f59e0b] focus:bg-white focus:outline-none"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        )}

        {/* Mobile Slide-down Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-2 shadow-xl">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-[#0d2546] text-white'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{item.label}</span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>
            ))}
            <div className="pt-2 grid grid-cols-2 gap-2 border-t border-slate-100">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setNewsletterOpen(true);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-[#0d2546] cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5" /> สมัครรับข่าวสาร
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onGoToAdmin('posts');
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f59e0b] py-2.5 text-xs font-bold text-[#0d2546] cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" /> จัดการโพสต์ CRUD
              </button>
            </div>
          </div>
        )}
      </header>

      {/* HERO BANNER (Matches Image 2 Desktop & Image 3 Mobile!) */}
      {(activeTab === 'home' || activeTab === 'articles') && (
        <section className="relative overflow-hidden bg-gradient-to-r from-[#dce9f7] via-[#e9eff6] to-[#d9e5f3] border-b border-slate-200/80">
          {/* Soft coastal clouds & warm horizon glow */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(255,255,255,0.95),_rgba(255,255,255,0.35)_52%,_transparent_80%)] z-10" />

          <div className="mx-auto max-w-[1360px] relative">
            <div className="grid grid-cols-12 items-center min-h-[225px] sm:min-h-[275px] lg:min-h-[305px]">
              {/* Left Brand & Slogan */}
              <div className="col-span-7 sm:col-span-6 lg:col-span-5 z-20 pl-4 sm:pl-8 lg:pl-10 py-6 sm:py-8">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#0c2649] drop-shadow-2xs leading-none">
                  คมคิด
                </h1>
                <div className="mt-1 text-lg sm:text-2xl lg:text-[26px] font-bold text-[#e68a15]">
                  by KOMKRIT
                </div>
                <div className="mt-2 sm:mt-3 font-brush text-2xl sm:text-3xl lg:text-[38px] text-[#0c2649] -rotate-2 origin-left leading-tight">
                  คิดต่างอย่างสร้างสรรค์
                </div>
                <p className="hidden md:block mt-3 text-xs lg:text-sm font-medium text-[#1e3a5f]">
                  บทความ &nbsp;•&nbsp; ความรู้ &nbsp;•&nbsp; ไอเดีย &nbsp;•&nbsp; เพื่อการพัฒนาคนและสังคม
                </p>
                <div className="mt-3.5 sm:mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => {
                      const el = document.getElementById('latest-section');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#ea8810] px-4 sm:px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-md hover:brightness-105 transition cursor-pointer"
                  >
                    ดูบทความล่าสุด
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onQuickCreatePost}
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white/90 border border-[#0d2546]/20 px-4 py-2 text-xs font-bold text-[#0d2546] hover:bg-[#0d2546] hover:text-white transition cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-[#e88d14]" />
                    โพสต์ข่าวสาร/บทความใหม่
                  </button>
                </div>
              </div>

              {/* Center-Right Komkrit Portrait & Phuket Bay */}
              <div className="col-span-5 sm:col-span-6 lg:col-span-4 relative h-full min-h-[225px] sm:min-h-[275px] lg:min-h-[305px] flex items-end justify-center overflow-hidden">
                <img
                  src="/images/hero-komkrit.jpg"
                  alt="Komkrit"
                  className="h-full w-full object-cover object-top scale-[1.03]"
                  style={{
                    maskImage:
                      'linear-gradient(to right, transparent 0%, black 14%, black 88%, transparent 100%)',
                    WebkitMaskImage:
                      'linear-gradient(to right, transparent 0%, black 14%, black 88%, transparent 100%)',
                  }}
                />
              </div>

              {/* Right Quote (Desktop xl / lg) */}
              <div className="hidden lg:flex lg:col-span-3 z-20 pr-8 flex-col items-end text-right">
                <div className="rounded-2xl bg-white/55 backdrop-blur-xs px-5 py-4 border border-white/70 shadow-xs">
                  <p className="text-base xl:text-lg font-semibold text-[#0d2546] leading-relaxed">
                    “ การศึกษา คือรากฐาน
                    <br />
                    ของการพัฒนาคน
                    <br />
                    และการสร้างอนาคตที่ดีกว่า ”
                  </p>
                  <div className="mt-1 font-signature text-2xl text-[#1e3a5f] -rotate-3">
                    Komkrit
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 7 CATEGORY CARDS BAR (Desktop 7-col horizontal cards, Mobile swipeable square cards matching Image 2 & 3!) */}
      {(activeTab === 'home' || activeTab === 'articles') && (
        <section className="bg-white border-b border-slate-200/70 py-3.5 sm:py-4 shadow-2xs">
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 relative">
            {/* Desktop 7-col grid */}
            <div className="hidden lg:grid lg:grid-cols-7 gap-3">
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat.id)}
                    className={`group flex items-center gap-3 rounded-xl border p-2.5 text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-[#f59e0b] bg-amber-50/70 shadow-sm ring-1 ring-[#f59e0b]'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-xs group-hover:scale-105 transition"
                      style={{ backgroundColor: cat.color }}
                    >
                      {CATEGORY_ICONS[cat.id]}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-bold text-[#0d2546]">
                        {cat.nameTh}
                      </div>
                      <div className="truncate text-[10.5px] text-slate-400">
                        {cat.nameEn}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Mobile Horizontal Swipeable Cards (Exact match to Image 3!) */}
            <div className="relative lg:hidden">
              <div
                ref={catScrollRef}
                className="flex items-stretch gap-2.5 overflow-x-auto no-scrollbar pr-9"
              >
                {CATEGORIES.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryClick(cat.id)}
                      className={`flex flex-col items-center justify-center shrink-0 w-[96px] rounded-2xl border p-2.5 text-center transition cursor-pointer ${
                        isSelected
                          ? 'border-[#f59e0b] bg-amber-50 shadow-xs'
                          : 'border-slate-200/90 bg-white'
                      }`}
                    >
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-full shadow-xs mb-1.5"
                        style={{ backgroundColor: cat.color }}
                      >
                        {CATEGORY_ICONS[cat.id]}
                      </div>
                      <div className="text-xs font-bold text-[#0d2546] leading-tight line-clamp-2">
                        {cat.nameTh}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400 truncate w-full">
                        {cat.nameEn.split(' ')[0]}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() =>
                  catScrollRef.current?.scrollBy({ left: 180, behavior: 'smooth' })
                }
                className="absolute right-0 top-1/2 -translate-y-1/2 flex h-9 w-7 items-center justify-center rounded-l-xl bg-white/95 border border-slate-200 shadow-sm text-slate-600"
                aria-label="เลื่อนหมวดหมู่"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* MAIN CONTENT BODY */}
      <main id="latest-section" className="flex-1 mx-auto w-full max-w-[1360px] px-4 sm:px-6 py-6 sm:py-8">
        {/* Active Filter Pill Bar if filtering */}
        {(selectedCategory !== 'all' || searchQuery.trim()) && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 border border-amber-200 shadow-2xs">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-[#0d2546]">
                กำลังแสดงผล ({filteredPosts.length} รายการ):
              </span>
              {selectedCategory !== 'all' && (
                <span className="rounded-full bg-[#0d2546] px-3 py-0.5 text-xs font-bold text-white">
                  หมวด: {getCategoryBadge(selectedCategory).nameTh}
                </span>
              )}
              {searchQuery.trim() && (
                <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-900">
                  ค้นหา: "{searchQuery}"
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
              }}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              ล้างตัวกรองทั้งหมด ✕
            </button>
          </div>
        )}

        {/* TAB 1: HOME (Matches 3-Column Desktop Image 2 & Stacked Mobile Image 3!) */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* LEFT COLUMN: บทความล่าสุด (Latest Articles) */}
              <div className="lg:col-span-4 rounded-2xl bg-white border border-slate-200/80 p-4 sm:p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1.5 rounded-full bg-[#f59e0b]" />
                    <h2 className="text-lg font-extrabold text-[#0d2546]">
                      บทความล่าสุด
                    </h2>
                  </div>
                  <button
                    onClick={() => setActiveTab('articles')}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-[#0d2546] transition cursor-pointer"
                  >
                    ดูทั้งหมด <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {latestSidebarPosts.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">
                    ไม่พบบทความในหมวดหมู่นี้
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {latestSidebarPosts.map((post) => {
                      const cat = getCategoryBadge(post.category);
                      return (
                        <div
                          key={post.id}
                          onClick={() => onOpenPost(post.id)}
                          className="group py-3 first:pt-0 last:pb-0 flex items-center gap-3.5 cursor-pointer"
                        >
                          <div className="relative h-[68px] w-[104px] sm:h-[72px] sm:w-[110px] shrink-0 overflow-hidden rounded-xl bg-[#0d2546]">
                            <img
                              src={post.coverImage}
                              alt={post.title}
                              className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                            />
                            {post.contentType === 'video' && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <Play className="w-5 h-5 text-white fill-white" />
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span
                              className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold mb-1"
                              style={{
                                backgroundColor: cat.bgLight,
                                color: cat.color,
                              }}
                            >
                              {cat.badgeLabel}
                            </span>
                            <h3 className="text-[13.5px] font-bold text-[#0d2546] leading-snug line-clamp-2 group-hover:text-[#d97706] transition">
                              {post.title}
                            </h3>
                            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatThaiDate(post.createdAt)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {formatViews(post.views)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {post.commentsCount}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#f59e0b] shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CENTER COLUMN: Featured Special Article + Thai-Myanmar Special Project */}
              <div className="lg:col-span-5 space-y-4">
                {featuredPost && (
                  <div
                    onClick={() => onOpenPost(featuredPost.id)}
                    className="group relative overflow-hidden rounded-2xl bg-[#0c203b] min-h-[300px] sm:min-h-[330px] flex items-center shadow-md cursor-pointer border border-[#1a3a63]"
                  >
                    {/* Right speaker image */}
                    <img
                      src={featuredPost.coverImage}
                      alt={featuredPost.title}
                      className="absolute right-0 top-0 h-full w-[68%] object-cover object-center group-hover:scale-103 transition duration-500"
                    />
                    {/* Smooth Navy Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#0b1f3a] via-[#0d2546]/92 via-48% to-transparent" />

                    <div className="relative z-10 p-6 sm:p-7 max-w-[66%]">
                      <span className="inline-block rounded-full bg-[#f59e0b] px-3 py-1 text-[11px] font-extrabold text-[#0b1f3a] shadow-xs">
                        {getCategoryBadge(featuredPost.category).nameTh}
                      </span>

                      <h2 className="mt-3.5 text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                        {featuredPost.title.includes('ในยุค AI') ? (
                          <>
                            การศึกษาไทย
                            <br />
                            ในยุค <span className="text-4xl sm:text-5xl text-[#fbbf24]">AI</span>
                          </>
                        ) : (
                          featuredPost.title
                        )}
                      </h2>

                      <p className="mt-2.5 text-sm sm:text-base font-medium text-slate-200 leading-snug line-clamp-2">
                        {featuredPost.subtitle || featuredPost.excerpt}
                      </p>

                      <button className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#e68a10] px-5 py-2 text-xs sm:text-sm font-extrabold text-[#0b1f3a] shadow-md group-hover:brightness-110 transition cursor-pointer">
                        อ่านต่อ <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Special Project Banner (โครงการพิเศษ: โรงเรียนภาษาและอาชีพ ไทย-เมียนมา) */}
                <div
                  onClick={() => setSpecialProjectOpen(true)}
                  className="group relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#e6f1fb] via-[#f4f8fc] to-[#e0eefb] border border-sky-200/80 p-4 sm:p-5 shadow-2xs cursor-pointer hover:shadow-sm transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#d97706]">
                        ★ โครงการพิเศษ
                      </div>
                      <h3 className="text-base sm:text-lg font-extrabold text-[#0d2546]">
                        โรงเรียนภาษาและอาชีพ ไทย-เมียนมา
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Thai-Myanmar Language and Vocational School
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0d2546] border border-slate-200/70">
                        <BookOpen className="w-3.5 h-3.5 text-[#0284c7]" />
                        หลักสูตรภาษาและอาชีพ
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0d2546] border border-slate-200/70">
                        <Users className="w-3.5 h-3.5 text-[#0d9488]" />
                        ความร่วมมือไทย-เมียนมา
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#0d2546] px-3 py-1.5 text-[11px] font-bold text-white group-hover:bg-[#193d6e] transition">
                        ดูรายละเอียด <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Komkrit Profile & Quote Card */}
              <div className="lg:col-span-3 rounded-2xl bg-white border border-slate-200/80 p-5 shadow-xs space-y-4">
                <div className="flex items-start gap-3.5">
                  <img
                    src="/images/author-komkrit.jpg"
                    alt="คมกฤช (Komkrit)"
                    className="h-24 w-24 rounded-xl object-cover shrink-0 border border-slate-100 shadow-2xs"
                  />
                  <div>
                    <div className="text-xl font-extrabold text-[#0d2546] leading-none">
                      คมคิด
                    </div>
                    <div className="text-xs font-bold text-[#e88d14] mt-0.5">
                      by KOMKRIT
                    </div>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      คิดต่างอย่างสร้างสรรค์ เพื่อการพัฒนาคน สังคม และอนาคตที่ดีกว่า
                    </p>
                    <button
                      onClick={() => setActiveTab('about')}
                      className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-[#0d2546] px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#193d6e] transition cursor-pointer"
                    >
                      เกี่ยวกับผม <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Quote Box */}
                <div className="rounded-xl bg-[#f7f9fc] border border-slate-200/60 p-4 relative">
                  <span className="text-2xl font-serif text-slate-300 leading-none">“</span>
                  <p className="text-xs sm:text-[13px] font-semibold text-[#0d2546] leading-relaxed -mt-2 pl-3">
                    ทุกความคิดที่แตกต่าง คือจุดเริ่มต้นของการเปลี่ยนแปลง และการสร้างสิ่งที่ดีกว่า
                  </p>
                </div>

                {/* Social & Subscribe */}
                <div className="pt-1">
                  <div className="text-[11px] font-bold text-slate-500 mb-2">
                    ติดตามผมได้ที่
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <a
                        href="https://x.com"
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white text-[11px] font-bold"
                      >
                        𝕏
                      </a>
                      <a
                        href="https://www.youtube.com/watch?v=VxQwQ9vQkkc"
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold"
                      >
                        ▶
                      </a>
                      <a
                        href="https://facebook.com"
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1877f2] text-white text-xs font-bold"
                      >
                        f
                      </a>
                      <a
                        href="https://instagram.com"
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white text-[10px] font-bold"
                      >
                        IG
                      </a>
                    </div>

                    <button
                      onClick={() => setNewsletterOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d2546] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#1a3e70] transition cursor-pointer"
                    >
                      <Mail className="w-3 h-3" /> สมัครรับข่าวสาร
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* More Knowledge, Videos & Courses Grid below Main Fold */}
            {filteredPosts.length > 4 && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1.5 rounded-full bg-[#0d2546]" />
                    <h2 className="text-lg font-extrabold text-[#0d2546]">
                      คลังความรู้ ข่าวสาร และมุมมองน่าสนใจ
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onGoToAdmin('ai-command')}
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3.5 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      สร้างคอนเทนต์ใหม่ด้วยทีม AI Agent
                    </button>
                    <button
                      onClick={() => setActiveTab('articles')}
                      className="text-xs font-bold text-[#0d2546] hover:underline cursor-pointer"
                    >
                      ดูทั้งหมด ({publishedPosts.length}) →
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {filteredPosts.slice(0, 8).map((post) => {
                    const cat = getCategoryBadge(post.category);
                    return (
                      <div
                        key={post.id}
                        onClick={() => onOpenPost(post.id)}
                        className="group rounded-2xl bg-white border border-slate-200/80 overflow-hidden shadow-2xs hover:shadow-md transition cursor-pointer flex flex-col"
                      >
                        <div className="relative h-40 overflow-hidden bg-[#0d2546]">
                          <img
                            src={post.coverImage}
                            alt={post.title}
                            className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                          />
                          <span
                            className="absolute top-2.5 left-2.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold text-white shadow-xs"
                            style={{ backgroundColor: cat.color }}
                          >
                            {cat.nameTh}
                          </span>
                          {post.contentType === 'video' && (
                            <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                              <Play className="w-3 h-3 fill-white" /> วิดีโอ
                            </span>
                          )}
                          {post.contentType === 'course' && (
                            <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-purple-700 px-2.5 py-0.5 text-[10px] font-bold text-white">
                              เวิร์กช็อป
                            </span>
                          )}
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="text-sm font-bold text-[#0d2546] line-clamp-2 group-hover:text-[#d97706] transition">
                              {post.title}
                            </h3>
                            <p className="mt-1.5 text-xs text-slate-500 line-clamp-2 font-body">
                              {post.excerpt}
                            </p>
                          </div>
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                            <span>{formatThaiDate(post.createdAt)}</span>
                            <span className="inline-flex items-center gap-2">
                              <span>👁 {formatViews(post.views)}</span>
                              <span>💬 {post.commentsCount}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Full-Width Newsletter Banner (Exact match to Image 3 dark navy callout!) */}
            <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] via-[#13325c] to-[#0d2546] p-5 sm:p-6 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 border border-white/20">
                  <GraduationCap className="w-6 h-6 text-[#fbbf24]" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold">
                    ไม่พลาดทุกบทความดีๆ และมุมมองใหม่ด้านการศึกษา & AI
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300">
                    สมัครรับข่าวสารรายสัปดาห์จาก คมคิด by KOMKRIT ฟรี ไม่มีค่าใช้จ่าย
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto shrink-0">
                <button
                  onClick={() => setSurveyOpen(true)}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-full bg-[#f59e0b] px-5 py-2.5 text-xs sm:text-sm font-extrabold text-[#0b1f3a] hover:brightness-105 transition cursor-pointer"
                >
                  เสนอหัวข้อ / แบบสำรวจผู้เรียน
                </button>
                <button
                  onClick={() => setNewsletterOpen(true)}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-extrabold text-[#0d2546] hover:bg-amber-400 transition cursor-pointer"
                >
                  สมัครเลย <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ALL ARTICLES / NEWS / KNOWLEDGE */}
        {activeTab === 'articles' && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="text-2xl font-extrabold text-[#0d2546]">
                  บทความ ข่าวสาร และคลังความรู้ทั้งหมด
                </h2>
                <p className="text-sm text-slate-500">
                  รวมบทวิเคราะห์ ไอเดีย และนวัตกรรมเพื่อการพัฒนาคนและสังคม ({filteredPosts.length} รายการ)
                </p>
              </div>
              <button
                onClick={onQuickCreatePost}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#0d2546] px-4 py-2 text-xs font-bold text-white hover:bg-[#183b6b] transition cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 text-[#fbbf24]" />
                สร้างบทความ/ข่าวสารใหม่ (CRUD)
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredPosts.map((post) => {
                const cat = getCategoryBadge(post.category);
                return (
                  <div
                    key={post.id}
                    onClick={() => onOpenPost(post.id)}
                    className="group rounded-2xl bg-white border border-slate-200/80 overflow-hidden shadow-xs hover:shadow-lg transition cursor-pointer flex flex-col"
                  >
                    <div className="relative h-48 overflow-hidden bg-[#0d2546]">
                      <img
                        src={post.coverImage}
                        alt={post.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                      />
                      <span
                        className="absolute top-3 left-3 rounded-full px-3 py-1 text-xs font-bold text-white shadow-xs"
                        style={{ backgroundColor: cat.color }}
                      >
                        {cat.nameTh}
                      </span>
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="text-base font-extrabold text-[#0d2546] group-hover:text-[#d97706] transition line-clamp-2">
                          {post.title}
                        </h3>
                        <p className="mt-2 text-sm text-slate-600 line-clamp-3 font-body">
                          {post.excerpt}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                        <span>{formatThaiDate(post.createdAt)}</span>
                        <span className="font-semibold text-[#0d2546] group-hover:text-[#d97706]">
                          อ่านบทความ →
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: VIDEOS */}
        {activeTab === 'videos' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#0d2546]">
                  วิดีโอ & คลิปความรู้ คมคิด by KOMKRIT
                </h2>
                <p className="text-sm text-slate-500">
                  รับชมคลิปวิเคราะห์การศึกษา นวัตกรรม AI และเบื้องหลังการพัฒนาคน
                </p>
              </div>
              <button
                onClick={() => onGoToAdmin('ai-command')}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#f59e0b] px-4 py-2 text-xs font-bold text-[#0d2546] cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> สร้างสคริปต์วิดีโอด้วย AI Video Agent
              </button>
            </div>

            {/* Featured YouTube Player from LINE Chat */}
            <div className="rounded-2xl bg-[#0b1f3a] text-white overflow-hidden shadow-lg grid grid-cols-1 lg:grid-cols-12">
              <div className="lg:col-span-7 aspect-video bg-black">
                <iframe
                  src="https://www.youtube.com/embed/VxQwQ9vQkkc"
                  title="คมคิด by KOMKRIT Video"
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div className="lg:col-span-5 p-6 sm:p-8 flex flex-col justify-center">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold">
                  ▶ YouTube Official Highlight
                </span>
                <h3 className="mt-3 text-xl sm:text-2xl font-extrabold leading-snug">
                  คิดต่างอย่างสร้างสรรค์: ระบบ AI Multi-Agent เพื่อการศึกษาและอนาคตที่ดีกว่า
                </h3>
                <p className="mt-3 text-sm text-slate-300 leading-relaxed font-body">
                  เจาะลึกแนวคิดการผสานพลังของทีม AI อัจฉริยะ (CEO Agent, Content Agent, QA Agent) ร่วมกับการตัดสินใจของมนุษย์ (Human Approval) เพื่อยกระดับสื่อความรู้ไทย
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <button
                    onClick={() => onGoToAdmin('ai-command')}
                    className="rounded-full bg-[#f59e0b] px-5 py-2 text-xs font-extrabold text-[#0b1f3a] hover:brightness-105 cursor-pointer"
                  >
                    ทดลองใช้ระบบ AI Content Studio →
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {videoPosts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => onOpenPost(post.id)}
                  className="group rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs hover:shadow-md cursor-pointer"
                >
                  <div className="relative h-44 bg-[#0d2546]">
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg group-hover:scale-110 transition">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <h4 className="font-bold text-[#0d2546] line-clamp-2">{post.title}</h4>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{post.excerpt}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: COURSES & WORKSHOPS */}
        {activeTab === 'courses' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-gradient-to-r from-[#0d2546] to-[#1b4478] p-6 sm:p-8 text-white">
              <span className="rounded-full bg-[#f59e0b] px-3 py-1 text-xs font-extrabold text-[#0b1f3a]">
                COURSES & WORKSHOPS
              </span>
              <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold">
                คอร์สออนไลน์ เวิร์กช็อป และที่ปรึกษาด้านนวัตกรรมการศึกษา & AI
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-200 max-w-2xl">
                ออกแบบหลักสูตรเฉพาะสำหรับผู้บริหารสถานศึกษา ครู ทีมผลิตสื่อองค์กร และบุคลากรที่ต้องการประยุกต์ใช้ AI อย่างเป็นระบบ
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {(coursePosts.length > 0 ? coursePosts : publishedPosts.slice(0, 2)).map(
                (post) => (
                  <div
                    key={post.id}
                    onClick={() => onOpenPost(post.id)}
                    className="rounded-2xl bg-white border border-slate-200 p-5 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col sm:flex-row gap-4"
                  >
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="h-36 w-full sm:w-44 rounded-xl object-cover shrink-0"
                    />
                    <div className="flex flex-col justify-between">
                      <div>
                        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-800">
                          หลักสูตรแนะนำ
                        </span>
                        <h3 className="mt-2 text-lg font-extrabold text-[#0d2546]">
                          {post.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-600 line-clamp-2 font-body">
                          {post.excerpt}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs font-bold text-[#d97706]">
                          อ่านรายละเอียดหลักสูตร →
                        </span>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* TAB 5: ABOUT KOMKRIT & 5-PILLAR ECOSYSTEM (Matches LINE Image 4 & Image 2!) */}
        {activeTab === 'about' && (
          <div className="space-y-8">
            <div className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xs grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-4 flex flex-col items-center text-center">
                <img
                  src="/images/badge-komkid.png"
                  alt="คมคิด by Komkrit"
                  className="h-44 w-44 object-contain drop-shadow-md"
                />
                <h2 className="mt-3 text-2xl font-extrabold text-[#0d2546]">
                  คมกฤช (Komkrit)
                </h2>
                <p className="text-sm font-bold text-[#e88d14]">
                  ผู้ก่อตั้ง คมคิด by KOMKRIT
                </p>
              </div>
              <div className="lg:col-span-8 space-y-4">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                  วิสัยทัศน์ & พันธกิจ
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-[#0d2546]">
                  “การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้”
                </h3>
                <p className="text-slate-600 font-body text-base leading-relaxed">
                  <strong>คมคิด by KOMKRIT</strong> คือพื้นที่แห่งความคิด ความรู้ และนวัตกรรมที่มุ่งเชื่อมโยงโลกของการศึกษา เทคโนโลยี AI การพัฒนาอาชีพ และความร่วมมือระดับนานาชาติเข้าด้วยกัน เพื่อสร้างโอกาสที่จับต้องได้จริงให้กับผู้เรียน ครู โรงเรียน และสังคมไทย
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <div className="rounded-xl bg-[#f8fafd] p-3.5 border border-slate-100">
                    <Award className="w-5 h-5 text-[#f59e0b] mb-1" />
                    <div className="font-bold text-sm text-[#0d2546]">AI + Human Synergy</div>
                    <div className="text-xs text-slate-500">ระบบ Multi-Agent AI ภายใต้การกำกับคุณภาพโดยมนุษย์</div>
                  </div>
                  <div className="rounded-xl bg-[#f8fafd] p-3.5 border border-slate-100">
                    <Languages className="w-5 h-5 text-[#0284c7] mb-1" />
                    <div className="font-bold text-sm text-[#0d2546]">โรงเรียนภาษา & อาชีพ</div>
                    <div className="text-xs text-slate-500">เชื่อมสะพานทักษะภาษาและวิชาชีพไทย-เมียนมา</div>
                  </div>
                  <div className="rounded-xl bg-[#f8fafd] p-3.5 border border-slate-100">
                    <Building2 className="w-5 h-5 text-[#0d9488] mb-1" />
                    <div className="font-bold text-sm text-[#0d2546]">Lifelong Learning</div>
                    <div className="text-xs text-slate-500">ขับเคลื่อนภูเก็ตและชุมชนไทยสู่การเรียนรู้ตลอดชีวิต</div>
                  </div>
                </div>
              </div>
            </div>

            {/* KOMKID 5-Pillar Business Model (Exact match to LINE Image 4!) */}
            <div className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xs">
              <div className="text-center max-w-2xl mx-auto mb-6">
                <div className="inline-flex items-center gap-2 rounded-full bg-[#0d2546] px-4 py-1 text-xs font-extrabold text-[#fbbf24]">
                  KOMKID 5-PILLAR BUSINESS MODEL
                </div>
                <h3 className="mt-2 text-xl sm:text-2xl font-extrabold text-[#0d2546]">
                  CONTENT &nbsp;→&nbsp; AUDIENCE &nbsp;→&nbsp; TRUST
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  ระบบนิเวศการสร้างคุณค่าอย่างยั่งยืน จากคอนเทนต์คุณภาพสู่ความเชื่อมั่นและชุมชนแห่งการเรียนรู้
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {pillars.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-amber-200/80 bg-gradient-to-b from-amber-50/40 to-white p-4 shadow-2xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="text-[10px] font-extrabold rounded-full bg-[#0d2546] text-amber-300 px-2.5 py-0.5">
                          PILLAR {p.pillarIndex}
                        </span>
                        {p.statusBadge && (
                          <span className="text-[10px] font-extrabold rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">
                            {p.statusBadge}
                          </span>
                        )}
                      </div>
                      <h4 className="font-extrabold text-sm text-[#0d2546]">
                        {p.title}
                      </h4>
                      <div className="text-[11px] font-semibold text-[#d97706] mt-0.5">
                        {p.subtitle}
                      </div>
                      <p className="mt-2 text-xs text-slate-600 font-body leading-relaxed">
                        {p.description}
                      </p>
                    </div>
                    <div className="mt-4 pt-2.5 border-t border-slate-100">
                      <div className="text-[10px] text-slate-400">{p.metricLabel}</div>
                      <div className="text-sm font-extrabold text-[#0d2546]">
                        {p.metricValue}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: CONTACT */}
        {activeTab === 'contact' && (
          <div className="max-w-2xl mx-auto rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 shadow-xs">
            <h2 className="text-2xl font-extrabold text-[#0d2546]">
              ติดต่อ คมคิด by KOMKRIT
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              ติดต่องานบรรยาย ที่ปรึกษาสถานศึกษา เวิร์กช็อป AI for Education หรือความร่วมมือโครงการพิเศษ
            </p>

            {contactSent ? (
              <div className="mt-6 rounded-xl bg-emerald-50 border border-emerald-200 p-5 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                <div className="font-bold text-emerald-900">ส่งข้อความเรียบร้อยแล้ว!</div>
                <p className="text-xs text-emerald-700 mt-1">
                  ข้อความของคุณถูกบันทึกเข้าสู่ระบบหลังบ้านเรียบร้อยแล้ว ทีมงานจะติดต่อกลับโดยเร็วที่สุด
                </p>
              </div>
            ) : (
              <form onSubmit={handleContactSubmit} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      ชื่อ - นามสกุล *
                    </label>
                    <input
                      type="text"
                      required
                      value={contactForm.name}
                      onChange={(e) =>
                        setContactForm({ ...contactForm, name: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                      placeholder="ระบุชื่อของคุณ"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      อีเมลติดต่อกลับ *
                    </label>
                    <input
                      type="email"
                      required
                      value={contactForm.email}
                      onChange={(e) =>
                        setContactForm({ ...contactForm, email: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                      placeholder="name@example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    หัวข้อติดต่อ
                  </label>
                  <select
                    value={contactForm.subject}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, subject: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                  >
                    <option>ติดต่องานบรรยาย / เวิร์กช็อป AI for Education</option>
                    <option>สอบถามโครงการโรงเรียนภาษาและอาชีพ ไทย-เมียนมา</option>
                    <option>ความร่วมมือพันธมิตร / สปอนเซอร์ (Brand Partnership)</option>
                    <option>ข้อเสนอแนะเนื้อหา / อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    รายละเอียดข้อความ *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={contactForm.message}
                    onChange={(e) =>
                      setContactForm({ ...contactForm, message: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                    placeholder="พิมพ์ข้อความของคุณ..."
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full bg-[#0d2546] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#193d6e] transition cursor-pointer"
                >
                  <Send className="w-4 h-4" /> ส่งข้อความถึงทีมงาน
                </button>
              </form>
            )}
          </div>
        )}
      </main>

      {/* FOOTER (Exact match to Image 2 & Image 3 dark navy footer!) */}
      <footer className="bg-[#0d2546] text-white border-t border-[#1c3d6b]">
        <div className="mx-auto max-w-[1360px] px-4 sm:px-6 py-6 sm:py-7 flex flex-col lg:flex-row items-center justify-between gap-5">
          {/* Left Logo + Slogan */}
          <div className="flex items-center gap-3">
            <img
              src="/images/avatar-komkrit.png"
              alt="คมคิด"
              className="h-10 w-10 rounded-full"
            />
            <div>
              <div className="text-lg font-extrabold leading-none">คมคิด</div>
              <div className="text-[11px] font-bold text-[#fbbf24]">by KOMKRIT</div>
            </div>
            <span className="mx-2 h-6 w-px bg-white/20" />
            <span className="font-brush text-lg text-slate-200">
              “คิดต่างอย่างสร้างสรรค์”
            </span>
          </div>

          {/* Center Nav Links */}
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs sm:text-sm text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="hover:text-[#fbbf24] transition cursor-pointer"
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={() => onGoToAdmin('dashboard')}
              className="text-[#fbbf24] font-bold hover:underline cursor-pointer"
            >
              ระบบหลังบ้าน (Admin & AI)
            </button>
          </div>

          {/* Right Motto */}
          <div className="text-center lg:text-right">
            <div className="text-xs sm:text-sm font-semibold text-slate-100">
              “การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้”
            </div>
            <div className="text-[11px] text-slate-400">
              Better Education · Better People · A Better Society
            </div>
          </div>
        </div>
      </footer>

      {/* NEWSLETTER MODAL */}
      {newsletterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClick={() => setNewsletterOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/images/avatar-komkrit.png"
                  alt="Komkrit"
                  className="h-9 w-9 rounded-full"
                />
                <div>
                  <h3 className="font-extrabold text-[#0d2546]">
                    สมัครรับข่าวสาร คมคิด
                  </h3>
                  <p className="text-xs text-slate-500">Email / Newsletter Weekly Insight</p>
                </div>
              </div>
              <button
                onClick={() => setNewsletterOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {subSuccess ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
                <div className="font-bold text-[#0d2546]">ขอบคุณที่ร่วมเป็นครอบครัวคมคิด!</div>
                <p className="text-xs text-slate-500 mt-1">
                  บันทึกอีเมลเข้าสู่ระบบ Newsletter เรียบร้อยแล้ว
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="space-y-3 mt-4">
                <input
                  type="text"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder="ชื่อของคุณ (ไม่บังคับ)"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                />
                <input
                  type="email"
                  required
                  value={subEmail}
                  onChange={(e) => setSubEmail(e.target.value)}
                  placeholder="อีเมลของคุณ *"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                />
                <select
                  value={subRole}
                  onChange={(e) => setSubRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-[#f59e0b] focus:outline-none"
                >
                  <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                  <option value="นักเรียน">นักเรียน / นักศึกษา</option>
                  <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                  <option value="ผู้สนใจทั่วไป">ผู้สนใจทั่วไป</option>
                </select>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-[#0d2546] py-2.5 text-sm font-bold text-white hover:bg-[#183d6e] transition cursor-pointer"
                >
                  ยืนยันสมัครรับข่าวสาร
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* SPECIAL PROJECT MODAL (โรงเรียนภาษาและอาชีพ ไทย-เมียนมา) */}
      {specialProjectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClick={() => setSpecialProjectOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white p-6 sm:p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                  ★ โครงการพิเศษ (Special Initiative)
                </span>
                <h3 className="mt-2 text-xl font-extrabold text-[#0d2546]">
                  โรงเรียนภาษาและอาชีพ ไทย-เมียนมา
                </h3>
                <p className="text-xs text-slate-500">
                  Thai-Myanmar Language and Vocational School
                </p>
              </div>
              <button
                onClick={() => setSpecialProjectOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm text-slate-700 font-body leading-relaxed">
              <p>
                โครงการต้นแบบด้านการจัดการศึกษาเชิงทักษะอาชีพและภาษาข้ามพรมแดน มุ่งยกระดับสมรรถนะการสื่อสาร (ไทย - เมียนมา - อังกฤษ) ควบคู่กับทักษะวิชาชีพสมัยใหม่ที่ตอบโจทย์ภาคบริการ อุตสาหกรรม และเศรษฐกิจดิจิทัล
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
                <div className="rounded-xl bg-sky-50 p-3">
                  <div className="font-bold text-xs text-[#0d2546]">1. หลักสูตรภาษา & อาชีพ</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">เน้นปฏิบัติจริง พร้อมทำงานได้ทันที</div>
                </div>
                <div className="rounded-xl bg-teal-50 p-3">
                  <div className="font-bold text-xs text-[#0d2546]">2. ความร่วมมือไทย-เมียนมา</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">เชื่อมเครือข่ายสถานประกอบการมาตรฐาน</div>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <div className="font-bold text-xs text-[#0d2546]">3. โอกาสสู่ระดับสากล</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">ต่อยอดการเรียนรู้ตลอดชีวิต</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setSpecialProjectOpen(false);
                  setActiveTab('contact');
                }}
                className="rounded-full bg-[#0d2546] px-5 py-2 text-xs font-bold text-white cursor-pointer"
              >
                สอบถามความร่วมมือโครงการ →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUBLIC AUDIENCE FEEDBACK & LEARNER SURVEY MODAL */}
      {surveyOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
          onClick={() => setSurveyOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10.5px] font-extrabold text-amber-900">
                  AUDIENCE FEEDBACK • เสียงสะท้อนจากผู้ชมและผู้เรียน
                </span>
                <h3 className="mt-1 font-extrabold text-lg text-[#0d2546]">
                  แบบสำรวจความต้องการผู้เรียน / ครู / โรงเรียน
                </h3>
              </div>
              <button
                onClick={() => setSurveyOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {surveySent ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
                <div className="font-bold text-[#0d2546]">
                  ส่งเสียงสะท้อนเข้าสู่ระบบ Analytics & CEO Agent แล้ว!
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  ขอบคุณที่ร่วมพัฒนาคอนเทนต์การศึกษาคุณภาพไปกับ คมคิด by KOMKRIT
                </p>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await api.submitSurvey(surveyData);
                  setSurveySent(true);
                  setTimeout(() => {
                    setSurveySent(false);
                    setSurveyOpen(false);
                  }, 1800);
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={surveyData.respondentName}
                    onChange={(e) =>
                      setSurveyData({ ...surveyData, respondentName: e.target.value })
                    }
                    placeholder="ชื่อของคุณ *"
                    className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                  <select
                    value={surveyData.respondentRole}
                    onChange={(e) =>
                      setSurveyData({ ...surveyData, respondentRole: e.target.value })
                    }
                    className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  >
                    <option value="ครู / บุคลากรทางการศึกษา">ครู / บุคลากรทางการศึกษา</option>
                    <option value="นักเรียน / นักศึกษา">นักเรียน / นักศึกษา</option>
                    <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                    <option value="ผู้บริหารโรงเรียน">ผู้บริหารโรงเรียน</option>
                    <option value="ผู้สนใจทั่วไป">ผู้สนใจทั่วไป</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={surveyData.schoolOrOrg}
                    onChange={(e) =>
                      setSurveyData({ ...surveyData, schoolOrOrg: e.target.value })
                    }
                    placeholder="โรงเรียน / หน่วยงาน (ถ้ามี)"
                    className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  />
                  <select
                    value={surveyData.preferredChannel}
                    onChange={(e) =>
                      setSurveyData({
                        ...surveyData,
                        preferredChannel: e.target.value,
                      })
                    }
                    className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                  >
                    <option>LINE OA</option>
                    <option>YouTube</option>
                    <option>Facebook</option>
                    <option>TikTok</option>
                    <option>X (Twitter)</option>
                    <option>Instagram</option>
                    <option>Website / Blog</option>
                    <option>Email / Newsletter</option>
                  </select>
                </div>
                <input
                  type="text"
                  required
                  value={surveyData.requestedTopic}
                  onChange={(e) =>
                    setSurveyData({ ...surveyData, requestedTopic: e.target.value })
                  }
                  placeholder="หัวข้อหรือปัญหาการศึกษาที่อยากให้ คมคิด นำเสนอ *"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold"
                />
                <textarea
                  rows={2}
                  value={surveyData.feedbackDetail}
                  onChange={(e) =>
                    setSurveyData({ ...surveyData, feedbackDetail: e.target.value })
                  }
                  placeholder="ข้อเสนอแนะเพิ่มเติม..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-[#0d2546] py-2.5 text-sm font-extrabold text-white hover:bg-[#183d6e] transition cursor-pointer"
                >
                  ส่งแบบสำรวจให้ทีมงานคมคิด
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
