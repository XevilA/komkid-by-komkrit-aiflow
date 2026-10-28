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
  AiMediaAsset,
  FlowProject,
  ChannelConfig,
  PublishLog,
  AudienceSurvey,
  ChannelKey,
  LlmProviderId,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
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
  deletePost: (id: number) =>
    request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),

  uploadFile: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'อัปโหลดไฟล์ไม่สำเร็จ');
    return data.url as string;
  },
  uploadImage: async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
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
  updatePillar: (id: number, payload: Partial<BusinessPillarItem>) =>
    request<{ ok: boolean }>(`/api/pillars/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Real Multi-LLM Interactive Chat (Claude, DeepSeek, ChatGPT, Gemini)
  getChatHistory: (sessionId: string) =>
    request<AiChatMessage[]>(`/api/ai/chat/${encodeURIComponent(sessionId)}`),
  sendChatMessage: (payload: {
    sessionId: string;
    provider: Exclude<LlmProviderId, 'auto'>;
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

  // Real Media Generation (Nano Banana 2.1, Google Veo / Omni Video, Gemini 3.8 TTS)
  getMediaAssets: (type?: 'image' | 'video' | 'audio') =>
    request<AiMediaAsset[]>(`/api/ai/media${type ? `?type=${type}` : ''}`),
  deleteMediaAsset: (id: number) =>
    request<{ ok: boolean }>(`/api/ai/media/${id}`, { method: 'DELETE' }),
  generateRealImage: (payload: {
    prompt: string;
    provider?: 'gemini' | 'openai';
    model?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3';
    imageSize?: '1K' | '2K';
    workflowId?: number | null;
  }) =>
    request<AiMediaAsset>('/api/ai/image/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateRealVideo: (payload: {
    prompt: string;
    engine?:
      | 'gemini-omni-1.1-flash'
      | 'veo-3.1-generate-001'
      | 'veo-3.1-fast-generate-001'
      | 'veo-3.0-generate-001';
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
  }) =>
    request<AiMediaAsset>('/api/ai/video/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateRealAudio: (payload: {
    text: string;
    provider?: 'gemini' | 'openai' | 'elevenlabs';
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
  markContactRead: (id: number) =>
    request<{ ok: boolean }>(`/api/contacts/${id}/read`, { method: 'PUT' }),
  deleteContact: (id: number) =>
    request<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),

  // Multi-Provider AI Engine Settings & Live Connection Tester
  getAiSettings: () => request<AiEngineSettings>('/api/settings/ai'),
  saveAiSettings: (payload: Record<string, any>) =>
    request<{ ok: boolean }>('/api/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  testAiProvider: (payload: {
    provider: 'gemini' | 'claude' | 'deepseek' | 'openai' | 'openai_compatible';
    model?: string;
    apiKey?: string;
  }) =>
    request<{
      ok: boolean;
      provider: string;
      model: string;
      engineLabel: string;
      latencyMs: number;
      sampleReply: string;
    }>('/api/settings/test-provider', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Omnichannel Publish & Distribute (8 Channels)
  getChannels: () => request<ChannelConfig[]>('/api/channels'),
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
  deletePublishLog: (id: number) =>
    request<{ ok: boolean }>(`/api/publish/logs/${id}`, { method: 'DELETE' }),

  // Audience Surveys & School Feedback
  getSurveys: () => request<AudienceSurvey[]>('/api/surveys'),
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
  deleteSurvey: (id: number) =>
    request<{ ok: boolean }>(`/api/surveys/${id}`, { method: 'DELETE' }),
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
