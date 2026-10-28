import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import { getSettingValue, UPLOADS_ROOT } from './mediaEngine.ts';

export interface DispatchChannelInput {
  channelKey: string;
  title: string;
  content: string;
  category: string;
  coverImage: string;
  videoUrl: string;
  audioUrl?: string;
  workflowId: number | null;
  postId: number | null;
}

export interface DispatchChannelOutcome {
  channelKey: string;
  channelName: string;
  mode: 'live_api' | 'webhook' | 'internal_live' | 'unconfigured';
  status: 'published' | 'failed';
  externalUrl: string;
  responseNote: string;
  createdPostId?: number | null;
}

function resolveLocalVideoPath(videoUrl?: string): string | null {
  if (!videoUrl) return null;
  const clean = videoUrl.trim();
  if (clean.startsWith('/uploads/')) {
    const abs = path.join(UPLOADS_ROOT, clean.replace(/^\/uploads\//, ''));
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

export async function dispatchSingleChannelReal(
  input: DispatchChannelInput
): Promise<DispatchChannelOutcome> {
  const cfg = db
    .prepare('SELECT * FROM channel_configs WHERE channel_key = ?')
    .get(input.channelKey) as any;

  const chName = cfg ? String(cfg.channel_name) : input.channelKey;
  const token = String(cfg?.access_token || '').trim();
  const targetId = String(cfg?.target_id || '').trim();
  const webhookUrl = String(cfg?.webhook_url || '').trim();
  const now = new Date().toISOString();

  // --------------------------------------------------------------------------
  // 1. WEBSITE / BLOG (Real SQLite Database CRUD Publish)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'website_blog') {
    let targetPostId = input.postId;
    if (!targetPostId) {
      const contentType = input.videoUrl ? 'video' : 'article';
      const pRes = db
        .prepare(
          `INSERT INTO posts (
            title, subtitle, excerpt, content, category, content_type, cover_image,
            video_url, audio_url, tags_json, author, status, is_featured, views, ai_workflow_id, created_at, updated_at
          ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, '["คมคิด by KOMKRIT","Omnichannel"]', 'คมกฤช (Komkrit)', 'published', 0, 1, ?, ?, ?)`
        )
        .run(
          input.title.trim(),
          input.content.replace(/[#>*_`]/g, '').slice(0, 180),
          input.content,
          input.category || 'education',
          contentType,
          input.coverImage || '/images/thumb-ai-edu.jpg',
          input.videoUrl || '',
          input.audioUrl || '',
          input.workflowId,
          now,
          now
        );
      targetPostId = Number(pRes.lastInsertRowid);
    }

    return {
      channelKey: 'website_blog',
      channelName: chName,
      mode: 'internal_live',
      status: 'published',
      externalUrl: `/?post=${targetPostId}`,
      responseNote: `เผยแพร่ขึ้นฐานข้อมูลเว็บไซต์หลักจริงสำเร็จ (Post #${targetPostId})`,
      createdPostId: targetPostId,
    };
  }

  // --------------------------------------------------------------------------
  // PRIORITY WEBHOOK OVERRIDE (Real n8n / Make / Zapier HTTP POST)
  // --------------------------------------------------------------------------
  if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
    const whResp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        channelKey: input.channelKey,
        channelName: chName,
        title: input.title,
        content: input.content,
        category: input.category,
        coverImage: input.coverImage,
        videoUrl: input.videoUrl,
        audioUrl: input.audioUrl || '',
        timestamp: now,
      }),
    });

    if (!whResp.ok) {
      const errBody = await whResp.text();
      return {
        channelKey: input.channelKey,
        channelName: chName,
        mode: 'webhook',
        status: 'failed',
        externalUrl: '',
        responseNote: `Webhook ตอบกลับข้อผิดพลาด HTTP ${whResp.status}: ${errBody.slice(0, 160)}`,
      };
    }

    return {
      channelKey: input.channelKey,
      channelName: chName,
      mode: 'webhook',
      status: 'published',
      externalUrl: cfg?.handle_or_url || '',
      responseNote: `ส่งข้อมูลจริงผ่าน Webhook สำเร็จ (HTTP ${whResp.status})`,
    };
  }

  // --------------------------------------------------------------------------
  // 2. EMAIL / NEWSLETTER (Real Resend Email API Delivery to Subscribers)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'email_newsletter') {
    const resendKey = token || getSettingValue('resend_api_key', 'RESEND_API_KEY');
    const fromEmail =
      targetId ||
      getSettingValue('resend_from_email', 'RESEND_FROM_EMAIL') ||
      'onboarding@resend.dev';

    if (!resendKey) {
      return {
        channelKey: 'email_newsletter',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ตั้งค่า Resend API Key (หรือ Webhook URL) สำหรับส่งอีเมลจริง — กรุณากดไอคอนฟันเฟืองของช่องทาง Email / Newsletter เพื่อใส่ API Key',
      };
    }

    const subs = db
      .prepare('SELECT email, name FROM subscribers ORDER BY id ASC')
      .all() as { email: string; name: string }[];

    if (subs.length === 0) {
      return {
        channelKey: 'email_newsletter',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: 'ไม่มีรายชื่ออีเมลสมาชิกในตาราง Subscribers สำหรับจัดส่ง',
      };
    }

    const htmlBody = `
      <div style="font-family: 'Sarabun', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: #0d2546; color: #ffffff; padding: 24px;">
          <div style="color: #fbbf24; font-weight: bold; font-size: 13px;">คมคิด by KOMKRIT • คิดต่างอย่างสร้างสรรค์</div>
          <h1 style="margin: 8px 0 0; font-size: 22px;">${input.title}</h1>
        </div>
        <div style="padding: 24px; color: #1e293b; line-height: 1.7; white-space: pre-line;">${input.content}</div>
        <div style="background: #f8fafc; padding: 16px 24px; font-size: 12px; color: #64748b;">
          การศึกษาที่ดี สร้างคนที่ดี สร้างสังคมที่ดีได้ • คมคิด by KOMKRIT
        </div>
      </div>
    `;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: subs.map((s) => s.email),
        subject: `[คมคิด by KOMKRIT] ${input.title}`,
        html: htmlBody,
      }),
    });

    const data = (await resp.json()) as any;
    if (!resp.ok) {
      return {
        channelKey: 'email_newsletter',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `Resend Email API Error (HTTP ${resp.status}): ${
          data?.message || JSON.stringify(data).slice(0, 160)
        }`,
      };
    }

    return {
      channelKey: 'email_newsletter',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: '',
      responseNote: `ส่งอีเมลจริงผ่าน Resend API ถึงสมาชิก ${subs.length} คนสำเร็จ (Email ID: ${data?.id || 'OK'})`,
    };
  }

  // --------------------------------------------------------------------------
  // 3. LINE OFFICIAL ACCOUNT (Real LINE Messaging API v2 Broadcast)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'line_oa') {
    if (!token) {
      return {
        channelKey: 'line_oa',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ใส่ LINE Channel Access Token (หรือ Webhook URL) — กรุณาตั้งค่าคีย์จริงก่อนยิง Broadcast',
      };
    }

    const messages: any[] = [
      {
        type: 'text',
        text: `📌 ${input.title}\n\n${input.content.slice(0, 4500)}`,
      },
    ];
    if (input.coverImage && /^https:\/\//i.test(input.coverImage)) {
      messages.push({
        type: 'image',
        originalContentUrl: input.coverImage,
        previewImageUrl: input.coverImage,
      });
    }

    const lineResp = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
    });

    if (!lineResp.ok) {
      const errTxt = await lineResp.text();
      return {
        channelKey: 'line_oa',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `LINE Messaging API ปฏิเสธคำขอ (HTTP ${lineResp.status}): ${errTxt.slice(0, 160)}`,
      };
    }

    return {
      channelKey: 'line_oa',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: '',
      responseNote: 'ส่ง Broadcast จริงผ่าน LINE Messaging API สำเร็จ!',
    };
  }

  // --------------------------------------------------------------------------
  // 4. FACEBOOK PAGE (Real Meta Graph API v21.0)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'facebook') {
    if (!token || !targetId) {
      return {
        channelKey: 'facebook',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ตั้งค่า Facebook Page ID และ Page Access Token (หรือ Webhook URL) — กรุณาตั้งค่าคีย์จริงก่อนโพสต์',
      };
    }

    const fbResp = await fetch(`https://graph.facebook.com/v21.0/${targetId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${input.title}\n\n${input.content}`,
        access_token: token,
      }),
    });

    const fbData = (await fbResp.json()) as any;
    if (!fbResp.ok) {
      return {
        channelKey: 'facebook',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `Facebook Graph API Error (HTTP ${fbResp.status}): ${
          fbData?.error?.message || 'ตรวจสอบ Page Access Token'
        }`,
      };
    }

    return {
      channelKey: 'facebook',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: fbData?.id ? `https://facebook.com/${fbData.id}` : '',
      responseNote: `โพสต์ขึ้น Facebook Page จริงสำเร็จ (Post ID: ${fbData?.id})`,
    };
  }

  // --------------------------------------------------------------------------
  // 5. INSTAGRAM BUSINESS (Real Instagram Graph API v21.0 2-Step Media Publish)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'instagram') {
    if (!token || !targetId) {
      return {
        channelKey: 'instagram',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ตั้งค่า Instagram Business Account ID และ Graph Access Token (หรือ Webhook URL)',
      };
    }

    const publicImage = /^https:\/\//i.test(input.coverImage) ? input.coverImage : '';
    const publicVideo = /^https:\/\//i.test(input.videoUrl) ? input.videoUrl : '';

    if (!publicImage && !publicVideo) {
      return {
        channelKey: 'instagram',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'Instagram Graph API กำหนดให้ต้องแนบ Public HTTPS Image/Video URL (หรือส่งผ่าน Webhook)',
      };
    }

    const containerPayload: Record<string, any> = {
      caption: `${input.title}\n\n${input.content}`.slice(0, 2150),
      access_token: token,
    };
    if (publicVideo) {
      containerPayload.media_type = 'REELS';
      containerPayload.video_url = publicVideo;
    } else {
      containerPayload.image_url = publicImage;
    }

    const step1 = await fetch(`https://graph.facebook.com/v21.0/${targetId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerPayload),
    });
    const s1Json = (await step1.json()) as any;
    if (!step1.ok || !s1Json?.id) {
      return {
        channelKey: 'instagram',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `Instagram Media Container Error: ${
          s1Json?.error?.message || `HTTP ${step1.status}`
        }`,
      };
    }

    const step2 = await fetch(`https://graph.facebook.com/v21.0/${targetId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: s1Json.id,
        access_token: token,
      }),
    });
    const s2Json = (await step2.json()) as any;
    if (!step2.ok) {
      return {
        channelKey: 'instagram',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `Instagram Publish Error: ${
          s2Json?.error?.message || `HTTP ${step2.status}`
        }`,
      };
    }

    return {
      channelKey: 'instagram',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: cfg?.handle_or_url || 'https://instagram.com',
      responseNote: `โพสต์ขึ้น Instagram จริงสำเร็จ (Media ID: ${s2Json?.id})`,
    };
  }

  // --------------------------------------------------------------------------
  // 6. X / TWITTER (Real X API v2 POST /2/tweets)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'x_twitter') {
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `${input.title}\n\n${input.content.slice(0, 190)} #คมคิดbyKOMKRIT`
    )}`;

    if (!token) {
      return {
        channelKey: 'x_twitter',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: intentUrl,
        responseNote:
          'ยังไม่ได้ใส่ X API v2 OAuth2 User Access Token สำหรับโพสต์อัตโนมัติ (สามารถคลิกปุ่ม "เปิดโพสต์บน X.com" เพื่อทวีตด้วยตนเองได้)',
      };
    }

    const tweetText = `${input.title}\n\n${input.content}`.slice(0, 275);
    const xResp = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: tweetText }),
    });

    const xData = (await xResp.json()) as any;
    if (!xResp.ok) {
      return {
        channelKey: 'x_twitter',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: intentUrl,
        responseNote: `X API v2 Error (HTTP ${xResp.status}): ${
          xData?.detail || xData?.title || JSON.stringify(xData).slice(0, 150)
        }`,
      };
    }

    const tweetId = xData?.data?.id;
    return {
      channelKey: 'x_twitter',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: tweetId ? `https://x.com/i/web/status/${tweetId}` : intentUrl,
      responseNote: `โพสต์ขึ้น X (Twitter) จริงผ่าน API v2 สำเร็จ (Tweet ID: ${tweetId})`,
    };
  }

  // --------------------------------------------------------------------------
  // 7. YOUTUBE (Real YouTube Data API v3 Resumable Video Upload)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'youtube') {
    if (!token) {
      return {
        channelKey: 'youtube',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ใส่ Google OAuth2 Access Token (scope: youtube.upload) หรือ Webhook URL สำหรับอัปโหลดวิดีโอขึ้น YouTube จริง',
      };
    }

    const localVid = resolveLocalVideoPath(input.videoUrl);
    if (!localVid) {
      return {
        channelKey: 'youtube',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'การอัปโหลดขึ้น YouTube Data API v3 ต้องแนบไฟล์วิดีโอ .mp4 จริง (สามารถสร้างวิดีโอจริงจาก Google Flow / Veo Studio แล้วเลือกแนบได้ทันที)',
      };
    }

    const videoBytes = fs.readFileSync(localVid);
    const initResp = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(videoBytes.length),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: {
            title: input.title.slice(0, 95),
            description: input.content.slice(0, 4800),
            tags: ['คมคิดbyKOMKRIT', 'การศึกษา', 'AI'],
            categoryId: '27', // Education
          },
          status: {
            privacyStatus: 'public',
          },
        }),
      }
    );

    if (!initResp.ok) {
      const errTxt = await initResp.text();
      return {
        channelKey: 'youtube',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `YouTube Upload Init Error (HTTP ${initResp.status}): ${errTxt.slice(0, 160)}`,
      };
    }

    const uploadUrl = initResp.headers.get('location');
    if (!uploadUrl) {
      return {
        channelKey: 'youtube',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: 'ไม่ได้รับ Resumable Upload URL จาก YouTube Data API v3',
      };
    }

    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(videoBytes.length),
      },
      body: videoBytes,
    });
    const ytJson = (await putResp.json()) as any;
    if (!putResp.ok) {
      return {
        channelKey: 'youtube',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `YouTube Video Upload Error (HTTP ${putResp.status}): ${
          ytJson?.error?.message || 'อัปโหลดไม่สำเร็จ'
        }`,
      };
    }

    return {
      channelKey: 'youtube',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: ytJson?.id ? `https://www.youtube.com/watch?v=${ytJson.id}` : '',
      responseNote: `อัปโหลดวิดีโอ .mp4 ขึ้น YouTube จริงสำเร็จ! (Video ID: ${ytJson?.id})`,
    };
  }

  // --------------------------------------------------------------------------
  // 8. TIKTOK (Real TikTok Content Posting API v2 Direct Video Init & Upload)
  // --------------------------------------------------------------------------
  if (input.channelKey === 'tiktok') {
    if (!token) {
      return {
        channelKey: 'tiktok',
        channelName: chName,
        mode: 'unconfigured',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'ยังไม่ได้ใส่ TikTok Content Posting API v2 Access Token (หรือ Webhook URL) สำหรับโพสต์วิดีโอจริง',
      };
    }

    const localVid = resolveLocalVideoPath(input.videoUrl);
    if (!localVid && !/^https:\/\//i.test(input.videoUrl)) {
      return {
        channelKey: 'tiktok',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote:
          'TikTok Content Posting API ต้องมีไฟล์วิดีโอ .mp4 จริง (สร้างจาก Google Veo / Flow Studio ก่อนส่งเผยแพร่)',
      };
    }

    if (localVid) {
      const videoBytes = fs.readFileSync(localVid);
      const initResp = await fetch(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            post_info: {
              title: `${input.title} #คมคิดbyKOMKRIT`.slice(0, 140),
              privacy_level: 'PUBLIC_TO_EVERYONE',
            },
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: videoBytes.length,
              chunk_size: videoBytes.length,
              total_chunk_count: 1,
            },
          }),
        }
      );

      const initJson = (await initResp.json()) as any;
      if (!initResp.ok || !initJson?.data?.upload_url) {
        return {
          channelKey: 'tiktok',
          channelName: chName,
          mode: 'live_api',
          status: 'failed',
          externalUrl: '',
          responseNote: `TikTok API Init Error (HTTP ${initResp.status}): ${
            initJson?.error?.message || JSON.stringify(initJson).slice(0, 150)
          }`,
        };
      }

      const putResp = await fetch(initJson.data.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(videoBytes.length),
          'Content-Range': `bytes 0-${videoBytes.length - 1}/${videoBytes.length}`,
        },
        body: videoBytes,
      });

      if (!putResp.ok) {
        return {
          channelKey: 'tiktok',
          channelName: chName,
          mode: 'live_api',
          status: 'failed',
          externalUrl: '',
          responseNote: `TikTok Video Upload Error (HTTP ${putResp.status})`,
        };
      }

      return {
        channelKey: 'tiktok',
        channelName: chName,
        mode: 'live_api',
        status: 'published',
        externalUrl: cfg?.handle_or_url || 'https://tiktok.com',
        responseNote: `อัปโหลดวิดีโอขึ้น TikTok จริงสำเร็จ! (Publish ID: ${initJson.data.publish_id})`,
      };
    }

    // PULL_FROM_URL mode
    const pullResp = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: `${input.title} #คมคิดbyKOMKRIT`.slice(0, 140),
            privacy_level: 'PUBLIC_TO_EVERYONE',
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: input.videoUrl,
          },
        }),
      }
    );
    const pullJson = (await pullResp.json()) as any;
    if (!pullResp.ok) {
      return {
        channelKey: 'tiktok',
        channelName: chName,
        mode: 'live_api',
        status: 'failed',
        externalUrl: '',
        responseNote: `TikTok API Error (HTTP ${pullResp.status}): ${
          pullJson?.error?.message || 'ส่งวิดีโอไม่สำเร็จ'
        }`,
      };
    }

    return {
      channelKey: 'tiktok',
      channelName: chName,
      mode: 'live_api',
      status: 'published',
      externalUrl: cfg?.handle_or_url || 'https://tiktok.com',
      responseNote: `โพสต์วิดีโอขึ้น TikTok จริงสำเร็จ (Publish ID: ${pullJson?.data?.publish_id})`,
    };
  }

  return {
    channelKey: input.channelKey,
    channelName: chName,
    mode: 'unconfigured',
    status: 'failed',
    externalUrl: '',
    responseNote: `ไม่พบการตั้งค่า API สำหรับช่องทาง ${chName}`,
  };
}
