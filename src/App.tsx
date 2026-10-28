import React, { useCallback, useEffect, useState } from 'react';
import {
  Post,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
} from './types';
import { api, DashboardStats } from './api';
import { PublicWebsite } from './components/PublicWebsite';
import { AdminLayout } from './components/AdminLayout';
import { ArticleReaderModal } from './components/ArticleReaderModal';

export const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'public' | 'admin'>(() =>
    window.location.hash.startsWith('#admin') ? 'admin' : 'public'
  );
  const [adminMenu, setAdminMenu] = useState<string>('dashboard');

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

  const loadAll = useCallback(async () => {
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
    loadAll();
  }, [loadAll]);

  const handleGoToAdmin = (menu = 'dashboard') => {
    setAdminMenu(menu);
    setViewMode('admin');
    window.location.hash = 'admin';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenPublic = () => {
    setViewMode('public');
    window.location.hash = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditPostInAdmin = (post: Post) => {
    setInitialEditPost(post);
    setOpenCreateImmediately(false);
    handleGoToAdmin('posts');
  };

  const handleQuickCreatePost = () => {
    setInitialEditPost(null);
    setOpenCreateImmediately(true);
    handleGoToAdmin('posts');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0d2546] text-white gap-3">
        <img
          src="/images/badge-komkid.png"
          alt="คมคิด by KOMKRIT"
          className="h-24 w-24 animate-pulse object-contain"
        />
        <div className="text-base font-extrabold tracking-wide">
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
          pendingApprovalsCount={stats?.pendingApprovals ?? 0}
          onOpenPost={(id) => setReadingPostId(id)}
          onGoToAdmin={handleGoToAdmin}
          onQuickCreatePost={handleQuickCreatePost}
        />
      ) : (
        <AdminLayout
          activeMenu={adminMenu}
          setActiveMenu={setAdminMenu}
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
          onRefreshAll={loadAll}
          onOpenPublicWebsite={handleOpenPublic}
          onPreviewPost={(id) => setReadingPostId(id)}
        />
      )}

      <ArticleReaderModal
        postId={readingPostId}
        onClose={() => setReadingPostId(null)}
        onEditInAdmin={handleEditPostInAdmin}
        onCommentsUpdated={loadAll}
      />
    </>
  );
};

export default App;
