import { db } from './db.ts';

/** Persists one finished multi-agent run as a campaign awaiting human approval. */
export function createWorkflowRecord(
  input: {
    topic: string;
    inputSource: string;
    category: string;
    targetAudience: string;
    businessPillar: string;
    flowMode: 'core_3agent' | 'full_8agent';
  },
  result: {
    engineUsed: string;
    ceoOutput: unknown;
    researchOutput: unknown;
    scriptOutput: unknown;
    designOutput: unknown;
    visualOutput: unknown;
    videoOutput: unknown;
    audioOutput: unknown;
    qaOutput: unknown;
    analyticsOutput: unknown;
    omnichannelOutput: unknown;
  }
): number {
  const now = new Date().toISOString();
  const initialApproval = {
    isAccurate: true,
    isAppropriate: true,
    isOnBrand: true,
    isReady: false,
    reviewerNote: '',
    publishedPostId: null,
  };

  const insertRes = db
    .prepare(
      `INSERT INTO ai_workflows (
        topic, input_source, category, target_audience, business_pillar,
        flow_mode, engine_used, status,
        ceo_json, research_json, script_json, design_json, visual_json,
        video_json, audio_json, qa_json, analytics_json, omnichannel_json, approval_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.topic,
      input.inputSource,
      input.category,
      input.targetAudience,
      input.businessPillar,
      input.flowMode,
      result.engineUsed,
      JSON.stringify(result.ceoOutput),
      JSON.stringify(result.researchOutput),
      JSON.stringify(result.scriptOutput),
      JSON.stringify(result.designOutput),
      JSON.stringify(result.visualOutput),
      JSON.stringify(result.videoOutput),
      JSON.stringify(result.audioOutput),
      JSON.stringify(result.qaOutput),
      JSON.stringify(result.analyticsOutput),
      JSON.stringify(result.omnichannelOutput),
      JSON.stringify(initialApproval),
      now,
      now
    );
  return Number(insertRes.lastInsertRowid);
}
