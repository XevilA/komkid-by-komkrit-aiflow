import {
  Post,
  PostComment,
  KnowledgeItem,
  BusinessPillarItem,
  AiWorkflow,
  Subscriber,
  ContactMessage,
  AiEngineSettings,
  AiChatMessage,
  AiChatSession,
  AiEvaluatedPrompt,
  AiDraftFromChat,
  AiMediaAsset,
  FlowProject,
  ChannelConfig,
  PublishLog,
  AudienceSurvey,
  ChannelKey,
  LlmProviderId,
  DiscoverableProvider,
  ProviderLiveCatalog,
  UnifiedLiveModelsResponse,
} from './types';

const ADMIN_TOKEN_KEY = 'komkrit_admin_token';

// Proactively purge any legacy client-side vault copies from localStorage
try {
  localStorage.removeItem('komkrit_sealed_vault_v1');
  localStorage.removeItem('komkrit_sealed_vault_ts_v1');
} catch {
  // ignore
}

export function getStoredAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredAdminToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function buildAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const token = getStoredAdminToken();
  const base: Record<string, string> = {};
  if (token) {
    base.Authorization = `Bearer ${token}`;
  }
  if (extra) {
    Object.assign(base, extra);
  }
  return base;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(options?.headers),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `HTTP Error ${res.status}`);
  }
  return data as T;
}

export interface DashboardStats {
  postsTotal: number;
  postsPublished: number;
  totalViews: number;
  totalComments: number;
  totalWorkflows: number;
  pendingApprovals: number;
  totalSubscribers: number;
  unreadContacts: number;
  kbCount: number;
  mediaAssetsCount?: number;
}

export const api = {
  // Admin Auth
  loginAdmin: async (username: string, password: string) => {
    const res = await request<{ ok: boolean; token: string; username: string; expiresAt: number }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }
    );
    setStoredAdminToken(res.token);
    return res;
  },
  verifyAdminSession: () =>
    request<{ authenticated: boolean; username?: string }>('/api/auth/me'),
  logoutAdmin: () => {
    setStoredAdminToken('');
  },
  changeAdminPassword: async (payload: {
    currentPassword: string;
    newUsername?: string;
    newPassword: string;
  }) => {
    const res = await request<{ ok: boolean; token: string }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (res.token) setStoredAdminToken(res.token);
    return res;
  },

  getStats: () => request<DashboardStats>('/api/stats'),

  // Posts CRUD
  getPosts: (params?: {
    category?: string;
    type?: string;
    status?: string;
    q?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.category) sp.set('category', params.category);
    if (params?.type) sp.set('type', params.type);
    if (params?.status) sp.set('status', params.status);
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<Post[]>(`/api/posts${qs ? `?${qs}` : ''}`);
  },
  getPostDetail: (id: number, incrementView = true) =>
    request<{ post: Post; comments: PostComment[] }>(
      `/api/posts/${id}?incrementView=${incrementView ? '1' : '0'}`
    ),
  getPostBySlug: (slug: string, incrementView = true) =>
    request<Post & { canonical: boolean; comments: PostComment[] }>(
      `/api/posts/by-slug/${encodeURIComponent(slug)}?incrementView=${incrementView ? '1' : '0'}`
    ),
  createPost: (payload: Partial<Post>) =>
    request<Post>('/api/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePost: (id: number, payload: Partial<Post>) =>
    request<Post>(`/api/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  duplicatePost: (id: number) =>
    request<Post>(`/api/posts/${id}/duplicate`, {
      method: 'POST',
    }),
  bulkPostsAction: (payload: {
    ids: number[];
    action: 'publish' | 'draft' | 'delete' | 'category';
    category?: string;
  }) =>
    request<{ ok: boolean; affected: number; action: string }>('/api/posts/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deletePost: (id: number) =>
    request<{ ok: boolean; deletedId: number; title: string; removedComments: number }>(
      `/api/posts/${id}`,
      { method: 'DELETE' }
    ),

  exportCmsBackup: () =>
    request<{
      version: string;
      exportedAt: string;
      counts: Record<string, number>;
      data: Record<string, any[]>;
    }>('/api/admin/export-json'),
  exportDatabaseBackup: () =>
    request<{
      version: string;
      exportedAt: string;
      counts: Record<string, number>;
      data: Record<string, any[]>;
    }>('/api/admin/export-json'),
  importCmsBackup: (payload: {
    data: Record<string, any[]>;
    mode?: 'merge' | 'replace';
  }) =>
    request<{ ok: boolean; importedPosts: number; importedKnowledge: number }>(
      '/api/admin/import-json',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  importDatabaseBackup: (payload: {
    data: Record<string, any[]>;
    mode?: 'merge' | 'replace';
  }) =>
    request<{
      ok: boolean;
      importedPosts: number;
      restoredPosts?: number;
      importedKnowledge: number;
    }>('/api/admin/import-json', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  uploadFile: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'อัปโหลดไฟล์ไม่สำเร็จ');
    return data.url as string;
  },
  uploadVideo: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'อัปโหลดวิดีโอไม่สำเร็จ');
    return data.url as string;
  },
  uploadImage: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'อัปโหลดรูปภาพไม่สำเร็จ');
    return data.url as string;
  },

  // Comments / Audience Feedback
  getAllComments: () => request<PostComment[]>('/api/comments'),
  addComment: (
    postId: number,
    payload: { authorName: string; authorRole: string; message: string; rating: number }
  ) =>
    request<PostComment>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateComment: (
    id: number,
    payload: Partial<{
      authorName: string;
      authorRole: string;
      message: string;
      rating: number;
    }>
  ) =>
    request<PostComment>(`/api/comments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteComment: (id: number) =>
    request<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE' }),

  // Knowledge Base CRUD
  getKnowledgeBase: () => request<KnowledgeItem[]>('/api/knowledge'),
  createKnowledge: (payload: Partial<KnowledgeItem>) =>
    request<KnowledgeItem>('/api/knowledge', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateKnowledge: (id: number, payload: Partial<KnowledgeItem>) =>
    request<KnowledgeItem>(`/api/knowledge/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteKnowledge: (id: number) =>
    request<{ ok: boolean }>(`/api/knowledge/${id}`, { method: 'DELETE' }),

  // 5-Pillar Business Model
  getPillars: () => request<BusinessPillarItem[]>('/api/pillars'),
  createPillar: (payload: Partial<BusinessPillarItem>) =>
    request<BusinessPillarItem>('/api/pillars', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePillar: (id: number, payload: Partial<BusinessPillarItem>) =>
    request<{ ok: boolean }>(`/api/pillars/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePillar: (id: number) =>
    request<{ ok: boolean }>(`/api/pillars/${id}`, { method: 'DELETE' }),

  // Real Multi-LLM Interactive Chat (Claude, DeepSeek, ChatGPT, Gemini)
  getChatSessions: () => request<AiChatSession[]>('/api/ai/chat-sessions'),
  getChatHistory: (sessionId: string) =>
    request<AiChatMessage[]>(`/api/ai/chat/${encodeURIComponent(sessionId)}`),
  sendChatMessage: (payload: {
    sessionId: string;
    provider?: LlmProviderId;
    model?: string;
    message: string;
    useKnowledgeBase?: boolean;
  }) =>
    request<{
      id: number;
      sessionId: string;
      provider: string;
      model: string;
      engineLabel: string;
      reply: string;
      reasoning?: string;
      latencyMs: number;
      createdAt: string;
    }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  clearChatHistory: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/ai/chat/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  evaluateMediaPrompt: (payload: {
    target: 'image' | 'video';
    sessionId?: string;
    ideaText?: string;
    userIdea?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    provider?: LlmProviderId;
    model?: string;
  }) =>
    request<AiEvaluatedPrompt>('/api/ai/evaluate-prompt', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        ideaText: payload.ideaText || payload.userIdea,
      }),
    }),
  draftContentFromChat: (payload: {
    sessionId?: string;
    ideaText?: string;
    contentFormat?: 'news' | 'article' | 'social_post';
    category?: string;
    provider?: LlmProviderId;
    model?: string;
  }) =>
    request<AiDraftFromChat>('/api/ai/draft-from-chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Real Media Generation (Nano Banana 2.1, Google Veo / Omni Video, Gemini 3.8 TTS)
  getMediaAssets: (type?: 'image' | 'video' | 'audio') =>
    request<AiMediaAsset[]>(`/api/ai/media${type ? `?type=${type}` : ''}`),
  reviewMediaAsset: (id: number, reviewStatus: 'approved' | 'pending_review') =>
    request<{ ok: boolean; id: number; reviewStatus: string }>(`/api/ai/media/${id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ reviewStatus }),
    }),
  deleteMediaAsset: (id: number) =>
    request<{ ok: boolean }>(`/api/ai/media/${id}`, { method: 'DELETE' }),
  generateRealImage: (payload: {
    prompt: string;
    provider?: 'gemini' | 'openai';
    model?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3';
    imageSize?: '1K' | '2K';
    workflowId?: number | null;
    thaiSummary?: string;
    reviewStatus?: 'approved' | 'pending_review';
  }) =>
    request<AiMediaAsset>('/api/ai/image/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateRealVideo: (payload: {
    prompt: string;
    engine?: string;
    aspectRatio?: '16:9' | '9:16';
    durationSec?: number;
    resolution?: '360p' | '720p' | '1080p' | '4k';
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    referenceImageUrls?: string[];
    extendVideoUrl?: string;
    stripAudio?: boolean;
    previousInteractionId?: string;
    workflowId?: number | null;
    thaiSummary?: string;
  }) =>
    request<AiMediaAsset>('/api/ai/video/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateRealAudio: (payload: {
    text: string;
    provider?: 'gemini' | 'openai' | 'elevenlabs';
    model?: string;
    voice?: string;
    style?: string;
    workflowId?: number | null;
  }) =>
    request<AiMediaAsset>('/api/ai/audio/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Real Google Flow Multi-Scene Filmmaking Studio
  getFlowProjects: () => request<FlowProject[]>('/api/ai/flow/projects'),
  createFlowProject: (payload: {
    title: string;
    concept: string;
    sceneCount?: number;
    aspectRatio?: '16:9' | '9:16';
    resolution?: '360p' | '720p' | '1080p' | '4k';
    videoEngine?: string;
    llmProvider?: LlmProviderId;
    llmModel?: string;
  }) =>
    request<FlowProject>('/api/ai/flow/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateFlowProject: (id: number, payload: Partial<FlowProject>) =>
    request<FlowProject>(`/api/ai/flow/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  generateFlowSceneFrame: (
    projectId: number,
    sceneIdx: number,
    payload: { which: 'first' | 'last'; customPrompt?: string; imageModel?: string }
  ) =>
    request<FlowProject>(
      `/api/ai/flow/projects/${projectId}/scene/${sceneIdx}/frame`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  generateFlowSceneVideo: (
    projectId: number,
    sceneIdx: number,
    payload: { mode?: 'keyframes' | 'text_only' | 'extend_prev'; customMotionPrompt?: string }
  ) =>
    request<FlowProject>(
      `/api/ai/flow/projects/${projectId}/scene/${sceneIdx}/video`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  generateFlowVoiceover: (
    projectId: number,
    payload?: { voice?: string; provider?: 'gemini' | 'openai' | 'elevenlabs' }
  ) =>
    request<FlowProject>(`/api/ai/flow/projects/${projectId}/voiceover`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  assembleFlowMasterFilm: (projectId: number, includeVoiceover = true) =>
    request<FlowProject>(`/api/ai/flow/projects/${projectId}/assemble`, {
      method: 'POST',
      body: JSON.stringify({ includeVoiceover }),
    }),
  deleteFlowProject: (id: number) =>
    request<{ ok: boolean }>(`/api/ai/flow/projects/${id}`, { method: 'DELETE' }),

  // Multi-Agent AI Workflows
  getWorkflows: () => request<AiWorkflow[]>('/api/ai/workflows'),
  runWorkflow: (payload: {
    topic: string;
    inputSource: string;
    category: string;
    targetAudience: string;
    businessPillar: string;
    flowMode: 'core_3agent' | 'full_8agent';
    provider?: LlmProviderId;
    model?: string;
    autoGenerateCoverImage?: boolean;
  }) =>
    request<AiWorkflow>('/api/ai/workflows/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateWorkflow: (id: number, payload: Partial<AiWorkflow>) =>
    request<AiWorkflow>(`/api/ai/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  requestWorkflowRevision: (
    id: number,
    revisionNote: string,
    provider?: LlmProviderId,
    model?: string
  ) =>
    request<AiWorkflow>(`/api/ai/workflows/${id}/revision`, {
      method: 'POST',
      body: JSON.stringify({ revisionNote, provider, model }),
    }),
  approveAndPublishWorkflow: (
    id: number,
    payload: {
      customTitle?: string;
      customContent?: string;
      coverImageChoice?: string;
      videoUrlChoice?: string;
      audioUrlChoice?: string;
      isFeatured?: boolean;
      reviewerNote?: string;
      channelsToPublish?: string[];
    }
  ) =>
    request<{ workflow: AiWorkflow; post: Post }>(
      `/api/ai/workflows/${id}/approve-publish`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  deleteWorkflow: (id: number) =>
    request<{ ok: boolean }>(`/api/ai/workflows/${id}`, { method: 'DELETE' }),

  aiAssistPost: (payload: {
    title: string;
    category: string;
    currentContent?: string;
    mode: 'generate_full' | 'polish' | 'generate_real_image';
    provider?: LlmProviderId;
    model?: string;
  }) =>
    request<any>('/api/ai/assist', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Subscribers & Contacts
  getSubscribers: () => request<Subscriber[]>('/api/subscribers'),
  subscribe: (payload: { email: string; name?: string; role?: string }) =>
    request<{ ok: boolean }>('/api/subscribers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSubscriber: (
    id: number,
    payload: { email?: string; name?: string; role?: string }
  ) =>
    request<{ ok: boolean; id: number; email: string; name: string; role: string }>(
      `/api/subscribers/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteSubscriber: (id: number) =>
    request<{ ok: boolean }>(`/api/subscribers/${id}`, { method: 'DELETE' }),

  getContacts: () => request<ContactMessage[]>('/api/contacts'),
  sendContact: (payload: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }) =>
    request<{ ok: boolean }>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateContact: (id: number, payload: Partial<ContactMessage>) =>
    request<{ ok: boolean }>(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateContactStatus: (id: number, status: 'unread' | 'read') =>
    request<{ ok: boolean }>(`/api/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  markContactRead: (id: number) =>
    request<{ ok: boolean }>(`/api/contacts/${id}/read`, { method: 'PUT' }),
  deleteContact: (id: number) =>
    request<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),

  // Multi-Provider AI Engine Settings, Live Model Discovery & Live Connection Tester
  getAiSettings: () => request<AiEngineSettings>('/api/settings/ai'),
  saveAiSettings: (payload: Record<string, any>) =>
    request<AiEngineSettings & { ok: boolean }>('/api/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateAiSettings: (payload: Record<string, any>) =>
    request<AiEngineSettings & { ok: boolean }>('/api/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getLiveModels: (forceRefresh = false) =>
    request<UnifiedLiveModelsResponse>(
      `/api/ai/models${forceRefresh ? '?refresh=1' : ''}`
    ),
  discoverProviderModels: (payload: {
    provider: DiscoverableProvider;
    apiKey?: string;
    endpoint?: string;
    projectId?: string;
    vertexProjectId?: string;
    location?: string;
    vertexLocation?: string;
  }) =>
    request<ProviderLiveCatalog>('/api/ai/models/provider', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        projectId: payload.projectId || payload.vertexProjectId,
        location: payload.location || payload.vertexLocation,
      }),
    }),
  testAiProvider: (payload: {
    provider:
      | 'gemini'
      | 'claude'
      | 'deepseek'
      | 'openai'
      | 'openai_compatible'
      | 'vertex_veo'
      | 'elevenlabs';
    model?: string;
    apiKey?: string;
    vertexProjectId?: string;
    vertexLocation?: string;
  }) =>
    request<{
      ok: boolean;
      provider: string;
      model: string;
      engineLabel: string;
      latencyMs: number;
      sampleReply: string;
      detail?: string;
    }>('/api/settings/test-provider', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  testExtraService: (payload: {
    service: 'elevenlabs' | 'resend';
    apiKey?: string;
  }) =>
    request<{
      ok: boolean;
      latencyMs: number;
      detail: string;
    }>('/api/settings/test-extra', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Omnichannel Publish & Distribute (8 Channels)
  getChannels: () => request<ChannelConfig[]>('/api/channels'),
  testChannelConnection: (key: ChannelKey) =>
    request<{ ok: boolean; channelName?: string; mode?: string; detail: string }>(
      `/api/channels/${key}/test`,
      { method: 'POST' }
    ),
  updateChannel: (
    key: ChannelKey,
    payload: {
      handleOrUrl?: string;
      enabled?: boolean;
      autoPublishOnApprove?: boolean;
      accessToken?: string;
      targetId?: string;
      webhookUrl?: string;
    }
  ) =>
    request<{ ok: boolean }>(`/api/channels/${key}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getPublishLogs: () => request<PublishLog[]>('/api/publish/logs'),
  dispatchOmnichannel: (payload: {
    channels: ChannelKey[];
    title: string;
    content: string;
    category?: string;
    coverImage?: string;
    videoUrl?: string;
    audioUrl?: string;
    workflowId?: number | null;
    postId?: number | null;
    scheduledAt?: string | null;
  }) =>
    request<{ ok: boolean; postId: number | null; dispatched: any[] }>(
      '/api/publish/dispatch',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updatePublishLog: (id: number, payload: Partial<PublishLog>) =>
    request<{ ok: boolean }>(`/api/publish/logs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePublishLog: (id: number) =>
    request<{ ok: boolean }>(`/api/publish/logs/${id}`, { method: 'DELETE' }),

  // Audience Surveys & School Feedback
  getSurveys: () => request<AudienceSurvey[]>('/api/surveys'),
  createSurvey: (payload: {
    respondentName: string;
    respondentRole: string;
    schoolOrOrg?: string;
    preferredChannel?: string;
    requestedTopic: string;
    satisfactionScore: number;
    feedbackDetail?: string;
  }) =>
    request<{ id: number; ok: boolean }>('/api/surveys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitSurvey: (payload: {
    respondentName: string;
    respondentRole: string;
    schoolOrOrg?: string;
    preferredChannel?: string;
    requestedTopic: string;
    satisfactionScore: number;
    feedbackDetail?: string;
  }) =>
    request<{ id: number; ok: boolean }>('/api/surveys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSurvey: (id: number, payload: Partial<AudienceSurvey>) =>
    request<{ ok: boolean; id: number }>(`/api/surveys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteSurvey: (id: number) =>
    request<{ ok: boolean }>(`/api/surveys/${id}`, { method: 'DELETE' }),

  // Site Config & Domains (DB-Seeded Real-Time CMS)
  getSiteConfig: () => request<import('./types').SiteConfig>('/api/site-config'),
  updateSiteConfig: (payload: Partial<import('./types').SiteConfig>) =>
    request<import('./types').SiteConfig>('/api/site-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  checkDomainsStatus: () =>
    request<{
      primaryDomain: string;
      checkedAt: string;
      recommendedTargets: {
        vpsIp: string;
        vercelIp: string;
        vercelCname: string;
      };
      results: import('./types').DomainStatusItem[];
    }>('/api/domains/status'),

  getChannelConnectInfo: () =>
    request<{
      redirectUri: string;
      facebook: { hasApp: boolean; appId: string };
      tiktok: { hasApp: boolean; appId: string };
      status: Record<string, { key: string; connected: boolean; accountName: string; mode: string; lastVerifiedAt: string }>;
    }>('/api/channels/connect-info'),
  connectLine: (token: string) =>
    request<{ ok: boolean; accountName: string; detail: string }>('/api/channels/line_oa/connect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  connectFacebookManual: (pageId: string, token: string) =>
    request<{ ok: boolean; accountName: string }>('/api/channels/facebook/connect-manual', {
      method: 'POST',
      body: JSON.stringify({ pageId, token }),
    }),
  saveChannelApp: (key: 'facebook' | 'tiktok', appId: string, appSecret: string) =>
    request<{ ok: boolean; hasApp: boolean }>(`/api/channels/${key}/app`, {
      method: 'POST',
      body: JSON.stringify({ appId, appSecret }),
    }),
  startChannelOauth: (key: 'facebook' | 'tiktok') =>
    request<{ url: string }>(`/api/channels/${key}/oauth/start`, { method: 'POST' }),
  listFacebookPages: (nonce: string) =>
    request<{ pages: { id: string; name: string }[] }>(`/api/channels/facebook/pages?nonce=${encodeURIComponent(nonce)}`),
  chooseFacebookPage: (nonce: string, pageId: string) =>
    request<{ ok: boolean; accountName: string }>('/api/channels/facebook/choose-page', {
      method: 'POST',
      body: JSON.stringify({ nonce, pageId }),
    }),
  verifyChannel: (key: string) =>
    request<{ ok: boolean; accountName: string; detail: string }>(`/api/channels/${key}/verify`, { method: 'POST' }),
  disconnectChannel: (key: string) =>
    request<{ ok: boolean }>(`/api/channels/${key}/disconnect`, { method: 'POST' }),

  getSampleData: () => request<import('./types').SampleDataReport>('/api/admin/sample-data'),
  removeSampleData: () =>
    request<{ ok: boolean; removed: import('./types').SampleDataReport }>('/api/admin/sample-data/remove', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    }),

  // Content workspaces (CEO agent team)
  listWorkspaces: () =>
    request<{ workspaces: import('./types').WsListItem[]; capabilities: import('./types').WsCapabilities }>(
      '/api/workspaces'
    ),
  createWorkspace: (payload: { brief?: string; fromPostId?: number; fromWorkflowId?: number }) =>
    request<import('./types').WsSnapshot>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWorkspace: (id: number, after = 0) =>
    request<import('./types').WsSnapshot>(`/api/workspaces/${id}?after=${after}`),
  updateWorkspace: (
    id: number,
    payload: {
      brief?: string;
      draft?: Partial<import('./types').WsDraft>;
      media?: { cover?: string | null; video?: string | null; audio?: string | null };
    }
  ) =>
    request<import('./types').WsSnapshot>(`/api/workspaces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteWorkspace: (id: number) =>
    request<{ ok: boolean }>(`/api/workspaces/${id}`, { method: 'DELETE' }),
  sendWorkspaceMessage: (id: number, message: string, provider?: string) =>
    request<import('./types').WsSnapshot>(`/api/workspaces/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, provider }),
    }),
  publishWorkspace: (
    id: number,
    payload: { status?: 'draft' | 'published'; channels?: string[]; force?: boolean }
  ) =>
    request<import('./types').WsSnapshot>(`/api/workspaces/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  confirmWorkspaceAction: (id: number, eventId: number) =>
    request<import('./types').WsSnapshot & { ok: boolean; message: string }>(
      `/api/workspaces/${id}/confirm`,
      { method: 'POST', body: JSON.stringify({ eventId }) }
    ),

  // AI routing health (automatic failover) & Batch runs
  getAiHealth: () => request<import('./types').AiHealthResponse>('/api/ai/health'),
  resetAiHealth: (provider?: string) =>
    request<{ ok: boolean }>('/api/ai/health/reset', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
  saveAiRouting: (payload: {
    failoverEnabled?: boolean;
    fallbackOrder?: string[];
    economyOrder?: string[];
  }) =>
    request<{ failoverEnabled: boolean; fallbackOrder: string[]; economyOrder: string[] }>(
      '/api/ai/routing',
      { method: 'PUT', body: JSON.stringify(payload) }
    ),
  listAiBatches: () =>
    request<{
      maxItems: number;
      backgroundCapable: boolean;
      batches: import('./types').AiBatchSummary[];
    }>('/api/ai/batches'),
  createAiBatch: (payload: {
    name?: string;
    topics: string[];
    mode: 'economy' | 'standard';
    category?: string;
    targetAudience?: string;
    businessPillar?: string;
    inputSource?: string;
    flowMode?: 'core_3agent' | 'full_8agent';
  }) =>
    request<import('./types').AiBatchSummary>('/api/ai/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAiBatch: (id: number) => request<import('./types').AiBatchSummary>(`/api/ai/batches/${id}`),
  processAiBatch: (id: number) =>
    request<import('./types').AiBatchSummary>(`/api/ai/batches/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  cancelAiBatch: (id: number) =>
    request<import('./types').AiBatchSummary>(`/api/ai/batches/${id}/cancel`, { method: 'POST' }),
  retryFailedAiBatch: (id: number) =>
    request<import('./types').AiBatchSummary>(`/api/ai/batches/${id}/retry-failed`, {
      method: 'POST',
    }),

  // Special Projects Real-Time CRUD
  getSpecialProjects: () => request<import('./types').SpecialProject[]>('/api/projects'),
  createSpecialProject: (payload: Partial<import('./types').SpecialProject>) =>
    request<import('./types').SpecialProject>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSpecialProject: (id: number, payload: Partial<import('./types').SpecialProject>) =>
    request<import('./types').SpecialProject>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteSpecialProject: (id: number) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
};

export function formatThaiDate(iso: string): string {
  try {
    const d = new Date(iso);
    const months = [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];
    const day = d.getDate();
    const month = months[d.getMonth()] || '';
    const buddhistYear = d.getFullYear() + 543;
    return `${day} ${month} ${buddhistYear}`;
  } catch {
    return iso;
  }
}

export function formatViews(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return n.toLocaleString();
}
