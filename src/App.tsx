import React, { useCallback, useEffect, useState } from 'react';
import {
  Post,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
  SiteConfig,
  SpecialProject,
} from './types';
import { api, DashboardStats, getStoredAdminToken } from './api';
import { PublicWebsite } from './components/PublicWebsite';
import { AdminLayout } from './components/AdminLayout';
import { AdminLoginScreen } from './components/AdminLoginScreen';
import { ArticlePage } from './components/ArticlePage';

function isUrlAdminRoute(): boolean {
  return (
    window.location.pathname.startsWith('/admin') ||
    window.location.hash.startsWith('#admin')
  );
}

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'public' | 'admin'>(() =>
    isUrlAdminRoute() ? 'admin' : 'public'
  );
  const [adminMenu, setAdminMenu] = useState<string>(() =>
    new URLSearchParams(window.location.search).get('connect') ? 'settings' : 'posts'
  );
  const [adminUsername, setAdminUsername] = useState<string>('');
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  const [posts, setPosts] = useState<Post[]>([]);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [pillars, setPillars] = useState<BusinessPillarItem[]>([]);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [specialProjects, setSpecialProjects] = useState<SpecialProject[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [path, setPath] = useState<string>(() => window.location.pathname);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState({}, '', to);
    else if (to !== window.location.pathname + window.location.search) window.history.pushState({}, '', to);
    setPath(window.location.pathname);
    setViewMode(to.startsWith('/admin') ? 'admin' : 'public');
    if (!opts?.replace) window.scrollTo({ top: 0 });
  }, []);

  const articleSlug = path.startsWith('/articles/')
    ? (() => {
        try {
          return decodeURIComponent(path.slice('/articles/'.length)).replace(/\/+$/, '');
        } catch {
          return '';
        }
      })()
    : '';

  // Old share links (/?post=12) become real article addresses
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get('post');
    if (pid && /^\d+$/.test(pid)) navigate(`/articles/${pid}`, { replace: true });
  }, [navigate]);

  const [initialEditPost, setInitialEditPost] = useState<Post | null>(null);
  const [openCreateImmediately, setOpenCreateImmediately] = useState(false);

  // Sync browser back/forward navigation between `/` and `/admin`
  useEffect(() => {
    const syncRoute = () => {
      setPath(window.location.pathname);
      setViewMode(isUrlAdminRoute() ? 'admin' : 'public');
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  // Verify existing Admin session token if present
  useEffect(() => {
    const token = getStoredAdminToken();
    if (!token) {
      setAdminUsername('');
      setAuthChecked(true);
      return;
    }
    api
      .verifyAdminSession()
      .then((res) => {
        if (res.authenticated) {
          setAdminUsername(res.username || 'admin');
        } else {
          api.logoutAdmin();
          setAdminUsername('');
        }
      })
      .catch(() => {
        api.logoutAdmin();
        setAdminUsername('');
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

  const loadPublicData = useCallback(async () => {
    try {
      const [p, pil, cfg, projs] = await Promise.all([
        api.getPosts(),
        api.getPillars(),
        api.getSiteConfig().catch(() => null),
        api.getSpecialProjects().catch(() => [] as SpecialProject[]),
      ]);
      setPosts(p);
      setPillars(pil);
      setSiteConfig(cfg);
      setSpecialProjects(projs);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    try {
      const [p, w, kb, pil, st, cfg, projs] = await Promise.all([
        api.getPosts(),
        api.getWorkflows(),
        api.getKnowledgeBase(),
        api.getPillars(),
        api.getStats(),
        api.getSiteConfig().catch(() => null),
        api.getSpecialProjects().catch(() => [] as SpecialProject[]),
      ]);
      setPosts(p);
      setWorkflows(w);
      setKnowledgeItems(kb);
      setPillars(pil);
      setStats(st);
      setSiteConfig(cfg);
      setSpecialProjects(projs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (adminUsername) {
      loadAdminData();
    } else {
      loadPublicData();
    }
  }, [authChecked, adminUsername, loadAdminData, loadPublicData]);

  const handleOpenPublic = () => {
    setViewMode('public');
    navigate('/');
  };

  const handleGoToAdmin = (menu = 'dashboard') => {
    setAdminMenu(menu);
    setViewMode('admin');
    navigate('/admin');
  };

  const handleLogout = () => {
    api.logoutAdmin();
    setAdminUsername('');
    setWorkflows([]);
    setStats(null);
    handleOpenPublic();
  };

  const handleEditPostInAdmin = (post: Post) => {
    if (!adminUsername) return;
    setInitialEditPost(post);
    setOpenCreateImmediately(false);
    handleGoToAdmin('posts');
  };

  const articleHref = (id: number) => {
    const p = posts.find((x) => x.id === id);
    return `/articles/${encodeURIComponent(p?.slug || String(id))}`;
  };
  const openPost = (id: number) => navigate(articleHref(id));
  // Admin previews open in a new tab so the editing session stays where it is
  const previewPost = (id: number) => window.open(articleHref(id), '_blank', 'noopener');

  if (loading || !authChecked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0d2546] text-white gap-3">
        <img
          src="/images/badge-komkid.png"
          alt="คมคิด by KOMKRIT"
          className="h-20 w-20 animate-pulse object-contain"
        />
        <div className="text-sm font-bold tracking-wide">
          กำลังโหลด คมคิด by KOMKRIT...
        </div>
      </div>
    );
  }

  if (articleSlug) {
    return (
      <ArticlePage
        slug={articleSlug}
        allPosts={posts}
        isAdmin={Boolean(adminUsername)}
        brandTitle={siteConfig?.brandTitle || 'คมคิด'}
        brandSub={siteConfig?.brandSub || 'by KOMKRIT'}
        onNavigate={navigate}
        onEditInAdmin={handleEditPostInAdmin}
        onCommentsUpdated={adminUsername ? loadAdminData : loadPublicData}
      />
    );
  }

  return (
    <>
      {viewMode === 'public' ? (
        <PublicWebsite
          posts={posts}
          pillars={pillars}
          siteConfig={siteConfig}
          specialProjects={specialProjects}
          onOpenPost={openPost}
        />
      ) : !adminUsername ? (
        <AdminLoginScreen
          onLoginSuccess={(u) => {
            setAdminUsername(u);
          }}
          onBackToPublic={handleOpenPublic}
        />
      ) : (
        <AdminLayout
          activeMenu={adminMenu}
          setActiveMenu={setAdminMenu}
          adminUsername={adminUsername}
          stats={stats}
          posts={posts}
          workflows={workflows}
          knowledgeItems={knowledgeItems}
          pillars={pillars}
          siteConfig={siteConfig}
          specialProjects={specialProjects}
          initialEditPost={initialEditPost}
          openCreateImmediately={openCreateImmediately}
          onClearInitialEdit={() => {
            setInitialEditPost(null);
            setOpenCreateImmediately(false);
          }}
          onRefreshAll={loadAdminData}
          onOpenPublicWebsite={handleOpenPublic}
          onLogout={handleLogout}
          onPreviewPost={previewPost}
        />
      )}

    </>
  );
};

export default App;
