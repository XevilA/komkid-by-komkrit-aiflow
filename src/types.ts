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
    color: '#102a4c',
    bgLight: '#e8eff7',
  },
  {
    id: 'innovation',
    nameTh: 'นวัตกรรม',
    nameEn: 'Innovation',
    badgeLabel: 'นวัตกรรม',
    color: '#f59e0b',
    bgLight: '#fef3c7',
  },
  {
    id: 'society',
    nameTh: 'สังคม',
    nameEn: 'Society',
    badgeLabel: 'สังคม',
    color: '#3ca34b',
    bgLight: '#dcfce7',
  },
  {
    id: 'international',
    nameTh: 'ต่างประเทศ',
    nameEn: 'International',
    badgeLabel: 'ต่างประเทศ',
    color: '#0284c7',
    bgLight: '#e0f2fe',
  },
  {
    id: 'career',
    nameTh: 'อาชีพ & การพัฒนา',
    nameEn: 'Career & Lifelong Learning',
    badgeLabel: 'อาชีพ & การพัฒนา',
    color: '#6d28d9',
    bgLight: '#ede9fe',
  },
  {
    id: 'ai-tech',
    nameTh: 'AI & เทคโนโลยี',
    nameEn: 'AI & Technology',
    badgeLabel: 'AI & การศึกษา',
    color: '#0d9488',
    bgLight: '#ccfbf1',
  },
  {
    id: 'special',
    nameTh: 'บทความพิเศษ',
    nameEn: 'Special View',
    badgeLabel: 'บทความพิเศษ',
    color: '#eab308',
    bgLight: '#fef9c3',
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

export interface BusinessPillarItem {
  id: number;
  pillarIndex: 1 | 2 | 3 | 4 | 5;
  pillarKey: 'views' | 'products' | 'sponsors' | 'business' | 'community';
  title: string;
  subtitle: string;
  description: string;
  metricLabel: string;
  metricValue: string;
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
  selectedTitle: string;
  subtitle: string;
  excerpt: string;
  learningObjectives: string[];
  fullArticleMarkdown: string;
  videoScript: string;
  socialHook: string;
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
  humanApproval: HumanApprovalState;
  createdAt: string;
  updatedAt: string;
}

export interface Subscriber {
  id: number;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'unread' | 'read';
  createdAt: string;
}

export interface AiEngineSettings {
  provider: LlmProviderId;
  // Google Gemini + Media
  geminiModel: string;
  geminiImageModel: string;
  geminiVideoModel: string;
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
  elevenlabsVoiceId: string;
  hasResendKey: boolean;
  resendKeyMasked: string;
  resendFromEmail: string;
  // Local / Custom OpenAI-compatible Server
  localEndpoint: string;
  localModel: string;
  hasLocalKey: boolean;
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
  prompt: string;
  fileUrl: string;
  mimeType: string;
  aspectRatio?: string;
  durationSec?: number;
  resolution?: string;
  interactionId?: string;
  workflowId?: number | null;
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
  videoEngine:
    | 'gemini-omni-1.1-flash'
    | 'veo-3.1-generate-001'
    | 'veo-3.1-fast-generate-001'
    | 'veo-3.0-generate-001';
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
  mode: 'live_api' | 'webhook' | 'internal_live' | 'unconfigured';
  status: 'published' | 'scheduled' | 'failed';
  scheduledAt?: string | null;
  externalUrl?: string;
  responseNote: string;
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
