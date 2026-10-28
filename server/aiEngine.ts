import { GoogleGenAI } from '@google/genai';
import { db } from './db.ts';
import { generateRealImage, getSettingValue } from './mediaEngine.ts';

export type LlmProviderId =
  | 'auto'
  | 'gemini'
  | 'claude'
  | 'deepseek'
  | 'openai'
  | 'openai_compatible';

export interface RunWorkflowInput {
  topic: string;
  inputSource: string;
  category: string;
  targetAudience: string;
  businessPillar: string;
  flowMode: 'core_3agent' | 'full_8agent';
  provider?: LlmProviderId;
  model?: string;
  autoGenerateCoverImage?: boolean;
  revisionNote?: string;
}

export interface ChatTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCallResult {
  text: string;
  reasoning?: string;
  provider: Exclude<LlmProviderId, 'auto'>;
  model: string;
  engineLabel: string;
  latencyMs: number;
}

export function getProviderConfigs() {
  const geminiKey =
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') ||
    getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');
  const claudeKey = getSettingValue('claude_api_key', 'ANTHROPIC_API_KEY');
  const deepseekKey = getSettingValue('deepseek_api_key', 'DEEPSEEK_API_KEY');
  const openaiKey = getSettingValue('openai_api_key', 'OPENAI_API_KEY');
  const elevenlabsKey = getSettingValue('elevenlabs_api_key', 'ELEVENLABS_API_KEY');
  const resendKey = getSettingValue('resend_api_key', 'RESEND_API_KEY');

  return {
    defaultProvider: (getSettingValue('ai_provider') || 'auto') as LlmProviderId,
    gemini: {
      apiKey: geminiKey,
      model: getSettingValue('gemini_model') || 'gemini-3.8-flash',
      imageModel: getSettingValue('gemini_image_model') || 'gemini-nano-banana-2.1',
      videoModel: getSettingValue('gemini_video_model') || 'gemini-omni-1.1-flash',
      ttsModel: 'gemini-3.8-flash-tts',
    },
    claude: {
      apiKey: claudeKey,
      model: getSettingValue('claude_model') || 'claude-sonnet-4-20250514',
    },
    deepseek: {
      apiKey: deepseekKey,
      model: getSettingValue('deepseek_model') || 'deepseek-chat',
    },
    openai: {
      apiKey: openaiKey,
      model: getSettingValue('openai_model') || 'gpt-4.1',
    },
    localOpenAi: {
      endpoint: getSettingValue('local_endpoint') || 'http://localhost:1234/v1',
      model: getSettingValue('local_model') || 'omni-o1x-pro',
      apiKey: getSettingValue('local_api_key') || '',
    },
    vertexVeo: {
      projectId: getSettingValue('vertex_project_id', 'GOOGLE_CLOUD_PROJECT'),
      location: getSettingValue('vertex_location', 'GOOGLE_CLOUD_LOCATION') || 'us-central1',
      accessToken: getSettingValue('vertex_access_token', 'GOOGLE_OAUTH_ACCESS_TOKEN'),
      veoModel: getSettingValue('vertex_veo_model') || 'veo-3.1-generate-001',
    },
    elevenlabs: {
      apiKey: elevenlabsKey,
      voiceId: getSettingValue('elevenlabs_voice_id') || 'JBFqnCBsd6RMkjVDRZzb',
    },
    resend: {
      apiKey: resendKey,
      fromEmail: getSettingValue('resend_from_email') || 'onboarding@resend.dev',
    },
  };
}

function resolveActiveProvider(requested?: LlmProviderId): Exclude<LlmProviderId, 'auto'> {
  const cfg = getProviderConfigs();
  const target = requested || cfg.defaultProvider || 'auto';

  if (target !== 'auto') {
    return target;
  }

  // Strictly pick a real configured API provider — ZERO MOCKUPS!
  if (cfg.gemini.apiKey) return 'gemini';
  if (cfg.claude.apiKey) return 'claude';
  if (cfg.openai.apiKey) return 'openai';
  if (cfg.deepseek.apiKey) return 'deepseek';

  throw new Error(
    'ยังไม่ได้ตั้งค่า API Key จริงสำหรับ AI (รองรับ Google Gemini, Anthropic Claude, DeepSeek และ OpenAI ChatGPT) — กรุณาไปที่เมนู "ตั้งค่า API Keys & Providers" เพื่อบันทึกคีย์จริงก่อนใช้งาน (ระบบปิดโหมด Mockup 100%)'
  );
}

export function getActiveKnowledgeContext(topic: string) {
  const rows = db
    .prepare(
      'SELECT title, category, summary, content, source_ref FROM knowledge_base WHERE is_active = 1 ORDER BY id ASC'
    )
    .all() as {
    title: string;
    category: string;
    summary: string;
    content: string;
    source_ref: string;
  }[];

  const lower = topic.toLowerCase();
  const scored = rows.map((r) => {
    let score = r.category === 'brand_guideline' ? 10 : 1;
    const words = lower.split(/\s+/).filter((w) => w.length > 1);
    for (const w of words) {
      if (
        r.title.toLowerCase().includes(w) ||
        r.summary.toLowerCase().includes(w) ||
        r.content.toLowerCase().includes(w)
      ) {
        score += 4;
      }
    }
    return { ...r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6);
}

// ============================================================================
// CORE REAL MULTI-PROVIDER LLM EXECUTION (GEMINI, CLAUDE, DEEPSEEK, CHATGPT)
// ============================================================================
export async function callRealLlm(params: {
  provider?: LlmProviderId;
  model?: string;
  apiKeyOverride?: string;
  systemInstruction?: string;
  messages: ChatTurnMessage[];
  temperature?: number;
  jsonMode?: boolean;
}): Promise<LlmCallResult> {
  const cfg = getProviderConfigs();
  const provider =
    params.provider && params.provider !== 'auto'
      ? params.provider
      : resolveActiveProvider(params.provider);

  const startedAt = Date.now();

  // 1. GOOGLE GEMINI (@google/genai Official Interactions API)
  if (provider === 'gemini') {
    const apiKey = params.apiKeyOverride?.trim() || cfg.gemini.apiKey;
    if (!apiKey) {
      throw new Error(
        'ยังไม่ได้ใส่ Google Gemini API Key — กรุณาตั้งค่าในหน้า "ตั้งค่า API Keys & Providers"'
      );
    }
    const model = params.model?.trim() || cfg.gemini.model || 'gemini-3.8-flash';
    const ai = new GoogleGenAI({ apiKey });

    // Format multi-turn conversation input for Interactions API
    const inputPayload =
      params.messages.length === 1 && params.messages[0].role === 'user'
        ? params.messages[0].content
        : params.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            content: m.content,
          }));

    const createReq: Record<string, any> = {
      model,
      input: inputPayload,
    };
    if (params.systemInstruction) {
      createReq.system_instruction = params.systemInstruction;
    }
    if (typeof params.temperature === 'number') {
      createReq.generation_config = { temperature: params.temperature };
    }

    const interaction = await ai.interactions.create(createReq as any);
    const text = (interaction.output_text || '').trim();
    if (!text) {
      throw new Error(`Google Gemini (${model}) ตอบกลับเป็นค่าว่าง`);
    }

    return {
      text,
      provider: 'gemini',
      model,
      engineLabel: `Google Gemini (${model})`,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 2. ANTHROPIC CLAUDE (Official Messages API v1)
  if (provider === 'claude') {
    const apiKey = params.apiKeyOverride?.trim() || cfg.claude.apiKey;
    if (!apiKey) {
      throw new Error(
        'ยังไม่ได้ใส่ Anthropic Claude API Key — กรุณาตั้งค่าในหน้า "ตั้งค่า API Keys & Providers"'
      );
    }
    const model = params.model?.trim() || cfg.claude.model || 'claude-sonnet-4-20250514';

    const body: Record<string, any> = {
      model,
      max_tokens: 8192,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (params.systemInstruction) {
      body.system = params.systemInstruction;
    }
    if (typeof params.temperature === 'number') {
      body.temperature = params.temperature;
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `Anthropic Claude API Error (HTTP ${resp.status})`
      );
    }

    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
    const thinking = blocks
      .filter((b: any) => b.type === 'thinking')
      .map((b: any) => b.thinking)
      .join('\n')
      .trim();

    if (!text) {
      throw new Error(`Anthropic Claude (${model}) ไม่ได้ส่งข้อความตอบกลับ`);
    }

    return {
      text,
      reasoning: thinking || undefined,
      provider: 'claude',
      model,
      engineLabel: `Anthropic Claude (${model})`,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 3. DEEPSEEK (Official DeepSeek V3 / R1 API)
  if (provider === 'deepseek') {
    const apiKey = params.apiKeyOverride?.trim() || cfg.deepseek.apiKey;
    if (!apiKey) {
      throw new Error(
        'ยังไม่ได้ใส่ DeepSeek API Key — กรุณาตั้งค่าในหน้า "ตั้งค่า API Keys & Providers"'
      );
    }
    const model = params.model?.trim() || cfg.deepseek.model || 'deepseek-chat';

    const apiMessages: any[] = [];
    if (params.systemInstruction) {
      apiMessages.push({ role: 'system', content: params.systemInstruction });
    }
    for (const m of params.messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, any> = {
      model,
      messages: apiMessages,
      max_tokens: 8192,
    };
    if (model !== 'deepseek-reasoner' && typeof params.temperature === 'number') {
      body.temperature = params.temperature;
    }
    if (params.jsonMode && model !== 'deepseek-reasoner') {
      body.response_format = { type: 'json_object' };
    }

    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `DeepSeek API Error (HTTP ${resp.status})`
      );
    }

    const msg = data?.choices?.[0]?.message;
    const text = (msg?.content || '').trim();
    const reasoning = (msg?.reasoning_content || '').trim();

    if (!text) {
      throw new Error(`DeepSeek (${model}) ไม่ได้ส่งข้อความตอบกลับ`);
    }

    return {
      text,
      reasoning: reasoning || undefined,
      provider: 'deepseek',
      model,
      engineLabel: `DeepSeek (${model})`,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 4. OPENAI CHATGPT (Official OpenAI Chat Completions API)
  if (provider === 'openai') {
    const apiKey = params.apiKeyOverride?.trim() || cfg.openai.apiKey;
    if (!apiKey) {
      throw new Error(
        'ยังไม่ได้ใส่ OpenAI (ChatGPT) API Key — กรุณาตั้งค่าในหน้า "ตั้งค่า API Keys & Providers"'
      );
    }
    const model = params.model?.trim() || cfg.openai.model || 'gpt-4.1';
    const isReasoningModel = /^o[134]/.test(model);

    const apiMessages: any[] = [];
    if (params.systemInstruction) {
      apiMessages.push({
        role: isReasoningModel ? 'developer' : 'system',
        content: params.systemInstruction,
      });
    }
    for (const m of params.messages) {
      apiMessages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, any> = {
      model,
      messages: apiMessages,
    };
    if (!isReasoningModel && typeof params.temperature === 'number') {
      body.temperature = params.temperature;
    }
    if (params.jsonMode && !isReasoningModel) {
      body.response_format = { type: 'json_object' };
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `OpenAI ChatGPT API Error (HTTP ${resp.status})`
      );
    }

    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      throw new Error(`OpenAI ChatGPT (${model}) ไม่ได้ส่งข้อความตอบกลับ`);
    }

    return {
      text,
      provider: 'openai',
      model,
      engineLabel: `OpenAI ChatGPT (${model})`,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 5. CUSTOM / LOCAL OPENAI-COMPATIBLE SERVER (e.g., Ollama / vLLM / LM Studio / Omni Server)
  const endpoint = cfg.localOpenAi.endpoint.replace(/\/$/, '');
  const localModel = params.model?.trim() || cfg.localOpenAi.model;
  const localKey = params.apiKeyOverride?.trim() || cfg.localOpenAi.apiKey;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (localKey) {
    headers.Authorization = `Bearer ${localKey}`;
  }

  const apiMessages: any[] = [];
  if (params.systemInstruction) {
    apiMessages.push({ role: 'system', content: params.systemInstruction });
  }
  for (const m of params.messages) {
    apiMessages.push({ role: m.role, content: m.content });
  }

  const resp = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: localModel,
      messages: apiMessages,
      temperature: params.temperature ?? 0.6,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(
      `OpenAI-Compatible Server (${endpoint}) ตอบกลับ HTTP ${resp.status}: ${errText.slice(0, 200)}`
    );
  }

  const data = (await resp.json()) as any;
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new Error(`OpenAI-Compatible Server (${localModel}) ไม่ได้ส่งข้อความตอบกลับ`);
  }

  return {
    text,
    provider: 'openai_compatible',
    model: localModel,
    engineLabel: `OpenAI-Compatible (${localModel})`,
    latencyMs: Date.now() - startedAt,
  };
}

function extractStrictJson(rawText: string): any {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('โมเดล AI ตอบกลับไม่ใช่รูปแบบ JSON ที่ถูกต้อง กรุณาลองสั่งงานอีกครั้ง');
  }
}

// ============================================================================
// LIVE PROVIDER PING / CONNECTION VERIFICATION
// ============================================================================
export async function testProviderConnection(params: {
  provider: 'gemini' | 'claude' | 'deepseek' | 'openai' | 'openai_compatible';
  model?: string;
  apiKey?: string;
}) {
  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    apiKeyOverride: params.apiKey,
    systemInstruction: 'You are an API connectivity verifier. Reply concisely in Thai.',
    messages: [
      {
        role: 'user',
        content: 'ยืนยันการเชื่อมต่อระบบ คมคิด by KOMKRIT สั้นๆ 1 ประโยค',
      },
    ],
    temperature: 0.2,
  });

  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    engineLabel: res.engineLabel,
    latencyMs: res.latencyMs,
    sampleReply: res.text,
  };
}

// ============================================================================
// REAL INTERACTIVE MULTI-MODEL CHAT (CLAUDE / DEEPSEEK / CHATGPT / GEMINI)
// ============================================================================
export async function chatWithRealModel(params: {
  sessionId: string;
  provider?: LlmProviderId;
  model?: string;
  message: string;
  useKnowledgeBase?: boolean;
}) {
  const userMsg = params.message?.trim();
  if (!userMsg) {
    throw new Error('กรุณาพิมพ์ข้อความสนทนา');
  }

  // Load recent history for this session
  const historyRows = db
    .prepare(
      'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 24'
    )
    .all(params.sessionId) as { role: 'user' | 'assistant'; content: string }[];

  let systemInstruction =
    'คุณคือผู้ช่วย AI อัจฉริยะประจำสตูดิโอ "คมคิด by KOMKRIT" (สโลแกน: คิดต่างอย่างสร้างสรรค์ เพื่อการศึกษา เพื่อสังคม เพื่ออนาคตที่ดีกว่า) ช่วยวิเคราะห์ วิจัย ร่างบทความ สคริปต์วิดีโอ และวางกลยุทธ์อย่างเฉียบคม แม่นยำ และนำไปใช้งานได้จริง';

  if (params.useKnowledgeBase !== false) {
    const kb = getActiveKnowledgeContext(userMsg);
    if (kb.length > 0) {
      const kbStr = kb
        .map((k, idx) => `[KB-${idx + 1}] ${k.title}: ${k.summary} — ${k.content}`)
        .join('\n');
      systemInstruction += `\n\nฐานความรู้ขององค์กร (Knowledge Base):\n${kbStr}`;
    }
  }

  const messages: ChatTurnMessage[] = [
    ...historyRows.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMsg },
  ];

  const llmRes = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages,
    temperature: 0.65,
  });

  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO ai_chat_messages (
      session_id, provider, model, role, content, reasoning, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  ins.run(params.sessionId, llmRes.provider, llmRes.model, 'user', userMsg, '', 0, now);
  const assistantRow = ins.run(
    params.sessionId,
    llmRes.provider,
    llmRes.model,
    'assistant',
    llmRes.text,
    llmRes.reasoning || '',
    llmRes.latencyMs,
    now
  );

  return {
    id: Number(assistantRow.lastInsertRowid),
    sessionId: params.sessionId,
    provider: llmRes.provider,
    model: llmRes.model,
    engineLabel: llmRes.engineLabel,
    reply: llmRes.text,
    reasoning: llmRes.reasoning || '',
    latencyMs: llmRes.latencyMs,
    createdAt: now,
  };
}

// ============================================================================
// REAL GOOGLE FLOW DIRECTOR STORYBOARD GENERATOR (Powered by Real LLM)
// ============================================================================
export async function generateFlowStoryboardWithLlm(params: {
  title: string;
  concept: string;
  sceneCount?: number;
  aspectRatio?: '16:9' | '9:16';
  provider?: LlmProviderId;
  model?: string;
}) {
  const count = Math.min(5, Math.max(2, Number(params.sceneCount) || 3));
  const kb = getActiveKnowledgeContext(`${params.title} ${params.concept}`);
  const kbText = kb.map((k) => `- ${k.title}: ${k.summary}`).join('\n');

  const systemInstruction = `คุณคือ AI Film Director สำหรับระบบ Google Flow & Google Veo Filmmaking Studio ของ "คมคิด by KOMKRIT"
จงออกแบบ Storyboard ภาพยนตร์สั้นจำนวน ${count} ฉาก (Scenes) ที่มีความต่อเนื่องกันทั้งตัวละคร แสง สี และมุมกล้อง
โดยแต่ละฉากต้องมี:
- firstFramePrompt (ภาษาอังกฤษ ละเอียดระดับภาพถ่ายภาพยนตร์ สำหรับสร้างภาพ Keyframe ต้นฉากด้วย Gemini Nano Banana 2.1)
- lastFramePrompt (ภาษาอังกฤษ สำหรับภาพท้ายฉากเพื่อให้เกิด Smooth Transition หากต้องการ)
- videoMotionPrompt (ภาษาอังกฤษ ระบุการเคลื่อนกล้อง การขยับของตัวแบบ แสง และเสียงบรรยากาศ สำหรับส่งเข้า Google Veo / Gemini Omni 1.1 Flash)
- narrationThai (บทพากย์ภาษาไทยสำหรับ Gemini 3.8 Flash TTS ความยาวกระชับพอดีกับเวลาฉาก)
ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

  const userPrompt = `ชื่อโปรเจกต์วิดีโอ: ${params.title}
แนวคิด / เนื้อหาหลัก: ${params.concept}
สัดส่วนภาพ: ${params.aspectRatio || '16:9'}
จำนวนฉาก: ${count} ฉาก
บริบทแบรนด์ คมคิด by KOMKRIT:
${kbText}

ตอบเป็น JSON รูปแบบนี้เท่านั้น:
{
  "scenes": [
    {
      "id": "scene-1",
      "sceneNumber": 1,
      "title": "ชื่อฉากภาษาไทย",
      "durationSec": 6,
      "firstFramePrompt": "Detailed cinematic English image prompt for start frame...",
      "lastFramePrompt": "Detailed cinematic English image prompt for end frame...",
      "videoMotionPrompt": "Detailed English Veo/Flow camera & motion prompt with ambient sound...",
      "narrationThai": "บทพากย์เสียงภาษาไทยของฉากนี้"
    }
  ]
}`;

  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.65,
    jsonMode: true,
  });

  const parsed = extractStrictJson(res.text);
  const rawScenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (rawScenes.length === 0) {
    throw new Error('AI Director ไม่ได้สร้างรายการฉากกลับมา กรุณาลองใหม่อีกครั้ง');
  }

  const scenes = rawScenes.map((s: any, idx: number) => ({
    id: `scene-${idx + 1}-${Date.now()}`,
    sceneNumber: idx + 1,
    title: String(s.title || `ฉากที่ ${idx + 1}`),
    durationSec: Math.min(10, Math.max(4, Number(s.durationSec) || 6)),
    firstFramePrompt: String(s.firstFramePrompt || ''),
    lastFramePrompt: String(s.lastFramePrompt || ''),
    videoMotionPrompt: String(s.videoMotionPrompt || ''),
    narrationThai: String(s.narrationThai || ''),
    firstFrameUrl: '',
    lastFrameUrl: '',
    videoClipUrl: '',
    interactionId: '',
  }));

  return {
    engineLabel: res.engineLabel,
    scenes,
  };
}

// ============================================================================
// REAL 8-AGENT MULTI-AGENT CONTENT CREATION WORKFLOW (100% REAL API — NO MOCKUP!)
// ============================================================================
export async function executeMultiAgentWorkflow(input: RunWorkflowInput) {
  const kbItems = getActiveKnowledgeContext(input.topic);
  const kbContextString = kbItems
    .map(
      (k, i) =>
        `[KB-${i + 1}] ${k.title}: ${k.summary} — ${k.content} (แหล่งอ้างอิง: ${k.source_ref})`
    )
    .join('\n');

  const categoryNames: Record<string, string> = {
    education: 'การศึกษา',
    innovation: 'นวัตกรรม',
    society: 'สังคม',
    international: 'ต่างประเทศ',
    career: 'อาชีพ & การพัฒนา',
    'ai-tech': 'AI & เทคโนโลยี',
    special: 'บทความพิเศษ',
  };
  const catLabel = categoryNames[input.category] || 'การศึกษา';

  const systemPrompt = `คุณคือระบบ Multi-Agent AI Content Creation Ecosystem ของ "คมคิด by KOMKRIT" (สโลแกน: "คิดต่างอย่างสร้างสรรค์ เพื่อการศึกษา เพื่อสังคม เพื่ออนาคตที่ดีกว่า")
ประมวลผลการทำงานจริงของทีม AI Agents ทั้งหมด (CEO Agent, 01 Research Agent, 02 Idea & Script Agent, 03 Content Design Agent, 04 Visual Creator Agent, 05 Video Production Agent สำหรับ Google Veo & Flow, 06 Audio Production Agent สำหรับ Gemini 3.8 Flash TTS, 07 QA Agent 4 มิติ และ 08 Analytics & Omnichannel 8 ช่องทาง)
โดยยึดข้อมูลจากฐานความรู้ (Knowledge Base) ด้านล่างอย่างเคร่งครัด เนื้อหาบทความ (fullArticleMarkdown) ต้องเขียนฉบับเต็มอย่างละเอียด ลึกซึ้ง ใช้ Markdown หัวข้อ ## และ ### พร้อมข้อเสนอเชิงปฏิบัติจริง
ตอบกลับเป็น JSON Object ที่ถูกต้องตามโครงสร้างที่ระบุเท่านั้น ห้ามครอบข้อความอธิบายอื่น`;

  const userPrompt = `หัวข้อโจทย์ (Topic): ${input.topic}
แหล่งที่มาไอเดีย (Input Source): ${input.inputSource}
หมวดหมู่: ${catLabel}
กลุ่มผู้เรียน/เป้าหมาย: ${input.targetAudience}
เสาหลักธุรกิจ (KOMKID 5-Pillar): ${input.businessPillar}
โหมดการทำงาน: ${input.flowMode}
${input.revisionNote ? `คำสั่งแก้ไขเพิ่มเติมจากผู้บริหาร (Human Approval Revision Note): ${input.revisionNote}` : ''}

ฐานความรู้ (Knowledge Base):
${kbContextString}

จงส่งคืน JSON Object ที่มีโครงสร้างและชนิดข้อมูลครบทุกฟิลด์ดังนี้:
{
  "ceoOutput": {
    "goal": "string",
    "strategy": "string",
    "keyMessage": "string",
    "kpiTargets": ["string"],
    "agentAssignments": [{ "agent": "string", "mission": "string" }]
  },
  "researchOutput": {
    "deepInsights": ["string"],
    "keyFacts": ["string"],
    "trendAnalysis": "string",
    "references": ["string"],
    "kbSourcesUsed": ["string"]
  },
  "scriptOutput": {
    "titleSuggestions": ["string", "string", "string"],
    "selectedTitle": "string",
    "subtitle": "string",
    "excerpt": "string",
    "learningObjectives": ["string"],
    "fullArticleMarkdown": "Markdown บทความฉบับเต็มความยาวอย่างน้อย 4-6 หัวข้อย่อย",
    "videoScript": "สคริปต์วิดีโอความยาว 60 วินาที แบ่งช่วงเวลาชัดเจน",
    "socialHook": "string"
  },
  "designOutput": {
    "contentStructure": ["string"],
    "brandTone": "string",
    "mindMapNodes": {
      "center": "string",
      "branches": [{ "title": "string", "items": ["string", "string"] }]
    },
    "slideDeckOutline": [{ "slide": 1, "title": "string", "bullet": "string" }],
    "instructionalDesign": "string"
  },
  "visualOutput": {
    "imagePrompts": [
      { "platform": "Gemini Nano Banana 2.1", "prompt": "Detailed English visual prompt..." },
      { "platform": "OpenAI GPT-Image / DALL-E 3", "prompt": "Detailed English infographic/editorial prompt..." }
    ],
    "infographicHeadline": "string",
    "infographicSubpoints": ["string", "string", "string", "string"],
    "generatedSvgDataUrl": "",
    "recommendedTools": ["Gemini Nano Banana 2.1", "Gemini 3 Pro Image", "OpenAI DALL-E 3"]
  },
  "videoOutput": {
    "duration": "string",
    "avatarStyle": "string",
    "scenes": [
      { "time": "00:00 - 00:10", "visual": "English/Thai Veo scene prompt", "dialogue": "string", "subtitle": "string", "bRoll": "string" }
    ],
    "recommendedTools": ["Google Flow", "Google Veo 3.1", "Gemini Omni 1.1 Flash"]
  },
  "audioOutput": {
    "voiceTone": "string",
    "narrationScriptWithCues": "บทพากย์ภาษาไทยพร้อมผลิตเสียงด้วย Gemini 3.8 Flash TTS",
    "bgmStyle": "string",
    "soundEffects": ["string"],
    "recommendedTools": ["Gemini 3.8 Flash TTS", "ElevenLabs", "OpenAI TTS"]
  },
  "qaOutput": {
    "factCheckScore": 95,
    "factCheckNote": "string",
    "languageScore": 96,
    "languageNote": "string",
    "brandScore": 97,
    "brandNote": "string",
    "riskScore": 98,
    "riskNote": "string",
    "overallScore": 96,
    "verdict": "ผ่าน",
    "improvements": ["string"]
  },
  "analyticsOutput": {
    "predictedReach": "string",
    "predictedEngagement": "string",
    "targetLearnerFit": "string",
    "abHeadlines": ["string", "string"],
    "optimizationTips": ["string"]
  },
  "omnichannelOutput": {
    "youtube": { "title": "string", "description": "string", "tags": ["string"] },
    "facebook": { "post": "string", "engagementQuestion": "string" },
    "tiktok": { "hook": "string", "caption": "string", "hashtags": ["string"] },
    "lineOa": { "headline": "string", "broadcastMessage": "string" },
    "xTwitter": { "thread": ["string", "string"] },
    "instagram": { "carouselSlides": ["string"], "caption": "string" },
    "websiteBlog": { "slug": "string", "seoMeta": "string" },
    "emailNewsletter": { "subject": "string", "previewText": "string", "bodyIntro": "string" },
    "publishedChannels": []
  }
}`;

  // Execute REAL API call — throws real error if API key is missing or invalid (ZERO MOCKUPS!)
  const llmResult = await callRealLlm({
    provider: input.provider,
    model: input.model,
    systemInstruction: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.6,
    jsonMode: true,
  });

  const parsed = extractStrictJson(llmResult.text);

  // Optionally generate a REAL AI Image via Gemini Nano Banana 2.1 / DALL-E 3 if requested
  let generatedImageUrl = '';
  if (input.autoGenerateCoverImage) {
    const firstPrompt =
      parsed?.visualOutput?.imagePrompts?.[0]?.prompt ||
      `Editorial educational photography for "${input.topic}", modern Thai learning environment, deep navy blue and warm golden lighting, high resolution`;
    const imgAsset = await generateRealImage({
      prompt: firstPrompt,
      aspectRatio: '16:9',
    });
    generatedImageUrl = imgAsset.fileUrl;
  }

  const visualOut = {
    imagePrompts: Array.isArray(parsed.visualOutput?.imagePrompts)
      ? parsed.visualOutput.imagePrompts
      : [],
    infographicHeadline: parsed.visualOutput?.infographicHeadline || input.topic,
    infographicSubpoints: Array.isArray(parsed.visualOutput?.infographicSubpoints)
      ? parsed.visualOutput.infographicSubpoints
      : [],
    generatedSvgDataUrl: generatedImageUrl,
    generatedRealImageUrl: generatedImageUrl,
    recommendedTools: parsed.visualOutput?.recommendedTools || [
      'Gemini Nano Banana 2.1',
      'Gemini 3 Pro Image',
      'OpenAI GPT-Image-1',
    ],
  };

  return {
    engineUsed: `${llmResult.engineLabel} • ${llmResult.latencyMs}ms`,
    ceoOutput: parsed.ceoOutput || {},
    researchOutput: parsed.researchOutput || {},
    scriptOutput: parsed.scriptOutput || {},
    designOutput: parsed.designOutput || {},
    visualOutput: visualOut,
    videoOutput: parsed.videoOutput || {},
    audioOutput: parsed.audioOutput || {},
    qaOutput: parsed.qaOutput || {},
    analyticsOutput: parsed.analyticsOutput || {},
    omnichannelOutput: {
      ...(parsed.omnichannelOutput || {}),
      publishedChannels: [],
    },
  };
}

// ============================================================================
// REAL AI ASSIST FOR POST CRUD EDITOR (NO MOCKUPS!)
// ============================================================================
export async function assistPostContent(params: {
  title: string;
  category: string;
  currentContent?: string;
  mode: 'generate_full' | 'polish' | 'generate_real_image';
  provider?: LlmProviderId;
  model?: string;
}) {
  const categoryNames: Record<string, string> = {
    education: 'การศึกษา',
    innovation: 'นวัตกรรม',
    society: 'สังคม',
    international: 'ต่างประเทศ',
    career: 'อาชีพ & การพัฒนา',
    'ai-tech': 'AI & การศึกษา',
    special: 'บทความพิเศษ',
  };
  const catLabel = categoryNames[params.category] || 'การศึกษา';

  // Real AI Image generation via Gemini Nano Banana 2.1 or OpenAI DALL-E 3 / GPT-Image-1
  if (params.mode === 'generate_real_image') {
    const prompt = `Editorial high-resolution cover photography illustrating "${
      params.title || 'Modern Thai Education & AI Innovation'
    }" in category ${catLabel}, warm inspiring atmosphere, deep navy blue and golden amber visual accents, clean composition, 16:9`;
    const asset = await generateRealImage({
      prompt,
      aspectRatio: '16:9',
    });
    return {
      coverImage: asset.fileUrl,
      engineUsed: `${asset.provider} (${asset.model})`,
    };
  }

  if (params.mode === 'polish' && params.currentContent?.trim()) {
    const res = await callRealLlm({
      provider: params.provider,
      model: params.model,
      systemInstruction:
        'คุณคือบรรณาธิการบริหารของ "คมคิด by KOMKRIT" จงเกลาและยกระดับบทความภาษาไทยให้สละสลวย ลึกซึ้ง น่าอ่าน มีโครงสร้าง Markdown ที่ชัดเจน ตอบเป็น JSON เท่านั้น: {"subtitle":"...","excerpt":"...","content":"...","tags":["..."]}',
      messages: [
        {
          role: 'user',
          content: `หัวข้อ: ${params.title}\nหมวดหมู่: ${catLabel}\nเนื้อหาเดิม:\n${params.currentContent}`,
        },
      ],
      temperature: 0.5,
      jsonMode: true,
    });
    const parsed = extractStrictJson(res.text);
    return {
      subtitle: parsed.subtitle || '',
      excerpt: parsed.excerpt || '',
      content: parsed.content || params.currentContent,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [catLabel, 'คมคิด by KOMKRIT'],
      engineUsed: res.engineLabel,
    };
  }

  const wf = await executeMultiAgentWorkflow({
    topic: params.title || 'แนวทางการพัฒนาการศึกษายุคใหม่',
    inputSource: 'ไอเดียจาก Komkrit',
    category: params.category || 'education',
    targetAudience: 'ผู้สนใจทั่วไปและบุคลากรทางการศึกษา',
    businessPillar: '1. VIEWS | ยอดวิว',
    flowMode: 'core_3agent',
    provider: params.provider,
    model: params.model,
  });

  return {
    subtitle: wf.scriptOutput.subtitle || '',
    excerpt: wf.scriptOutput.excerpt || '',
    content: wf.scriptOutput.fullArticleMarkdown || '',
    tags: [catLabel, 'คมคิด by KOMKRIT', 'คิดต่างอย่างสร้างสรรค์'],
    engineUsed: wf.engineUsed,
  };
}

// ============================================================================
// AI PROMPT DIRECTOR & EVALUATOR (CHAT / IDEA -> ASSESSMENT + FULL IMAGE/VDO PROMPT)
// ============================================================================
export async function evaluateAndBuildMediaPrompt(params: {
  target: 'image' | 'video';
  sessionId?: string;
  ideaText?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  provider?: LlmProviderId;
  model?: string;
}) {
  let conversationContext = '';
  if (params.sessionId) {
    const rows = db
      .prepare(
        'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 14'
      )
      .all(params.sessionId) as { role: string; content: string }[];
    if (rows.length > 0) {
      conversationContext = rows
        .reverse()
        .map((r) => `${r.role === 'user' ? 'ผู้ดูแล' : 'AI'}: ${r.content}`)
        .join('\n');
    }
  }

  const idea = (params.ideaText || '').trim();
  if (!conversationContext && !idea) {
    throw new Error('กรุณาพิมพ์บอกสิ่งที่ต้องการสร้าง หรือคุยกับ AI ก่อนให้ประเมิน Prompt ครับ');
  }

  const isVideo = params.target === 'video';
  const defaultAspect = params.aspectRatio || '16:9';

  const systemInstruction = isVideo
    ? `คุณคือ Creative Video Director & Prompt Engineer ประจำสตูดิโอ "คมคิด by KOMKRIT"
หน้าที่ของคุณคือ:
1) ประเมินความต้องการของผู้ใช้จากบทสนทนาหรือไอเดียที่ให้มา อธิบายเป็นภาษาไทยที่อ่านเข้าใจง่าย สุภาพ เหมาะสำหรับผู้บริหาร/ผู้ใหญ่ (assessmentThai) ว่าคลิปนี้ควรเล่าภาพอย่างไรให้ดึงดูดและดูเป็นมืออาชีพ
2) สรุปภาพฉากวิดีโอที่จะสร้างเป็นภาษาไทยสั้นๆ ชัดเจน (visualSummaryThai)
3) เขียน Full Video Prompt ภาษาอังกฤษระดับภาพยนตร์ (fullPrompt) สำหรับส่งให้ Google Veo / Gemini Video Agent โดยระบุครบถ้วน: Subject, Action, Setting, Camera Movement (smooth dolly / tracking / cinematic pan), Lighting & Color Palette (warm inspiring light, deep navy & amber accents where appropriate), Ambient Sound & Pacing
4) แนะนำสัดส่วนภาพ (recommendedAspectRatio: "16:9" สำหรับเว็บ/YouTube หรือ "9:16" สำหรับคลิปสั้นมือถือ) และหัวข้อข่าวที่เข้ากับคลิปนี้ (suggestedPostTitle)
ตอบเป็น JSON เท่านั้นตามโครงสร้างนี้:
{
  "assessmentThai": "...",
  "visualSummaryThai": "...",
  "fullPrompt": "...",
  "recommendedAspectRatio": "${defaultAspect}",
  "suggestedPostTitle": "..."
}`
    : `คุณคือ Art Director & AI Image Prompt Engineer ประจำสตูดิโอ "คมคิด by KOMKRIT"
หน้าที่ของคุณคือ:
1) ประเมินความต้องการของผู้ใช้จากบทสนทนาหรือไอเดียที่ให้มา อธิบายเป็นภาษาไทยที่อ่านเข้าใจง่าย สุภาพ เหมาะสำหรับผู้บริหาร/ผู้ใหญ่ (assessmentThai) ว่าภาพนี้ควรจัดองค์ประกอบ โทนแสง และอารมณ์อย่างไรให้น่าเชื่อถือและดึงดูดสายตา
2) สรุปภาพที่จะได้เป็นภาษาไทยสั้นๆ ชัดเจน (visualSummaryThai)
3) เขียน Full Image Prompt ภาษาอังกฤษระดับมืออาชีพ (fullPrompt) สำหรับส่งให้ AI Image Agent (Gemini Nano Banana 2.1 / OpenAI GPT-Image-1) โดยระบุครบถ้วน: Main Subject, Environment, Composition, Lighting, Color Harmony, Camera Lens / Editorial Photography Style, High Detail, No gibberish text
4) แนะนำสัดส่วนภาพ (recommendedAspectRatio: "16:9", "1:1" หรือ "9:16") และหัวข้อข่าวที่เข้ากับภาพนี้ (suggestedPostTitle)
ตอบเป็น JSON เท่านั้นตามโครงสร้างนี้:
{
  "assessmentThai": "...",
  "visualSummaryThai": "...",
  "fullPrompt": "...",
  "recommendedAspectRatio": "${defaultAspect}",
  "suggestedPostTitle": "..."
}`;

  const userPayload = [
    conversationContext ? `บทสนทนาล่าสุดในห้องแชท:\n${conversationContext}` : '',
    idea ? `คำสั่ง/แนวคิดเพิ่มเติมจากผู้ดูแล:\n${idea}` : '',
    `สัดส่วนที่ต้องการเบื้องต้น: ${defaultAspect}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: 'user', content: userPayload }],
    temperature: 0.55,
    jsonMode: true,
  });

  const parsed = extractStrictJson(res.text);
  const recAspect = ['16:9', '9:16', '1:1'].includes(parsed.recommendedAspectRatio)
    ? parsed.recommendedAspectRatio
    : defaultAspect;

  return {
    target: params.target,
    assessmentThai:
      String(parsed.assessmentThai || '').trim() ||
      'AI ประเมินแนวคิดและออกแบบองค์ประกอบภาพระดับมืออาชีพให้เรียบร้อยแล้ว',
    visualSummaryThai:
      String(parsed.visualSummaryThai || '').trim() ||
      (isVideo ? 'วิดีโอคุณภาพสูงถ่ายทอดแนวคิดตามที่สนทนา' : 'ภาพประกอบข่าวคุณภาพสูงตามแนวคิดที่สนทนา'),
    fullPrompt: String(parsed.fullPrompt || '').trim(),
    recommendedAspectRatio: recAspect as '16:9' | '9:16' | '1:1',
    suggestedPostTitle: String(parsed.suggestedPostTitle || '').trim(),
    engineUsed: res.engineLabel,
  };
}

// ============================================================================
// AI NEWS & CONTENT WRITER DIRECTLY FROM CHAT CONVERSATION OR BRIEF
// ============================================================================
export async function draftContentFromChat(params: {
  sessionId?: string;
  ideaText?: string;
  contentFormat?: 'news' | 'article' | 'social_post';
  category?: string;
  provider?: LlmProviderId;
  model?: string;
}) {
  let conversationContext = '';
  if (params.sessionId) {
    const rows = db
      .prepare(
        'SELECT role, content FROM ai_chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 18'
      )
      .all(params.sessionId) as { role: string; content: string }[];
    if (rows.length > 0) {
      conversationContext = rows
        .reverse()
        .map((r) => `${r.role === 'user' ? 'ผู้ดูแล' : 'AI'}: ${r.content}`)
        .join('\n');
    }
  }

  const idea = (params.ideaText || '').trim();
  if (!conversationContext && !idea) {
    throw new Error('กรุณาพิมพ์หัวข้อข่าว/เนื้อหาที่ต้องการ หรือคุยกับ AI ก่อนสั่งเขียนข่าวครับ');
  }

  const kb = getActiveKnowledgeContext(idea || conversationContext.slice(-500));
  const kbStr =
    kb.length > 0
      ? kb.map((k, i) => `[KB-${i + 1}] ${k.title}: ${k.summary}`).join('\n')
      : '';

  const formatDesc =
    params.contentFormat === 'social_post'
      ? 'คอนเทนต์สั้นกระชับ น่าแชร์ อ่านจบไว เหมาะทั้งลงหน้าเว็บและโพสต์โซเชียล'
      : params.contentFormat === 'article'
      ? 'บทความวิเคราะห์ให้ความรู้ลึกซึ้ง อ่านเข้าใจง่าย มีหัวข้อย่อยชัดเจนในสไตล์ คมคิด by KOMKRIT'
      : 'ข่าวประชาสัมพันธ์ / ข่าวสารความรู้ที่น่าเชื่อถือ อ่านง่าย ชัดเจน พร้อมขึ้นหน้าเว็บไซต์';

  const systemInstruction = `คุณคือบรรณาธิการข่าวและนักเขียนคอนเทนต์มืออาชีพประจำเว็บไซต์ "คมคิด by KOMKRIT" (คิดต่างอย่างสร้างสรรค์)
จงเรียบเรียงเนื้อหาภาษาไทยคุณภาพสูงตามรูปแบบ "${formatDesc}" จากบทสนทนาหรือโจทย์ที่ได้รับ
${kbStr ? `\nข้อมูลอ้างอิงขององค์กร:\n${kbStr}\n` : ''}
กฎสำคัญ:
- ภาษาไทยสละสลวย อ่านง่าย ตัวอย่างชัดเจน ไม่ใช้ศัพท์เทคนิคเกินจำเป็น
- category ต้องเลือก 1 ค่าที่ตรงที่สุดจาก: "education", "innovation", "society", "international", "career", "ai-tech", "special"
- contentType เลือก "news" (ถ้าเป็นข่าวสาร/ประชาสัมพันธ์) หรือ "article" (ถ้าเป็นบทความความรู้/คอนเทนต์)
- suggestedImagePrompt เขียนเป็นภาษาอังกฤษละเอียดสำหรับใช้สั่ง AI สร้างภาพปกข่าวเรื่องนี้ในสัดส่วน 16:9
ตอบเป็น JSON เท่านั้น:
{
  "title": "พาดหัวข่าว/บทความคมชัด",
  "subtitle": "คำโปรยขยายความน่าสนใจ",
  "excerpt": "สรุปใจความสำคัญ 2-3 ประโยค",
  "category": "education",
  "contentType": "news",
  "content": "เนื้อหาข่าวหรือบทความฉบับเต็ม แบ่งย่อหน้าและหัวข้อย่อยให้อ่านสบายตา",
  "tags": ["คมคิด by KOMKRIT", "..."],
  "suggestedImagePrompt": "Editorial 16:9 cover photography..."
}`;

  const userPayload = [
    conversationContext ? `บทสนทนาในห้องแชท:\n${conversationContext}` : '',
    idea ? `โจทย์/คำสั่งเพิ่มเติม:\n${idea}` : '',
    params.category ? `หมวดหมู่ที่ต้องการ: ${params.category}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await callRealLlm({
    provider: params.provider,
    model: params.model,
    systemInstruction,
    messages: [{ role: 'user', content: userPayload }],
    temperature: 0.6,
    jsonMode: true,
  });

  const parsed = extractStrictJson(res.text);
  const validCategories = [
    'education',
    'innovation',
    'society',
    'international',
    'career',
    'ai-tech',
    'special',
  ];
  const category = validCategories.includes(parsed.category)
    ? parsed.category
    : params.category || 'education';

  return {
    title: String(parsed.title || 'ข่าวใหม่จาก คมคิด by KOMKRIT').trim(),
    subtitle: String(parsed.subtitle || '').trim(),
    excerpt: String(parsed.excerpt || '').trim(),
    category,
    contentType: parsed.contentType === 'article' ? 'article' : 'news',
    content: String(parsed.content || '').trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : ['คมคิด by KOMKRIT'],
    suggestedImagePrompt: String(parsed.suggestedImagePrompt || '').trim(),
    engineUsed: res.engineLabel,
  };
}
