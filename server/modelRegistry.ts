import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IS_SERVERLESS } from './db.ts';
import { getSettingValue } from './mediaEngine.ts';

const execFileAsync = promisify(execFile);

export type ModelCapability = 'text' | 'image' | 'video' | 'tts';

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
  createdAt?: string | number;
  supportedMethods?: string[];
}

export interface ProviderLiveCatalog {
  provider: DiscoverableProvider;
  connected: boolean;
  fetchedAt: string;
  error?: string;
  textModels: LiveModelOption[];
  imageModels: LiveModelOption[];
  videoModels: LiveModelOption[];
  ttsModels: LiveModelOption[];
  voices?: LiveModelOption[];
}

export interface UnifiedLiveModelsResponse {
  fetchedAt: string;
  providers: Record<DiscoverableProvider, ProviderLiveCatalog>;
}

interface CacheEntry {
  expiresAt: number;
  catalog: ProviderLiveCatalog;
}

const CACHE_TTL_MS = 3 * 60 * 1000;
const catalogCache = new Map<string, CacheEntry>();

export function invalidateModelCatalogCache(provider?: DiscoverableProvider) {
  if (!provider) {
    catalogCache.clear();
    return;
  }
  for (const key of catalogCache.keys()) {
    if (key.startsWith(`${provider}:`)) {
      catalogCache.delete(key);
    }
  }
}

function fingerprintSecret(secret: string): string {
  if (!secret) return 'none';
  let hash = 2166136261;
  for (let i = 0; i < secret.length; i++) {
    hash ^= secret.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sanitizeSecretInError(raw: string, secret?: string): string {
  let msg = String(raw || 'ไม่สามารถดึงรายชื่อโมเดลจาก API ได้');
  if (secret && secret.trim().length > 6) {
    msg = msg.split(secret.trim()).join('***');
  }
  return msg;
}

function emptyCatalog(
  provider: DiscoverableProvider,
  connected = false,
  error?: string
): ProviderLiveCatalog {
  return {
    provider,
    connected,
    fetchedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
    textModels: [],
    imageModels: [],
    videoModels: [],
    ttsModels: [],
    voices: [],
  };
}

/**
 * Scores a model ID dynamically by semantic version + stability/tier without hardcoding model names.
 * Higher version numbers always rank ahead of older versions.
 */
function scoreModelRecency(id: string): number {
  const lower = id.toLowerCase();
  // Extract primary semantic version (e.g. 2.5, 3.1, 4.5)
  const verMatch = lower.match(/(?:^|[-_])(\d+(?:\.\d+)?)(?:[-_]|$)/) || lower.match(/(\d+(?:\.\d+)?)/);
  const majorMinor = verMatch ? parseFloat(verMatch[1]) : 0;

  // Extract YYYYMMDD or YYYY-MM-DD release stamp if present
  let dateScore = 0;
  const isoDate = lower.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const compactDate = lower.match(/(20\d{2})(\d{2})(\d{2})/);
  if (isoDate) {
    dateScore = parseInt(`${isoDate[1]}${isoDate[2]}${isoDate[3]}`, 10) / 1e9;
  } else if (compactDate) {
    dateScore = parseInt(`${compactDate[1]}${compactDate[2]}${compactDate[3]}`, 10) / 1e9;
  }

  let tierAdjust = 0;
  if (/-flash\b/.test(lower) && !/lite|8b/.test(lower)) tierAdjust += 0.04;
  if (/-pro\b/.test(lower)) tierAdjust += 0.03;
  if (/latest/.test(lower)) tierAdjust += 0.02;
  if (/lite|mini|nano|8b/.test(lower)) tierAdjust -= 0.02;
  if (/exp|tuning|legacy|001$/.test(lower)) tierAdjust -= 0.03;

  return majorMinor * 10 + tierAdjust + dateScore;
}

// ============================================================================
// 1. GOOGLE GEMINI LIVE MODEL DISCOVERY (/v1beta/models)
// ============================================================================
export async function fetchGeminiLiveCatalog(
  apiKeyOverride?: string,
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const apiKey =
    apiKeyOverride?.trim() ||
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') ||
    getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');

  if (!apiKey) {
    return emptyCatalog('gemini', false);
  }

  const cacheKey = `gemini:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const allRawModels: any[] = [];
    let pageToken = '';
    for (let page = 0; page < 4; page++) {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const resp = await fetch(url.toString(), {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(10000),
      });
      const data = (await resp.json()) as any;
      if (!resp.ok) {
        throw new Error(
          data?.error?.message || `Google Gemini Models API HTTP ${resp.status}`
        );
      }
      if (Array.isArray(data?.models)) {
        allRawModels.push(...data.models);
      }
      if (data?.nextPageToken) {
        pageToken = String(data.nextPageToken);
      } else {
        break;
      }
    }

    const textModels: LiveModelOption[] = [];
    const imageModels: LiveModelOption[] = [];
    const videoModels: LiveModelOption[] = [];
    const ttsModels: LiveModelOption[] = [];
    const seen = new Set<string>();

    for (const raw of allRawModels) {
      const rawName = String(raw?.name || '');
      const id = rawName.replace(/^models\//, '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const methods: string[] = Array.isArray(raw?.supportedGenerationMethods)
        ? raw.supportedGenerationMethods.map(String)
        : [];
      const displayName = String(raw?.displayName || '').trim();
      const label = displayName && displayName.toLowerCase() !== id.toLowerCase()
        ? `${displayName} (${id})`
        : id;

      // Skip embedding, attribution, legacy bison, or open-weight gemma utility endpoints
      if (
        /^(embedding|text-embedding|gemini-embedding|aqa|chat-bison|text-bison|codechat-bison|learnlm|gemma-)/i.test(
          id
        )
      ) {
        continue;
      }
      if (
        methods.length > 0 &&
        methods.every((m) => m === 'embedContent' || m === 'countTokens' || m === 'embedText')
      ) {
        continue;
      }

      const item: LiveModelOption = {
        id,
        label,
        supportedMethods: methods,
      };

      const isVideo =
        methods.includes('predictLongRunning') || /(^veo|-video|omni)/i.test(id);
      const isTts = /(tts|speech)/i.test(id);
      const isImage =
        !isVideo &&
        !isTts &&
        (/(^imagen|-image|banana)/i.test(id) ||
          (methods.includes('predict') && !/embed|veo|video|tts|audio/i.test(id)));

      if (isVideo) {
        videoModels.push(item);
      } else if (isImage) {
        imageModels.push(item);
      } else if (isTts) {
        ttsModels.push(item);
      } else if (
        (methods.includes('generateContent') || methods.includes('createInteraction')) &&
        !/(native-audio|live-|robotics|computer-use)/i.test(id)
      ) {
        textModels.push(item);
      }
    }

    const byNewest = (a: LiveModelOption, b: LiveModelOption) =>
      scoreModelRecency(b.id) - scoreModelRecency(a.id);

    textModels.sort(byNewest);
    imageModels.sort(byNewest);
    videoModels.sort(byNewest);
    ttsModels.sort(byNewest);

    const catalog: ProviderLiveCatalog = {
      provider: 'gemini',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels,
      imageModels,
      videoModels,
      ttsModels,
    };

    catalogCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      catalog,
    });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'gemini',
      true,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

export async function getGeminiModelMethods(
  apiKey: string,
  modelId: string
): Promise<string[]> {
  const cat = await fetchGeminiLiveCatalog(apiKey, false);
  const all = [
    ...cat.textModels,
    ...cat.imageModels,
    ...cat.videoModels,
    ...cat.ttsModels,
  ];
  const found = all.find((m) => m.id === modelId);
  return found?.supportedMethods || [];
}

// ============================================================================
// 2. ANTHROPIC CLAUDE LIVE MODEL DISCOVERY (https://api.anthropic.com/v1/models)
// ============================================================================
export async function fetchClaudeLiveCatalog(
  apiKeyOverride?: string,
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const apiKey =
    apiKeyOverride?.trim() || getSettingValue('claude_api_key', 'ANTHROPIC_API_KEY');
  if (!apiKey) {
    return emptyCatalog('claude', false);
  }

  const cacheKey = `claude:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `Anthropic Models API HTTP ${resp.status}`
      );
    }

    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => {
      const ta = Date.parse(String(a?.created_at || '')) || 0;
      const tb = Date.parse(String(b?.created_at || '')) || 0;
      return tb - ta;
    });

    const textModels: LiveModelOption[] = list
      .filter((m) => m?.id)
      .map((m) => {
        const id = String(m.id).trim();
        const name = String(m.display_name || '').trim();
        return {
          id,
          label: name && name.toLowerCase() !== id.toLowerCase() ? `${name} (${id})` : id,
          createdAt: m.created_at,
        };
      });

    const catalog: ProviderLiveCatalog = {
      provider: 'claude',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: [],
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'claude',
      true,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

// ============================================================================
// 3. DEEPSEEK LIVE MODEL DISCOVERY (https://api.deepseek.com/models)
// ============================================================================
export async function fetchDeepSeekLiveCatalog(
  apiKeyOverride?: string,
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const apiKey =
    apiKeyOverride?.trim() || getSettingValue('deepseek_api_key', 'DEEPSEEK_API_KEY');
  if (!apiKey) {
    return emptyCatalog('deepseek', false);
  }

  const cacheKey = `deepseek:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const resp = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `DeepSeek Models API HTTP ${resp.status}`
      );
    }

    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => (Number(b?.created) || 0) - (Number(a?.created) || 0));

    const textModels: LiveModelOption[] = list
      .filter((m) => m?.id)
      .map((m) => ({
        id: String(m.id).trim(),
        label: String(m.id).trim(),
        createdAt: m.created,
      }));

    const catalog: ProviderLiveCatalog = {
      provider: 'deepseek',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: [],
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'deepseek',
      true,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

// ============================================================================
// 4. OPENAI LIVE MODEL DISCOVERY (https://api.openai.com/v1/models)
// ============================================================================
export async function fetchOpenAiLiveCatalog(
  apiKeyOverride?: string,
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const apiKey =
    apiKeyOverride?.trim() || getSettingValue('openai_api_key', 'OPENAI_API_KEY');
  if (!apiKey) {
    return emptyCatalog('openai', false);
  }

  const cacheKey = `openai:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `OpenAI Models API HTTP ${resp.status}`
      );
    }

    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    list.sort((a, b) => (Number(b?.created) || 0) - (Number(a?.created) || 0));

    const textModels: LiveModelOption[] = [];
    const imageModels: LiveModelOption[] = [];
    const ttsModels: LiveModelOption[] = [];
    const seen = new Set<string>();

    for (const m of list) {
      const id = String(m?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const option: LiveModelOption = {
        id,
        label: id,
        createdAt: m.created,
      };

      if (/(gpt-image|dall-e|chatgpt-image)/i.test(id)) {
        imageModels.push(option);
      } else if (/(^tts-|tts$|-tts)/i.test(id)) {
        ttsModels.push(option);
      } else if (
        /^(gpt-|o[1-9]|chatgpt-)/i.test(id) &&
        !/(realtime|audio|transcribe|whisper|embedding|moderation|instruct|babbage|davinci|codex|computer-use|search-api)/i.test(
          id
        )
      ) {
        textModels.push(option);
      }
    }

    const catalog: ProviderLiveCatalog = {
      provider: 'openai',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels,
      imageModels,
      videoModels: [],
      ttsModels,
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'openai',
      true,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

// ============================================================================
// 5. GOOGLE CLOUD VERTEX AI VEO PUBLISHER MODELS DISCOVERY
// ============================================================================
async function resolveVertexTokenForDiscovery(overrideToken?: string): Promise<string> {
  if (overrideToken?.trim()) return overrideToken.trim();
  const configured = getSettingValue('vertex_access_token', 'GOOGLE_OAUTH_ACCESS_TOKEN');
  if (configured) return configured;

  if (!IS_SERVERLESS) {
    try {
      const { stdout } = await execFileAsync(
        'gcloud',
        ['auth', 'application-default', 'print-access-token'],
        { timeout: 3500 }
      );
      if (stdout && stdout.trim().length > 20) return stdout.trim();
    } catch {
      // ignore
    }
  }
  return '';
}

export async function fetchVertexVeoLiveCatalog(
  params?: {
    projectId?: string;
    location?: string;
    accessToken?: string;
  },
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const projectId =
    params?.projectId?.trim() || getSettingValue('vertex_project_id', 'GOOGLE_CLOUD_PROJECT');
  const location =
    params?.location?.trim() ||
    getSettingValue('vertex_location', 'GOOGLE_CLOUD_LOCATION') ||
    'us-central1';
  const accessToken = projectId
    ? await resolveVertexTokenForDiscovery(params?.accessToken)
    : '';

  if (!projectId || !accessToken) {
    // When Vertex GCP is not configured, check if Gemini API key provides Veo/video models directly
    const geminiCat = await fetchGeminiLiveCatalog(undefined, forceRefresh);
    if (geminiCat.connected && geminiCat.videoModels.length > 0) {
      return {
        provider: 'vertex_veo',
        connected: true,
        fetchedAt: geminiCat.fetchedAt,
        textModels: [],
        imageModels: [],
        videoModels: geminiCat.videoModels,
        ttsModels: [],
      };
    }
    return emptyCatalog('vertex_veo', false);
  }

  const cacheKey = `vertex_veo:${projectId}:${location}:${fingerprintSecret(accessToken)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const url = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=100`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(
        data?.error?.message || `Vertex AI Publisher Models HTTP ${resp.status}`
      );
    }

    const rawModels: any[] = Array.isArray(data?.publisherModels)
      ? data.publisherModels
      : [];
    const videoModels: LiveModelOption[] = [];
    const seen = new Set<string>();

    for (const m of rawModels) {
      const rawName = String(m?.name || '');
      const id = rawName.replace(/^publishers\/google\/models\//, '').trim();
      if (!id || seen.has(id)) continue;
      if (/(^veo|video)/i.test(id)) {
        seen.add(id);
        videoModels.push({
          id,
          label: id,
        });
      }
    }

    // Merge any additional video models from Gemini API if also connected
    const geminiCat = await fetchGeminiLiveCatalog(undefined, false);
    for (const vm of geminiCat.videoModels) {
      if (!seen.has(vm.id)) {
        seen.add(vm.id);
        videoModels.push(vm);
      }
    }

    videoModels.sort((a, b) => scoreModelRecency(b.id) - scoreModelRecency(a.id));

    const catalog: ProviderLiveCatalog = {
      provider: 'vertex_veo',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels: [],
      imageModels: [],
      videoModels,
      ttsModels: [],
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'vertex_veo',
      true,
      sanitizeSecretInError((err as Error).message, accessToken)
    );
  }
}

// ============================================================================
// 6. ELEVENLABS LIVE MODELS & VOICES DISCOVERY (/v1/models & /v1/voices)
// ============================================================================
export async function fetchElevenLabsLiveCatalog(
  apiKeyOverride?: string,
  forceRefresh = false
): Promise<ProviderLiveCatalog> {
  const apiKey =
    apiKeyOverride?.trim() ||
    getSettingValue('elevenlabs_api_key', 'ELEVENLABS_API_KEY');
  if (!apiKey) {
    return emptyCatalog('elevenlabs', false);
  }

  const cacheKey = `elevenlabs:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const [modelsResp, voicesResp] = await Promise.all([
      fetch('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(10000),
      }),
      fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    if (!modelsResp.ok) {
      throw new Error(`ElevenLabs Models API HTTP ${modelsResp.status}`);
    }

    const rawModels = (await modelsResp.json()) as any[];
    const ttsList = (Array.isArray(rawModels) ? rawModels : []).filter(
      (m) => m?.model_id && m?.can_do_text_to_speech !== false
    );

    // Prioritize Thai / multilingual capable latest models dynamically
    ttsList.sort((a, b) => {
      const aTh = Array.isArray(a?.languages) && a.languages.some((l: any) => l?.language_id === 'th') ? 1 : 0;
      const bTh = Array.isArray(b?.languages) && b.languages.some((l: any) => l?.language_id === 'th') ? 1 : 0;
      if (bTh !== aTh) return bTh - aTh;
      return scoreModelRecency(String(b.model_id)) - scoreModelRecency(String(a.model_id));
    });

    const ttsModels: LiveModelOption[] = ttsList.map((m) => ({
      id: String(m.model_id).trim(),
      label: m.name ? `${m.name} (${m.model_id})` : String(m.model_id),
    }));

    let voices: LiveModelOption[] = [];
    if (voicesResp.ok) {
      const vData = (await voicesResp.json()) as any;
      const rawVoices: any[] = Array.isArray(vData?.voices) ? vData.voices : [];
      voices = rawVoices
        .filter((v) => v?.voice_id)
        .map((v) => ({
          id: String(v.voice_id).trim(),
          label: v.name
            ? `${v.name}${v.category ? ` • ${v.category}` : ''}`
            : String(v.voice_id),
        }));
    }

    const catalog: ProviderLiveCatalog = {
      provider: 'elevenlabs',
      connected: true,
      fetchedAt: new Date().toISOString(),
      textModels: [],
      imageModels: [],
      videoModels: [],
      ttsModels,
      voices,
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'elevenlabs',
      true,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

// ============================================================================
// 7. CUSTOM / LOCAL OPENAI-COMPATIBLE ENDPOINT LIVE MODEL DISCOVERY (/models)
// ============================================================================
export async function fetchOpenAiCompatibleLiveCatalog(
  params?: { endpoint?: string; apiKey?: string },
  forceRefresh = false,
  explicitProbe = false
): Promise<ProviderLiveCatalog> {
  const endpoint = (
    params?.endpoint?.trim() || getSettingValue('local_endpoint')
  ).replace(/\/$/, '');
  const apiKey = params?.apiKey?.trim() || getSettingValue('local_api_key');

  if (!endpoint) {
    return emptyCatalog('openai_compatible', false);
  }

  // Avoid hitting localhost on cloud serverless unless explicitly requested
  if (
    IS_SERVERLESS &&
    !explicitProbe &&
    /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(endpoint)
  ) {
    return emptyCatalog('openai_compatible', false);
  }

  const cacheKey = `openai_compatible:${endpoint}:${fingerprintSecret(apiKey)}`;
  if (!forceRefresh) {
    const hit = catalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.catalog;
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const resp = await fetch(`${endpoint}/models`, {
      headers,
      signal: AbortSignal.timeout(3500),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as any;
    const rawList: any[] = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
      ? data.models
      : [];

    const textModels: LiveModelOption[] = rawList
      .map((m) => String(m?.id || m?.name || '').trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id }));

    const catalog: ProviderLiveCatalog = {
      provider: 'openai_compatible',
      connected: textModels.length > 0,
      fetchedAt: new Date().toISOString(),
      textModels,
      imageModels: [],
      videoModels: [],
      ttsModels: [],
    };
    catalogCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, catalog });
    return catalog;
  } catch (err) {
    return emptyCatalog(
      'openai_compatible',
      false,
      sanitizeSecretInError((err as Error).message, apiKey)
    );
  }
}

// ============================================================================
// UNIFIED PARALLEL DISCOVERY & RUNTIME LATEST-MODEL AUTO-RESOLVER
// ============================================================================
export async function fetchAllConfiguredLiveModels(
  forceRefresh = false
): Promise<UnifiedLiveModelsResponse> {
  const [
    gemini,
    claude,
    deepseek,
    openai,
    vertexVeo,
    elevenlabs,
    openaiCompatible,
  ] = await Promise.all([
    fetchGeminiLiveCatalog(undefined, forceRefresh),
    fetchClaudeLiveCatalog(undefined, forceRefresh),
    fetchDeepSeekLiveCatalog(undefined, forceRefresh),
    fetchOpenAiLiveCatalog(undefined, forceRefresh),
    fetchVertexVeoLiveCatalog(undefined, forceRefresh),
    fetchElevenLabsLiveCatalog(undefined, forceRefresh),
    fetchOpenAiCompatibleLiveCatalog(undefined, forceRefresh, false),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    providers: {
      gemini,
      claude,
      deepseek,
      openai,
      vertex_veo: vertexVeo,
      elevenlabs,
      openai_compatible: openaiCompatible,
    },
  };
}

export async function fetchSingleProviderLiveCatalog(params: {
  provider: DiscoverableProvider;
  apiKey?: string;
  endpoint?: string;
  projectId?: string;
  location?: string;
  forceRefresh?: boolean;
}): Promise<ProviderLiveCatalog> {
  const force = params.forceRefresh ?? true;
  switch (params.provider) {
    case 'gemini':
      return fetchGeminiLiveCatalog(params.apiKey, force);
    case 'claude':
      return fetchClaudeLiveCatalog(params.apiKey, force);
    case 'deepseek':
      return fetchDeepSeekLiveCatalog(params.apiKey, force);
    case 'openai':
      return fetchOpenAiLiveCatalog(params.apiKey, force);
    case 'vertex_veo':
      return fetchVertexVeoLiveCatalog(
        {
          projectId: params.projectId,
          location: params.location,
          accessToken: params.apiKey,
        },
        force
      );
    case 'elevenlabs':
      return fetchElevenLabsLiveCatalog(params.apiKey, force);
    case 'openai_compatible':
      return fetchOpenAiCompatibleLiveCatalog(
        { endpoint: params.endpoint, apiKey: params.apiKey },
        force,
        true
      );
  }
}

/**
 * Resolves the active model for a provider + capability purely from live API discovery.
 * - Zero hardcoded model IDs!
 * - If `requestedOrSavedModel` is non-empty AND present in the live catalog, uses it.
 * - Otherwise automatically picks `liveList[0].id` (the newest live model returned by the API).
 */
export async function resolveLatestModel(params: {
  provider: DiscoverableProvider;
  capability: ModelCapability;
  requestedModel?: string;
  apiKeyOverride?: string;
}): Promise<string> {
  const candidate = (params.requestedModel || '').trim();
  const normalizedCandidate =
    candidate === 'auto' || candidate === 'auto_latest' ? '' : candidate;

  const catalog = await fetchSingleProviderLiveCatalog({
    provider: params.provider,
    apiKey: params.apiKeyOverride,
    forceRefresh: false,
  });

  const bucket: LiveModelOption[] =
    params.capability === 'image'
      ? catalog.imageModels
      : params.capability === 'video'
      ? catalog.videoModels
      : params.capability === 'tts'
      ? catalog.ttsModels
      : catalog.textModels;

  if (normalizedCandidate && bucket.some((m) => m.id === normalizedCandidate)) {
    return normalizedCandidate;
  }

  if (bucket.length > 0) {
    return bucket[0].id;
  }

  // If the provider's /models endpoint is restricted by org policy, allow an explicit user-supplied ID
  if (normalizedCandidate) {
    return normalizedCandidate;
  }

  const detail = catalog.error ? ` (${catalog.error})` : '';
  throw new Error(
    `ไม่พบรายชื่อโมเดลประเภท ${params.capability} จาก API ของค่าย ${params.provider} โดยตรง${detail} — กรุณาตรวจสอบว่า API Key มีสิทธิ์เข้าถึงโมเดลประเภทนี้`
  );
}

export async function resolveLatestElevenLabsVoice(
  requestedVoiceId?: string,
  apiKeyOverride?: string
): Promise<string> {
  const candidate = (requestedVoiceId || '').trim();
  const catalog = await fetchElevenLabsLiveCatalog(apiKeyOverride, false);
  const voices = catalog.voices || [];

  if (candidate && voices.some((v) => v.id === candidate)) {
    return candidate;
  }
  if (voices.length > 0) {
    return voices[0].id;
  }
  if (candidate) {
    return candidate;
  }
  throw new Error('ไม่พบรายการเสียงพากย์ (Voices) จาก ElevenLabs API');
}
