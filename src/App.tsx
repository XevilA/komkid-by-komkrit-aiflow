import React, { useCallback, useEffect, useState } from 'react';
import {
  Post,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
} from './types';
import { api, DashboardStats, getStoredAdminToken } from './api';
import { PublicWebsite } from './components/PublicWebsite';
import { AdminLayout } from './components/AdminLayout';
import { AdminLoginScreen } from './components/AdminLoginScreen';
import { ArticleReaderModal } from './components/ArticleReaderModal';

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
  const [adminMenu, setAdminMenu] = useState<string>('dashboard');
  const [adminUsername, setAdminUsername] = useState<string>('');
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  const [posts, setPosts] = useState<Post[]>([]);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [pillars, setPillars] = useState<BusinessPillarItem[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [readingPostId, setReadingPostId] = useState<number | null>(() => {
    const sp = new URLSearchParams(window.location.search);
    const pid = sp.get('post');
    return pid ? Number(pid) : null;
  });

  const [initialEditPost, setInitialEditPost] = useState<Post | null>(null);
  const [openCreateImmediately, setOpenCreateImmediately] = useState(false);

  // Sync browser back/forward navigation between `/` and `/admin`
  useEffect(() => {
    const syncRoute = () => {
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
      const [p, pil] = await Promise.all([api.getPosts(), api.getPillars()]);
      setPosts(p);
      setPillars(pil);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    try {
      const [p, w, kb, pil, st] = await Promise.all([
        api.getPosts(),
        api.getWorkflows(),
        api.getKnowledgeBase(),
        api.getPillars(),
        api.getStats(),
      ]);
      setPosts(p);
      setWorkflows(w);
      setKnowledgeItems(kb);
      setPillars(pil);
      setStats(st);
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
    if (window.location.pathname.startsWith('/admin') || window.location.hash) {
      window.history.pushState({}, '', '/');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoToAdmin = (menu = 'dashboard') => {
    setAdminMenu(menu);
    setViewMode('admin');
    if (!window.location.pathname.startsWith('/admin')) {
      window.history.pushState({}, '', '/admin');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  return (
    <>
      {viewMode === 'public' ? (
        <PublicWebsite
          posts={posts}
          pillars={pillars}
          onOpenPost={(id) => setReadingPostId(id)}
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
          initialEditPost={initialEditPost}
          openCreateImmediately={openCreateImmediately}
          onClearInitialEdit={() => {
            setInitialEditPost(null);
            setOpenCreateImmediately(false);
          }}
          onRefreshAll={loadAdminData}
          onOpenPublicWebsite={handleOpenPublic}
          onLogout={handleLogout}
          onPreviewPost={(id) => setReadingPostId(id)}
        />
      )}

      <ArticleReaderModal
        postId={readingPostId}
        onClose={() => setReadingPostId(null)}
        canEdit={Boolean(adminUsername)}
        onEditInAdmin={handleEditPostInAdmin}
        onCommentsUpdated={adminUsername ? loadAdminData : loadPublicData}
      />
    </>
  );
};

export default App;
