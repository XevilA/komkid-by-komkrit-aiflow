export type CategoryId =
  | 'education'
  | 'innovation'
  | 'society'
  | 'international'
  | 'career'
  | 'ai-tech'
  | 'special';

export type ContentType = 'article' | 'news' | 'video' | 'course';

export type PostStatus = 'published' | 'draft' | 'pending_approval';

export type LlmProviderId =
  | 'auto'
  | 'gemini'
  | 'claude'
  | 'deepseek'
  | 'openai'
  | 'openai_compatible';

export interface CategoryMeta {
  id: CategoryId;
  nameTh: string;
  nameEn: string;
  badgeLabel: string;
  color: string;
  bgLight: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'education',
    nameTh: 'การศึกษา',
    nameEn: 'Education',
    badgeLabel: 'การศึกษา',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'innovation',
    nameTh: 'นวัตกรรม',
    nameEn: 'Innovation',
    badgeLabel: 'นวัตกรรม',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'society',
    nameTh: 'สังคม',
    nameEn: 'Society',
    badgeLabel: 'สังคม',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'international',
    nameTh: 'ต่างประเทศ',
    nameEn: 'International',
    badgeLabel: 'ต่างประเทศ',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'career',
    nameTh: 'อาชีพ & การพัฒนา',
    nameEn: 'Career & Lifelong Learning',
    badgeLabel: 'อาชีพ & การพัฒนา',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'ai-tech',
    nameTh: 'AI & เทคโนโลยี',
    nameEn: 'AI & Technology',
    badgeLabel: 'AI & การศึกษา',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
  {
    id: 'special',
    nameTh: 'บทความพิเศษ',
    nameEn: 'Special View',
    badgeLabel: 'บทความพิเศษ',
    color: '#1e293b',
    bgLight: '#f1f5f9',
  },
];

export const INPUT_SOURCES = [
  { id: 'trend', label: 'แนวโน้มการศึกษา (Trend & Research)' },
  { id: 'curriculum', label: 'หลักสูตร/มาตรฐาน (SON, OPEC, สพฐ. ฯลฯ)' },
  { id: 'learner_pain', label: 'ปัญหา/ความต้องการของผู้เรียน/ครู/โรงเรียน' },
  { id: 'social_feedback', label: 'ข้อมูลจากผู้ติดตาม (สังคมออนไลน์ / สื่อ)' },
  { id: 'news_research', label: 'ข่าวสาร / งานวิจัย' },
  { id: 'komkrit_idea', label: 'ไอเดียจาก Komkrit' },
];

export interface Post {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  category: CategoryId;
  contentType: ContentType;
  coverImage: string;
  videoUrl?: string;
  audioUrl?: string;
  tags: string[];
  author: string;
  status: PostStatus;
  isFeatured: boolean;
  views: number;
  commentsCount: number;
  aiWorkflowId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostComment {
  id: number;
  postId: number;
  postTitle?: string;
  authorName: string;
  authorRole: string;
  message: string;
  rating: number;
  createdAt: string;
}

export interface KnowledgeItem {
  id: number;
  title: string;
  category:
    | 'policy'
    | 'research'
    | 'komkrit_vision'
    | 'regulation'
    | 'brand_guideline';
  summary: string;
  content: string;
  sourceRef: string;
  isActive: boolean;
  createdAt: string;
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

export interface BusinessPillarItem {
  id: number;
  pillarIndex: number;
  pillarNumber?: number;
  pillarKey: string;
  title: string;
  subtitle: string;
  nameTh?: string;
  nameEn?: string;
  description: string;
  metricLabel: string;
  metricValue: string;
  targetKpi?: string;
  currentProgress?: number;
  leadAgent?: string;
  status?: 'active' | 'scaling' | 'pilot' | string;
  statusBadge?: string;
  actionUrl?: string;
}

export interface CeoOutput {
  goal: string;
  strategy: string;
  keyMessage: string;
  kpiTargets: string[];
  agentAssignments: { agent: string; mission: string }[];
}

export interface ResearchOutput {
  deepInsights: string[];
  keyFacts: string[];
  trendAnalysis: string;
  references: string[];
  kbSourcesUsed: string[];
}

export interface ScriptOutput {
  titleSuggestions: string[];
  headlines?: string[];
  selectedTitle: string;
  subtitle: string;
  excerpt: string;
  learningObjectives: string[];
  fullArticleMarkdown: string;
  videoScript: string;
  socialHook: string;
  hook?: string;
}

export interface DesignOutput {
  contentStructure: string[];
  brandTone: string;
  mindMapNodes: { center: string; branches: { title: string; items: string[] }[] };
  slideDeckOutline: { slide: number; title: string; bullet: string }[];
  instructionalDesign: string;
}

export interface VisualOutput {
  imagePrompts: { platform: string; prompt: string }[];
  infographicHeadline: string;
  infographicSubpoints: string[];
  generatedSvgDataUrl: string;
  generatedRealImageUrl?: string;
  suggestedCoverImage?: string;
  recommendedTools: string[];
}

export interface VideoOutput {
  duration: string;
  avatarStyle: string;
  scenes: {
    time: string;
    visual: string;
    dialogue: string;
    subtitle: string;
    bRoll: string;
  }[];
  generatedVideoUrl?: string;
  generatedVideoModel?: string;
  interactionId?: string;
  recommendedTools: string[];
}

export interface AudioOutput {
  voiceTone: string;
  narrationScriptWithCues: string;
  bgmStyle: string;
  soundEffects: string[];
  generatedAudioUrl?: string;
  generatedAudioModel?: string;
  recommendedTools: string[];
}

export interface QaOutput {
  factCheckScore: number;
  factCheckNote: string;
  languageScore: number;
  languageNote: string;
  brandScore: number;
  brandNote: string;
  riskScore: number;
  riskNote: string;
  overallScore: number;
  verdict: 'ผ่าน' | 'แก้ไข' | 'ไม่ผ่าน';
  improvements: string[];
}

export interface AnalyticsOutput {
  predictedReach: string;
  predictedEngagement: string;
  targetLearnerFit: string;
  abHeadlines: string[];
  optimizationTips: string[];
}

export interface OmnichannelOutput {
  youtube: { title: string; description: string; tags: string[] };
  facebook: { post: string; engagementQuestion: string };
  tiktok: { hook: string; caption: string; hashtags: string[] };
  lineOa: { headline: string; broadcastMessage: string };
  xTwitter: { thread: string[] };
  instagram: { carouselSlides: string[]; caption: string };
  websiteBlog: { slug: string; seoMeta: string };
  emailNewsletter: { subject: string; previewText: string; bodyIntro: string };
  publishedChannels: string[];
}

export interface HumanApprovalState {
  isAccurate: boolean;
  isAppropriate: boolean;
  isOnBrand: boolean;
  isReady: boolean;
  reviewerNote: string;
  approvedAt?: string;
  publishedPostId?: number | null;
}

export interface AiWorkflow {
  id: number;
  topic: string;
  inputSource: string;
  category: CategoryId;
  targetAudience: string;
  businessPillar: string;
  flowMode: 'core_3agent' | 'core_3agent' | 'full_8agent';
  engineUsed: string;
  status:
    | 'drafting'
    | 'pending_approval'
    | 'revision_requested'
    | 'approved'
    | 'published'
    | 'rejected';
  ceoOutput: CeoOutput;
  researchOutput: ResearchOutput;
  scriptOutput: ScriptOutput;
  designOutput: DesignOutput;
  visualOutput: VisualOutput;
  videoOutput: VideoOutput;
  audioOutput: AudioOutput;
  qaOutput: QaOutput;
  analyticsOutput: AnalyticsOutput;
  omnichannelOutput: OmnichannelOutput;
  publishingOutput?: any;
  humanApproval: HumanApprovalState;
  createdAt: string;
  updatedAt: string;
}

export interface Subscriber {
  id: number;
  email: string;
  name: string;
  role: string;
  interestTopic?: string;
  createdAt: string;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  status: 'unread' | 'read';
  createdAt: string;
}

export type DiscoverableProvider =
  | 'gemini'
  | 'claude'
  | 'deepseek'
  | 'openai'
  | 'vertex_veo'
  | 'elevenlabs'
  | 'openai_compatible';

export interface LiveModelOption {
  id: string;
  label: string;
  provider?: string;
  capability?: string;
  createdAt?: string | number;
  supportedMethods?: string[];
}

export interface ProviderLiveCatalog {
  provider?: DiscoverableProvider;
  connected?: boolean;
  ok?: boolean;
  fetchedAt?: string;
  error?: string;
  textModels: LiveModelOption[];
  imageModels?: LiveModelOption[];
  videoModels?: LiveModelOption[];
  ttsModels?: LiveModelOption[];
  voices?: LiveModelOption[];
}

export interface UnifiedLiveModelsResponse {
  fetchedAt: string;
  providers: Record<DiscoverableProvider, ProviderLiveCatalog>;
}

export interface AiEngineSettings {
  provider: LlmProviderId;
  encryptedAtRest?: boolean;
  encryptionStandard?: string;
  sealedVault?: string;
  vaultUpdatedAt?: number;
  // Google Gemini + Media
  geminiModel: string;
  geminiImageModel: string;
  imageModel?: string;
  geminiVideoModel: string;
  veoModel?: string;
  geminiTtsModel?: string;
  hasGeminiKey: boolean;
  geminiKeyMasked: string;
  // Anthropic Claude
  claudeModel: string;
  hasClaudeKey: boolean;
  claudeKeyMasked: string;
  // DeepSeek
  deepseekModel: string;
  hasDeepseekKey: boolean;
  deepseekKeyMasked: string;
  // OpenAI ChatGPT
  openaiModel: string;
  hasOpenaiKey: boolean;
  openaiKeyMasked: string;
  // Google Cloud Vertex AI Veo Enterprise
  vertexProjectId: string;
  vertexLocation: string;
  vertexVeoModel: string;
  hasVertexToken: boolean;
  vertexTokenMasked: string;
  // ElevenLabs & Resend
  hasElevenlabsKey: boolean;
  elevenlabsKeyMasked: string;
  elevenlabsModel?: string;
  elevenlabsVoiceId: string;
  hasResendKey: boolean;
  resendKeyMasked: string;
  resendFromEmail: string;
  // Local / Custom OpenAI-compatible Server
  localEndpoint: string;
  localModel: string;
  hasLocalKey: boolean;
}

export interface AiChatSession {
  sessionId: string;
  title: string;
  lastMessage: string;
  messageCount: number;
  provider: string;
  updatedAt: string;
}

export interface AiEvaluatedPrompt {
  target: 'image' | 'video';
  assessmentThai: string;
  visualSummaryThai: string;
  thaiSummary?: string;
  fullPrompt: string;
  recommendedAspectRatio: '16:9' | '9:16' | '1:1';
  suggestedPostTitle: string;
  engineUsed: string;
}

export interface AiDraftFromChat {
  title: string;
  subtitle: string;
  excerpt: string;
  category: CategoryId;
  contentType: ContentType;
  content: string;
  tags: string[];
  suggestedImagePrompt: string;
  engineUsed: string;
}

export interface AiChatMessage {
  id: number;
  sessionId: string;
  provider: Exclude<LlmProviderId, 'auto'>;
  model: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface AiMediaAsset {
  id: number;
  mediaType: 'image' | 'video' | 'audio';
  provider: string;
  model: string;
  engine?: string;
  prompt: string;
  fileUrl: string;
  mimeType: string;
  aspectRatio?: string;
  durationSec?: number;
  resolution?: string;
  interactionId?: string;
  workflowId?: number | null;
  reviewStatus?: 'pending_review' | 'approved';
  thaiSummary?: string;
  createdAt: string;
}

export interface FlowScene {
  id: string;
  sceneNumber: number;
  title: string;
  durationSec: number;
  firstFramePrompt: string;
  lastFramePrompt: string;
  videoMotionPrompt: string;
  narrationThai: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  videoClipUrl: string;
  interactionId: string;
}

export interface FlowProject {
  id: number;
  title: string;
  concept: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '360p' | '720p' | '1080p' | '4k';
  videoEngine: string;
  scenes: FlowScene[];
  masterVideoUrl: string;
  voiceoverAudioUrl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type ChannelKey =
  | 'youtube'
  | 'facebook'
  | 'tiktok'
  | 'line_oa'
  | 'x_twitter'
  | 'instagram'
  | 'website_blog'
  | 'email_newsletter';

export interface ChannelConfig {
  id: number;
  channelKey: ChannelKey;
  channelName: string;
  handleOrUrl: string;
  enabled: boolean;
  autoPublishOnApprove: boolean;
  hasAccessToken: boolean;
  accessTokenMasked: string;
  targetId: string;
  webhookUrl: string;
  updatedAt: string;
}

export interface PublishLog {
  id: number;
  workflowId?: number | null;
  postId?: number | null;
  channelKey: ChannelKey;
  channelName: string;
  title: string;
  contentPreview: string;
  contentSnippet?: string;
  mode: 'live_api' | 'webhook' | 'internal_live' | 'unconfigured';
  status: 'published' | 'scheduled' | 'failed';
  scheduledAt?: string | null;
  externalUrl?: string;
  publishedUrl?: string;
  responseNote: string;
  errorDetail?: string;
  createdAt: string;
}

export interface AudienceSurvey {
  id: number;
  respondentName: string;
  respondentRole: string;
  schoolOrOrg: string;
  preferredChannel: string;
  requestedTopic: string;
  satisfactionScore: number;
  feedbackDetail: string;
  createdAt: string;
}

export interface SiteConfig {
  brandTitle: string;
  brandSub: string;
  slogan: string;
  heroSubtitle: string;
  heroQuote: string;
  heroSignature: string;
  heroImageUrl: string;
  authorName: string;
  authorRole: string;
  authorBio: string;
  authorQuote: string;
  authorImageUrl: string;
  aboutVision: string;
  aboutStory: string;
  featuredVideoUrl: string;
  featuredVideoTitle: string;
  featuredVideoDesc: string;
  contactEmail: string;
  contactLocation: string;
  socialX: string;
  socialYoutube: string;
  socialFacebook: string;
  socialInstagram: string;
  socialLineOa: string;
  primaryDomain: string;
  domains: string[];
  seoTitle: string;
  seoDescription: string;
  updatedAt?: string;
}

export interface SpecialProject {
  id: number;
  badgeLabel: string;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
  tags: string[];
  ctaLabel: string;
  ctaUrl: string;
  status: 'active' | 'draft' | 'archived';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DomainStatusItem {
  domain: string;
  isPrimary: boolean;
  resolvedIps: string[];
  cnames: string[];
  dnsConnected: boolean;
  target: 'vps' | 'vercel' | 'other' | 'none';
  httpsReachable: boolean;
  httpStatus: number | null;
  checkedAt: string;
}

export type AiProviderState = 'ok' | 'degraded' | 'cooldown' | 'unconfigured';

export interface AiProviderHealth {
  id: string;
  label: string;
  configured: boolean;
  state: AiProviderState;
  cooldownRemainingSec: number;
  consecutiveFailures: number;
  lastError: string;
  lastErrorKind: string;
  lastErrorAt: string | null;
  lastOkAt: string | null;
}

export interface AiHealthResponse {
  failoverEnabled: boolean;
  fallbackOrder: string[];
  economyOrder: string[];
  providers: AiProviderHealth[];
  last24h: {
    calls: number;
    failures: number;
    failovers: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
  recentEvents: {
    created_at: string;
    provider: string;
    model: string;
    tier: string;
    ok: number;
    error: string;
    error_kind: string;
    failed_over_from: string;
  }[];
}

export type AiBatchStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled';

export interface AiBatchItem {
  id: number;
  idx: number;
  topic: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  workflowId: number | null;
  error: string;
  provider: string;
  model: string;
  tier: string;
  cacheHit: boolean;
  failedOver: boolean;
}

export interface AiBatchSummary {
  id: number;
  name: string;
  status: AiBatchStatus;
  mode: 'economy' | 'standard';
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  cancelled: number;
  duplicatesRemoved?: number;
  stats: {
    cacheHits: number;
    failedOver: number;
    escalatedToStandard: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cachedInputPercent: number;
    byProvider: Record<string, number>;
  };
  items?: AiBatchItem[];
}

// ---- Content workspaces (shared state of the CEO agent team) ----
export interface WsDraft {
  title: string;
  subtitle: string;
  excerpt: string;
  content: string;
  category: CategoryId;
  contentType: 'news' | 'article' | 'video' | 'course';
  tags: string[];
  slug: string;
  suggestedImagePrompt?: string;
  suggestedVideoPrompt?: string;
}

export interface WsMediaItem {
  url: string;
  assetId?: number | null;
  prompt?: string;
  caption?: string;
}

export interface WsQa {
  verdict?: 'pass' | 'revise' | 'block';
  scores?: { facts: number; language: number; brand: number; risk: number; overall: number };
  issues?: { severity: 'high' | 'medium' | 'low'; text: string }[];
  summary?: string;
  checkedAt?: string;
}

export interface Workspace {
  id: number;
  title: string;
  brief: string;
  status: 'drafting' | 'ready' | 'published' | 'archived';
  postId: number | null;
  workflowId: number | null;
  draft: WsDraft;
  media: { cover?: WsMediaItem; video?: WsMediaItem; audio?: WsMediaItem; subtitles?: WsMediaItem; clips?: WsMediaItem[]; inline: WsMediaItem[] };
  research: {
    query?: string;
    summary?: string;
    facts?: string[];
    angles?: string[];
    sources?: { title: string; uri: string }[];
    subQueries?: string[];
    knowledgeUsed?: string[];
    relatedPosts?: { id: number; title: string; slug: string }[];
  };
  qa: WsQa;
  factCheck: {
    claims?: { text: string; verdict: 'supported' | 'unsupported' | 'unverifiable'; evidence: string }[];
    neutrality?: { score: number; notes: string };
    verdict?: 'pass' | 'revise' | 'block';
    summary?: string;
  };
  videoPlan: { clips: { title: string; durationSec: number; narration: string; visualPrompt: string; subtitle: string }[] };
  learning: { summary?: string; whatWorked?: string[]; toImprove?: string[]; nextTopics?: string[]; metrics?: Record<string, unknown> };
  approvals: { article?: { hash: string; at: string }; release?: { at: string } };
  channels: { results?: Record<string, { status: string; url: string; note: string; at: string }> };
  createdAt: string;
  updatedAt: string;
}

export interface WsEvent {
  id: number;
  projectId: number;
  createdAt: string;
  role: 'user' | 'ceo' | 'agent' | 'system';
  agent: string;
  kind: 'message' | 'action' | 'result' | 'error' | 'confirm';
  content: string;
  data: any;
}

export interface WsFlowStep {
  n: number;
  id: string;
  label: string;
  status: 'done' | 'current' | 'todo' | 'optional';
  detail: string;
}

export interface WsSnapshot {
  project: Workspace;
  flow: WsFlowStep[];
  events: WsEvent[];
  running: boolean;
}

export interface WsListItem {
  id: number;
  title: string;
  brief: string;
  status: Workspace['status'];
  postId: number | null;
  updatedAt: string;
  hasCover: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  wordCount: number;
}

export interface WsCapabilities {
  llm: boolean;
  image: boolean;
  video: boolean;
  audio: boolean;
  webSearch: boolean;
  channels: { key: string; name: string }[];
  serverless: boolean;
}

export interface SampleDataReport {
  posts: { id: number; title: string; views: number }[];
  comments: number;
  knowledge: number;
  subscribers: number;
  surveys: number;
  campaigns: number;
  publishLogs: number;
  pillarsWithInventedMetrics: number;
  channelsWithExampleHandles: number;
  total: number;
}
