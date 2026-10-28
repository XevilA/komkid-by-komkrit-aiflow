import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { db, IS_SERVERLESS } from './db.ts';
import { uploadMediaToCloudBlob } from './cloudSync.ts';

const execFileAsync = promisify(execFile);

export const UPLOADS_ROOT = IS_SERVERLESS
  ? '/tmp/komkrit-uploads'
  : path.resolve(process.cwd(), 'uploads');
const IMAGES_DIR = path.join(UPLOADS_ROOT, 'images');
const VIDEOS_DIR = path.join(UPLOADS_ROOT, 'videos');
const AUDIO_DIR = path.join(UPLOADS_ROOT, 'audio');

for (const dir of [UPLOADS_ROOT, IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getSettingValue(key: string, envFallback?: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row && row.value && row.value.trim()) {
    return row.value.trim();
  }
  if (envFallback && process.env[envFallback]?.trim()) {
    return process.env[envFallback]!.trim();
  }
  return '';
}

async function resolveLocalAssetPath(urlOrPath?: string): Promise<string | null> {
  if (!urlOrPath) return null;
  const clean = urlOrPath.trim();
  if (!clean) return null;
  if (clean.startsWith('data:')) {
    const match = clean.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mime = match[1];
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const tmpPath = path.join(IMAGES_DIR, `inline-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(match[2], 'base64'));
      return tmpPath;
    }
  }
  if (clean.startsWith('https://') || clean.startsWith('http://')) {
    try {
      const parsed = new URL(clean);
      const base = path.basename(parsed.pathname) || `remote-${Date.now()}.bin`;
      const targetDir = base.endsWith('.mp4') || base.endsWith('.mov')
        ? VIDEOS_DIR
        : base.endsWith('.mp3') || base.endsWith('.wav')
        ? AUDIO_DIR
        : IMAGES_DIR;
      const cachedPath = path.join(targetDir, base);
      if (fs.existsSync(cachedPath)) return cachedPath;
      const dl = await fetch(clean);
      if (dl.ok) {
        fs.writeFileSync(cachedPath, Buffer.from(await dl.arrayBuffer()));
        return cachedPath;
      }
    } catch {
      return null;
    }
  }
  if (clean.startsWith('/uploads/')) {
    const abs = path.join(UPLOADS_ROOT, clean.replace(/^\/uploads\//, ''));
    if (fs.existsSync(abs)) return abs;
  }
  if (clean.startsWith('/images/')) {
    const pubAbs = path.resolve(process.cwd(), 'public', clean.replace(/^\//, ''));
    if (fs.existsSync(pubAbs)) return pubAbs;
    const distAbs = path.resolve(process.cwd(), 'dist', clean.replace(/^\//, ''));
    if (fs.existsSync(distAbs)) return distAbs;
  }
  if (fs.existsSync(clean)) {
    return clean;
  }
  return null;
}

function guessMimeType(filePath: string, fallback: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  return fallback;
}

function normalizeGeminiFileUri(uri?: string): string {
  if (!uri) return '';
  const match = uri.match(/files\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://generativelanguage.googleapis.com/files/${match[1]}`;
  }
  return uri.split('?')[0];
}

async function uploadLocalFileToGemini(
  ai: GoogleGenAI,
  localPath: string,
  defaultMime: string
): Promise<{ uri: string; mimeType: string }> {
  const mimeType = guessMimeType(localPath, defaultMime);
  let uploaded = await ai.files.upload({
    file: localPath,
    config: { mimeType },
  });

  // Poll until file finishes processing
  let attempts = 0;
  while (uploaded.state === 'PROCESSING' && attempts < 45) {
    await new Promise((r) => setTimeout(r, 2000));
    if (uploaded.name) {
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    attempts++;
  }

  if (uploaded.state === 'FAILED') {
    throw new Error(`อัปโหลดไฟล์อ้างอิงไปยัง Gemini Files API ไม่สำเร็จ (${path.basename(localPath)})`);
  }

  const uri = normalizeGeminiFileUri(uploaded.uri);
  if (!uri) {
    throw new Error('ไม่ได้รับ File URI จาก Gemini Files API');
  }
  return { uri, mimeType: uploaded.mimeType || mimeType };
}

async function recordMediaAsset(params: {
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
}) {
  let finalFileUrl = params.fileUrl;
  if (IS_SERVERLESS && finalFileUrl.startsWith('/uploads/')) {
    const abs = path.join(UPLOADS_ROOT, finalFileUrl.replace(/^\/uploads\//, ''));
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const cloudUrl = await uploadMediaToCloudBlob(buf, path.basename(abs), params.mimeType);
      if (cloudUrl) {
        finalFileUrl = cloudUrl;
      } else if (params.mediaType === 'image' && buf.length <= 4 * 1024 * 1024) {
        finalFileUrl = `data:${params.mimeType};base64,${buf.toString('base64')}`;
      }
    }
  }

  const now = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO ai_media_assets (
        media_type, provider, model, prompt, file_url, mime_type,
        aspect_ratio, duration_sec, resolution, interaction_id, workflow_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.mediaType,
      params.provider,
      params.model,
      params.prompt,
      finalFileUrl,
      params.mimeType,
      params.aspectRatio || '',
      params.durationSec || 0,
      params.resolution || '',
      params.interactionId || '',
      params.workflowId ?? null,
      now
    );

  return {
    id: Number(res.lastInsertRowid),
    ...params,
    fileUrl: finalFileUrl,
    createdAt: now,
  };
}

// ============================================================================
// 1. REAL AI IMAGE GENERATION (Gemini Nano Banana 2.1 / Gemini 3 Pro Image / OpenAI)
// ============================================================================
export async function generateRealImage(params: {
  prompt: string;
  provider?: 'gemini' | 'openai';
  model?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3';
  imageSize?: '1K' | '2K';
  workflowId?: number | null;
}) {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error('กรุณาระบุ Prompt สำหรับสร้างรูปภาพ');
  }

  const geminiKey = getSettingValue('gemini_api_key', 'GEMINI_API_KEY') || getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');
  const openaiKey = getSettingValue('openai_api_key', 'OPENAI_API_KEY');

  const chosenProvider =
    params.provider || (geminiKey ? 'gemini' : openaiKey ? 'openai' : 'gemini');

  if (chosenProvider === 'gemini') {
    if (!geminiKey) {
      throw new Error(
        'ยังไม่ได้ตั้งค่า Google Gemini API Key สำหรับสร้างภาพจริง (Gemini Nano Banana 2.1) — กรุณาใส่คีย์ในเมนู "ตั้งค่า API Keys & Providers"'
      );
    }

    const model = params.model || 'gemini-nano-banana-2.1';
    const aspectRatio = params.aspectRatio || '16:9';
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const interaction = await ai.interactions.create({
      model,
      input: prompt,
      response_format: {
        type: 'image',
        aspect_ratio: aspectRatio,
        image_size: params.imageSize || '1K',
        mime_type: 'image/png',
      } as any,
    });

    const outImg = interaction.output_image as any;
    let imgBuffer: Buffer | null = null;
    let ext = 'png';
    let mimeType = outImg?.mime_type || 'image/png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      ext = 'jpg';
    }

    if (outImg?.data) {
      imgBuffer = Buffer.from(outImg.data, 'base64');
    } else if (outImg?.uri) {
      const r = await fetch(outImg.uri, {
        headers: { 'x-goog-api-key': geminiKey },
      });
      if (!r.ok) {
        throw new Error(`ดาวน์โหลดรูปภาพจาก Gemini URI ไม่สำเร็จ (HTTP ${r.status})`);
      }
      imgBuffer = Buffer.from(await r.arrayBuffer());
    }

    if (!imgBuffer || imgBuffer.length === 0) {
      throw new Error(
        `โมเดล ${model} ไม่ได้ส่งข้อมูลรูปภาพกลับมา กรุณาตรวจสอบสิทธิ์ API Key หรือปรับ Prompt`
      );
    }

    const filename = `gemini-img-${Date.now()}-${Math.round(Math.random() * 1e4)}.${ext}`;
    const absPath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(absPath, imgBuffer);
    const fileUrl = `/uploads/images/${filename}`;

    return await recordMediaAsset({
      mediaType: 'image',
      provider: 'gemini',
      model,
      prompt,
      fileUrl,
      mimeType,
      aspectRatio,
      interactionId: interaction.id || '',
      workflowId: params.workflowId ?? null,
    });
  }

  // OpenAI Image API (gpt-image-1 / dall-e-3)
  if (!openaiKey) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า OpenAI API Key สำหรับสร้างภาพจริง — กรุณาใส่คีย์ในเมนู "ตั้งค่า API Keys & Providers"'
    );
  }

  const model = params.model || 'dall-e-3';
  const size =
    params.aspectRatio === '9:16'
      ? '1024x1792'
      : params.aspectRatio === '1:1'
      ? '1024x1024'
      : '1792x1024';

  const bodyPayload: Record<string, any> = {
    model,
    prompt,
    n: 1,
    size: model === 'gpt-image-1' ? (params.aspectRatio === '9:16' ? '1024x1536' : params.aspectRatio === '1:1' ? '1024x1024' : '1536x1024') : size,
  };
  if (model !== 'gpt-image-1') {
    bodyPayload.response_format = 'b64_json';
  }

  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(bodyPayload),
  });

  const data = (await resp.json()) as any;
  if (!resp.ok) {
    throw new Error(data?.error?.message || `OpenAI Images API Error (HTTP ${resp.status})`);
  }

  const item = data?.data?.[0];
  let imgBuffer: Buffer;
  if (item?.b64_json) {
    imgBuffer = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const imgResp = await fetch(item.url);
    imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  } else {
    throw new Error('ไม่ได้รับข้อมูลรูปภาพจาก OpenAI Images API');
  }

  const filename = `openai-img-${Date.now()}-${Math.round(Math.random() * 1e4)}.png`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), imgBuffer);
  const fileUrl = `/uploads/images/${filename}`;

  return await recordMediaAsset({
    mediaType: 'image',
    provider: 'openai',
    model,
    prompt,
    fileUrl,
    mimeType: 'image/png',
    aspectRatio: params.aspectRatio || '16:9',
    workflowId: params.workflowId ?? null,
  });
}

// ============================================================================
// 2. REAL GOOGLE VEO & GEMINI OMNI 1.1 FLASH VIDEO GENERATION
// ============================================================================
async function getVertexAccessToken(): Promise<string> {
  const configuredToken = getSettingValue('vertex_access_token', 'GOOGLE_OAUTH_ACCESS_TOKEN');
  if (configuredToken) return configuredToken;

  // On Google Cloud Run / GCE, automatically fetch Service Account token from GCP Metadata Server
  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500),
      }
    );
    if (metaRes.ok) {
      const metaJson: any = await metaRes.json();
      if (metaJson?.access_token) return String(metaJson.access_token);
    }
  } catch {
    // not running on GCP metadata environment
  }

  // Attempt real gcloud ADC / CLI access token if gcloud is authenticated locally
  try {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'application-default', 'print-access-token'], {
      timeout: 6000,
    });
    if (stdout && stdout.trim().length > 20) return stdout.trim();
  } catch {
    // fallback to standard gcloud auth print-access-token
  }

  try {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token'], {
      timeout: 6000,
    });
    if (stdout && stdout.trim().length > 20) return stdout.trim();
  } catch {
    // ignore
  }

  return '';
}

export async function generateRealVideo(params: {
  prompt: string;
  engine?: 'gemini-omni-1.1-flash' | 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001' | 'veo-3.0-generate-001';
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
}) {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error('กรุณาระบุ Prompt สำหรับสร้างวิดีโอจริง');
  }

  const engine = params.engine || 'gemini-omni-1.1-flash';
  const aspectRatio = params.aspectRatio || '16:9';
  const resolution = params.resolution || '720p';
  const durationSec = Math.min(10, Math.max(3, Math.round(Number(params.durationSec) || 6)));

  // --------------------------------------------------------------------------
  // ROUTE A: Google Veo 3.1 / 3.0 GA on Vertex AI Enterprise (predictLongRunning)
  // --------------------------------------------------------------------------
  if (engine.startsWith('veo-')) {
    const projectId = getSettingValue('vertex_project_id', 'GOOGLE_CLOUD_PROJECT');
    const location = getSettingValue('vertex_location', 'GOOGLE_CLOUD_LOCATION') || 'us-central1';
    const accessToken = await getVertexAccessToken();

    if (!projectId || !accessToken) {
      throw new Error(
        `สำหรับการเรียกโมเดล Enterprise "${engine}" บน Google Cloud Vertex AI ต้องระบุ GCP Project ID และ Vertex OAuth Access Token (หรือล็อกอิน gcloud ADC) ในหน้าตั้งค่า API Keys — หรือสลับไปใช้ "Gemini Omni 1.1 Flash (Google Video API)" ซึ่งใช้เพียง GEMINI_API_KEY คีย์เดียวได้ทันที!`
      );
    }

    const instance: Record<string, any> = { prompt };

    const firstAbs = await resolveLocalAssetPath(params.firstFrameUrl);
    if (firstAbs) {
      instance.image = {
        bytesBase64Encoded: fs.readFileSync(firstAbs).toString('base64'),
        mimeType: guessMimeType(firstAbs, 'image/png'),
      };
    }

    const lastAbs = await resolveLocalAssetPath(params.lastFrameUrl);
    if (lastAbs) {
      instance.lastFrame = {
        bytesBase64Encoded: fs.readFileSync(lastAbs).toString('base64'),
        mimeType: guessMimeType(lastAbs, 'image/png'),
      };
    }

    const endpointBase = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${engine}`;
    const startResp = await fetch(`${endpointBase}:predictLongRunning`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio,
          sampleCount: 1,
          durationSeconds: durationSec >= 7 ? 8 : durationSec >= 5 ? 6 : 4,
          resolution: resolution === '1080p' ? '1080p' : '720p',
          generateAudio: true,
        },
      }),
    });

    const startJson = (await startResp.json()) as any;
    if (!startResp.ok) {
      throw new Error(
        startJson?.error?.message || `Google Veo Vertex AI Error (HTTP ${startResp.status})`
      );
    }

    const operationName = startJson?.name;
    if (!operationName) {
      throw new Error('ไม่ได้รับ Operation Name จาก Google Veo predictLongRunning');
    }

    // Poll fetchPredictOperation until done
    let opDone = false;
    let opResult: any = null;
    for (let poll = 0; poll < 75; poll++) {
      await new Promise((r) => setTimeout(r, 8000));
      const pollResp = await fetch(`${endpointBase}:fetchPredictOperation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ operationName }),
      });
      const pollJson = (await pollResp.json()) as any;
      if (!pollResp.ok) {
        throw new Error(
          pollJson?.error?.message || `Veo Polling Error (HTTP ${pollResp.status})`
        );
      }
      if (pollJson.done) {
        opDone = true;
        opResult = pollJson;
        break;
      }
    }

    if (!opDone || !opResult) {
      throw new Error('Google Veo ใช้เวลาประมวลผลเกินกำหนด (Timeout)');
    }
    if (opResult.error) {
      throw new Error(opResult.error.message || JSON.stringify(opResult.error));
    }

    const vidObj =
      opResult?.response?.videos?.[0] || opResult?.response?.generatedVideos?.[0]?.video;
    if (!vidObj) {
      throw new Error('Google Veo ประมวลผลเสร็จแต่ไม่พบไฟล์วิดีโอในผลลัพธ์');
    }

    const filename = `veo-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
    const outAbsPath = path.join(VIDEOS_DIR, filename);

    if (vidObj.bytesBase64Encoded) {
      fs.writeFileSync(outAbsPath, Buffer.from(vidObj.bytesBase64Encoded, 'base64'));
    } else if (vidObj.gcsUri || vidObj.uri) {
      const rawUri: string = vidObj.gcsUri || vidObj.uri;
      const httpUrl = rawUri.startsWith('gs://')
        ? `https://storage.googleapis.com/${rawUri.slice(5)}`
        : rawUri;
      const dl = await fetch(httpUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!dl.ok) {
        throw new Error(`ดาวน์โหลดไฟล์วิดีโอ Veo จาก ${rawUri} ไม่สำเร็จ (HTTP ${dl.status})`);
      }
      fs.writeFileSync(outAbsPath, Buffer.from(await dl.arrayBuffer()));
    } else {
      throw new Error('ไม่พบ bytesBase64Encoded หรือ URI ในผลลัพธ์จาก Google Veo');
    }

    return recordMediaAsset({
      mediaType: 'video',
      provider: 'google-veo-vertex',
      model: engine,
      prompt,
      fileUrl: `/uploads/videos/${filename}`,
      mimeType: 'video/mp4',
      aspectRatio,
      durationSec,
      resolution,
      interactionId: operationName,
      workflowId: params.workflowId ?? null,
    });
  }

  // --------------------------------------------------------------------------
  // ROUTE B: Gemini Omni 1.1 Flash via Official @google/genai Interactions API
  // (Supports Text-to-Video, First-Frame, First+Last Frame Flow Transitions,
  // Reference Ingredients, and Multi-Turn Video Extension up to 40s!)
  // --------------------------------------------------------------------------
  const geminiKey =
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') ||
    getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');

  if (!geminiKey) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า Google Gemini API Key สำหรับสร้างวิดีโอจริง (Gemini Omni 1.1 Flash / Google Flow) — กรุณาใส่คีย์ในเมนู "ตั้งค่า API Keys & Providers"'
    );
  }

  if (params.lastFrameUrl && !params.firstFrameUrl) {
    throw new Error('การกำหนด Last Frame Transition ต้องระบุ First Frame (ภาพเริ่มต้น) คู่กันเสมอ');
  }

  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: { timeout: 600_000 },
  });

  const inputParts: any[] = [];

  // 1. Optional First Frame (<FIRST_FRAME>)
  const firstAbs = await resolveLocalAssetPath(params.firstFrameUrl);
  let firstUploaded: { uri: string; mimeType: string } | null = null;
  if (firstAbs) {
    firstUploaded = await uploadLocalFileToGemini(ai, firstAbs, 'image/png');
    inputParts.push({
      type: 'image',
      uri: firstUploaded.uri,
      mime_type: firstUploaded.mimeType,
    });
  }

  // 2. Optional Last Frame (<LAST_FRAME>) for Google Flow Frame-to-Frame Transition
  const lastAbs = await resolveLocalAssetPath(params.lastFrameUrl);
  if (lastAbs && firstUploaded) {
    if (lastAbs === firstAbs) {
      inputParts.push({
        type: 'image',
        uri: firstUploaded.uri,
        mime_type: firstUploaded.mimeType,
      });
    } else {
      const lastUploaded = await uploadLocalFileToGemini(ai, lastAbs, 'image/png');
      inputParts.push({
        type: 'image',
        uri: lastUploaded.uri,
        mime_type: lastUploaded.mimeType,
      });
    }
  }

  // 3. Optional Ingredient Reference Images (<IMAGE_REF_0>, ...)
  const refUrls = Array.isArray(params.referenceImageUrls)
    ? params.referenceImageUrls.filter(Boolean)
    : [];
  const uploadedRefCount: number[] = [];
  for (const rUrl of refUrls) {
    const refAbs = await resolveLocalAssetPath(rUrl);
    if (refAbs) {
      const up = await uploadLocalFileToGemini(ai, refAbs, 'image/png');
      inputParts.push({
        type: 'image',
        uri: up.uri,
        mime_type: up.mimeType,
      });
      uploadedRefCount.push(1);
    }
  }

  // 4. Optional Video Extension Source (<VIDEO_0>)
  const extendAbs = await resolveLocalAssetPath(params.extendVideoUrl);
  let tempStrippedVideo: string | null = null;
  try {
    if (extendAbs) {
      let targetVideoPath = extendAbs;
      if (params.stripAudio) {
        tempStrippedVideo = path.join(
          VIDEOS_DIR,
          `temp-stripped-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`
        );
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          extendAbs,
          '-c:v',
          'copy',
          '-an',
          tempStrippedVideo,
        ]);
        targetVideoPath = tempStrippedVideo;
      }
      const extUp = await uploadLocalFileToGemini(ai, targetVideoPath, 'video/mp4');
      inputParts.push({
        type: 'video',
        uri: extUp.uri,
        mime_type: extUp.mimeType,
      });
    }
  } finally {
    if (tempStrippedVideo && fs.existsSync(tempStrippedVideo)) {
      try {
        fs.unlinkSync(tempStrippedVideo);
      } catch {
        // ignore
      }
    }
  }

  // 5. Build Role-Tagged Prompt per Official Gemini Omni 1.1 Flash Spec
  let formattedPrompt = prompt;
  if (!prompt.includes('[# Sources') && !prompt.includes('[# References')) {
    if (extendAbs) {
      const sourcesTag = '[# Sources <VIDEO_0>@Video1]';
      if (uploadedRefCount.length > 0) {
        const startImgIdx = (lastAbs ? 2 : firstAbs ? 1 : 0) + 1;
        const refs = uploadedRefCount
          .map((_, idx) => `<IMAGE_REF_${idx}>@Image${startImgIdx + idx}`)
          .join(' ');
        formattedPrompt = `${sourcesTag} [# References ${refs}] ${prompt}`;
      } else {
        formattedPrompt = `${sourcesTag} ${prompt}`;
      }
    } else if (firstAbs && lastAbs) {
      if (!prompt.includes('<FIRST_FRAME>') && !prompt.includes('<LAST_FRAME>')) {
        formattedPrompt = `<FIRST_FRAME> <LAST_FRAME> ${prompt}`;
      }
    } else if (firstAbs) {
      if (!prompt.includes('<FIRST_FRAME>')) {
        formattedPrompt = `<FIRST_FRAME> ${prompt}`;
      }
    }
  }

  inputParts.push({
    type: 'text',
    text: formattedPrompt,
  });

  const videoResponseFormat: Record<string, any> = {
    type: 'video',
    delivery: 'uri',
    duration: `${durationSec}s`,
    resolution,
  };
  if (!extendAbs) {
    videoResponseFormat.aspect_ratio = aspectRatio;
  }

  const createPayload: Record<string, any> = {
    model: 'gemini-omni-1.1-flash',
    input: inputParts,
    response_format: videoResponseFormat,
  };
  if (params.previousInteractionId) {
    createPayload.previous_interaction_id = params.previousInteractionId;
  }

  const interaction = await ai.interactions.create(createPayload as any);
  const outVid = interaction.output_video as any;
  if (!outVid || (!outVid.uri && !outVid.data)) {
    throw new Error(
      'โมเดลวิดีโอไม่ได้ส่งไฟล์วิดีโอกลับมา กรุณาตรวจสอบสิทธิ์โควต้าวิดีโอของ GEMINI_API_KEY หรือปรับ Prompt'
    );
  }

  const filename = `omni-flow-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
  const outAbsPath = path.join(VIDEOS_DIR, filename);

  if (outVid.data) {
    fs.writeFileSync(outAbsPath, Buffer.from(outVid.data, 'base64'));
  } else if (outVid.uri) {
    try {
      await ai.files.download({
        file: outVid.uri,
        downloadPath: outAbsPath,
      });
    } catch {
      // Direct authenticated REST fallback if URI requires x-goog-api-key header
      const dlResp = await fetch(outVid.uri, {
        headers: { 'x-goog-api-key': geminiKey },
      });
      if (!dlResp.ok) {
        throw new Error(`ดาวน์โหลดไฟล์วิดีโอจาก Gemini API ไม่สำเร็จ (HTTP ${dlResp.status})`);
      }
      fs.writeFileSync(outAbsPath, Buffer.from(await dlResp.arrayBuffer()));
    }
  }

  return recordMediaAsset({
    mediaType: 'video',
    provider: 'google-gemini-omni',
    model: 'gemini-omni-1.1-flash',
    prompt,
    fileUrl: `/uploads/videos/${filename}`,
    mimeType: 'video/mp4',
    aspectRatio,
    durationSec,
    resolution,
    interactionId: interaction.id || '',
    workflowId: params.workflowId ?? null,
  });
}

// ============================================================================
// 3. GOOGLE FLOW MULTI-SCENE TIMELINE STITCHER (Real Local FFmpeg Assembly!)
// ============================================================================
export async function stitchFlowScenesWithFfmpeg(params: {
  sceneVideoUrls: string[];
  aspectRatio?: '16:9' | '9:16';
  voiceoverAudioUrl?: string;
  projectTitle?: string;
}): Promise<{ masterVideoUrl: string; clipCount: number }> {
  const resolvedList = await Promise.all(
    params.sceneVideoUrls.map((u) => resolveLocalAssetPath(u))
  );
  const localPaths = resolvedList.filter((p): p is string => Boolean(p && fs.existsSync(p)));

  if (localPaths.length === 0) {
    throw new Error('ยังไม่มีคลิปวิดีโอฉากที่สร้างเสร็จสำหรับนำมาตัดต่อรวม (Assemble Film)');
  }

  const isPortrait = params.aspectRatio === '9:16';
  const targetW = isPortrait ? 720 : 1280;
  const targetH = isPortrait ? 1280 : 720;

  const normalizedFiles: string[] = [];
  const concatListPath = path.join(VIDEOS_DIR, `concat-list-${Date.now()}.txt`);
  const stitchedRawPath = path.join(VIDEOS_DIR, `flow-stitched-${Date.now()}.mp4`);
  const finalFilename = `flow-master-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp4`;
  const finalOutPath = path.join(VIDEOS_DIR, finalFilename);

  try {
    // Normalize each scene clip to uniform resolution, fps, pixel format, and audio stream
    for (let i = 0; i < localPaths.length; i++) {
      const src = localPaths[i];
      const normPath = path.join(VIDEOS_DIR, `temp-norm-${Date.now()}-${i}.mp4`);
      // Probe if source clip has an audio stream
      let hasAudio = false;
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'a',
          '-show_entries',
          'stream=codec_type',
          '-of',
          'csv=p=0',
          src,
        ]);
        hasAudio = stdout.trim().length > 0;
      } catch {
        hasAudio = false;
      }

      const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;

      if (hasAudio) {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          src,
          '-vf',
          vf,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '21',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          normPath,
        ]);
      } else {
        await execFileAsync('ffmpeg', [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-i',
          src,
          '-shortest',
          '-vf',
          vf,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '21',
          '-c:a',
          'aac',
          '-map',
          '1:v:0',
          '-map',
          '0:a:0',
          normPath,
        ]);
      }
      normalizedFiles.push(normPath);
    }

    const listBody = normalizedFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(concatListPath, listBody, 'utf-8');

    const voiceoverAbs = await resolveLocalAssetPath(params.voiceoverAudioUrl);
    if (voiceoverAbs && fs.existsSync(voiceoverAbs)) {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c',
        'copy',
        stitchedRawPath,
      ]);
      // Mix/replace master voiceover narration with background video audio
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        stitchedRawPath,
        '-i',
        voiceoverAbs,
        '-filter_complex',
        '[0:a]volume=0.25[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=longest:dropout_transition=2[aout]',
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        finalOutPath,
      ]);
    } else {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c',
        'copy',
        finalOutPath,
      ]);
    }

    const masterAsset = await recordMediaAsset({
      mediaType: 'video',
      provider: 'google-flow-ffmpeg',
      model: 'flow-master-timeline',
      prompt: params.projectTitle || `Google Flow Master Film (${localPaths.length} scenes)`,
      fileUrl: `/uploads/videos/${finalFilename}`,
      mimeType: 'video/mp4',
      aspectRatio: params.aspectRatio || '16:9',
    });

    return {
      masterVideoUrl: masterAsset.fileUrl,
      clipCount: localPaths.length,
    };
  } finally {
    for (const f of [...normalizedFiles, concatListPath, stitchedRawPath]) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {
          // ignore
        }
      }
    }
  }
}

// ============================================================================
// 4. REAL AI SPEECH / AUDIO TTS GENERATION (Gemini 3.8 Flash TTS / OpenAI / ElevenLabs)
// ============================================================================
export async function generateRealAudio(params: {
  text: string;
  provider?: 'gemini' | 'openai' | 'elevenlabs';
  voice?: string;
  style?: string;
  workflowId?: number | null;
}) {
  const rawText = params.text?.trim();
  if (!rawText) {
    throw new Error('กรุณาระบุข้อความบทพากย์สำหรับสร้างเสียงจริง');
  }
  // Strip stage cue brackets like [น้ำเสียงอบอุ่น] so TTS reads clean spoken text
  const cleanTranscript = rawText.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

  const geminiKey =
    getSettingValue('gemini_api_key', 'GEMINI_API_KEY') ||
    getSettingValue('gemini_api_key', 'GOOGLE_API_KEY');
  const openaiKey = getSettingValue('openai_api_key', 'OPENAI_API_KEY');
  const elevenKey = getSettingValue('elevenlabs_api_key', 'ELEVENLABS_API_KEY');

  const chosenProvider =
    params.provider ||
    (geminiKey ? 'gemini' : elevenKey ? 'elevenlabs' : openaiKey ? 'openai' : 'gemini');

  if (chosenProvider === 'gemini') {
    if (!geminiKey) {
      throw new Error(
        'ยังไม่ได้ตั้งค่า Google Gemini API Key สำหรับสร้างเสียงพากย์จริง (Gemini 3.8 Flash TTS รองรับภาษาไทย) — กรุณาใส่คีย์ในหน้าตั้งค่า API Keys'
      );
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const voiceName = params.voice || 'Kore';
    const deliveryStyle =
      params.style || 'warm, articulate, inspiring Thai educator and executive speaker';

    const interaction = await ai.interactions.create({
      model: 'gemini-3.8-flash-tts',
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: cleanTranscript,
              annotations: [
                {
                  type: 'speech_metadata',
                  speaker: 'Komkrit',
                  style: deliveryStyle,
                },
              ],
            },
          ],
        },
      ] as any,
      response_format: { type: 'audio' } as any,
      generation_config: {
        speech_config: {
          speakers: [{ speaker: 'Komkrit', voice: voiceName }],
        },
      } as any,
    });

    const outAudio = interaction.output_audio as any;
    if (!outAudio?.data) {
      throw new Error('Gemini 3.8 Flash TTS ไม่ได้ส่งข้อมูลเสียงกลับมา');
    }

    const audioBuffer = Buffer.from(outAudio.data, 'base64');
    const filename = `tts-gemini-${Date.now()}-${Math.round(Math.random() * 1e4)}.wav`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), audioBuffer);
    const fileUrl = `/uploads/audio/${filename}`;

    return recordMediaAsset({
      mediaType: 'audio',
      provider: 'gemini',
      model: `gemini-3.8-flash-tts (${voiceName})`,
      prompt: cleanTranscript.slice(0, 300),
      fileUrl,
      mimeType: 'audio/wav',
      interactionId: interaction.id || '',
      workflowId: params.workflowId ?? null,
    });
  }

  if (chosenProvider === 'elevenlabs') {
    if (!elevenKey) {
      throw new Error(
        'ยังไม่ได้ตั้งค่า ElevenLabs API Key สำหรับสร้างเสียงพากย์จริง — กรุณาใส่คีย์ในหน้าตั้งค่า API Keys'
      );
    }
    const voiceId = params.voice || getSettingValue('elevenlabs_voice_id') || 'JBFqnCBsd6RMkjVDRZzb';
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenKey,
      },
      body: JSON.stringify({
        text: cleanTranscript,
        model_id: 'eleven_multilingual_v2',
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(`ElevenLabs TTS API Error (HTTP ${resp.status}): ${errTxt.slice(0, 200)}`);
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    const filename = `tts-eleven-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp3`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), audioBuffer);
    const fileUrl = `/uploads/audio/${filename}`;

    return recordMediaAsset({
      mediaType: 'audio',
      provider: 'elevenlabs',
      model: `eleven_multilingual_v2 (${voiceId})`,
      prompt: cleanTranscript.slice(0, 300),
      fileUrl,
      mimeType: 'audio/mpeg',
      workflowId: params.workflowId ?? null,
    });
  }

  // OpenAI Speech API
  if (!openaiKey) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า OpenAI API Key สำหรับสร้างเสียงพากย์จริง — กรุณาใส่คีย์ในหน้าตั้งค่า API Keys'
    );
  }
  const voice = params.voice || 'alloy';
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice,
      input: cleanTranscript,
      response_format: 'mp3',
    }),
  });

  if (!resp.ok) {
    const errTxt = await resp.text();
    throw new Error(`OpenAI TTS API Error (HTTP ${resp.status}): ${errTxt.slice(0, 200)}`);
  }

  const audioBuffer = Buffer.from(await resp.arrayBuffer());
  const filename = `tts-openai-${Date.now()}-${Math.round(Math.random() * 1e4)}.mp3`;
  fs.writeFileSync(path.join(AUDIO_DIR, filename), audioBuffer);
  const fileUrl = `/uploads/audio/${filename}`;

  return recordMediaAsset({
    mediaType: 'audio',
    provider: 'openai',
    model: `gpt-4o-mini-tts (${voice})`,
    prompt: cleanTranscript.slice(0, 300),
    fileUrl,
    mimeType: 'audio/mpeg',
    workflowId: params.workflowId ?? null,
  });
}
