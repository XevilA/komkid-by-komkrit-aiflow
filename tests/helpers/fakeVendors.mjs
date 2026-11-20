// Network boundary for end-to-end tests of the agent harness (preloaded with --import).
// It speaks the vendors' wire protocols (DeepSeek chat, OpenAI models/images) so the REAL
// orchestrator, tools, database and publishing code run unchanged. The "LLM" here answers
// according to which agent is calling (identified from its system prompt).
import fs from 'node:fs';
const LOG = process.env.FAKE_LOG;
const realFetch = globalThis.fetch;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const log = (line) => { if (LOG) fs.appendFileSync(LOG, line + '\n'); };
const ctrl = () => { try { return fs.readFileSync(process.env.FAKE_CTRL || '', 'utf8'); } catch { return ''; } };

const ARTICLE = (topic) =>
  `## ภาพรวมของ${topic}\n` + `เนื้อหาส่วนแรกอธิบายภาพรวมและบริบทของเรื่องนี้อย่างละเอียด เพื่อให้ผู้อ่านเข้าใจพื้นฐานก่อนลงรายละเอียด `.repeat(3) +
  `\n\n## แนวทางปฏิบัติ\n` + `ส่วนนี้เสนอแนวทางที่นำไปใช้ได้จริงในโรงเรียน พร้อมตัวอย่างขั้นตอนทีละข้อ `.repeat(3) +
  `\n\n## สรุป\nสรุปประเด็นสำคัญและข้อเสนอแนะสำหรับผู้อ่าน ${'ข้อความสรุป '.repeat(10)}`;

function chatText(system, user) {
  const topic = (user.match(/โจทย์: (.*)/) || user.match(/หัวข้อ: (.*)/) || [])[1] || 'หัวข้อทดสอบ';
  if (system.includes('คุณคือ CEO Agent')) {
    const msg = (user.match(/คำสั่งล่าสุดของผู้ใช้: (.*)/) || [])[1] || '';
    const obs = user.includes('ผลของทักษะที่เพิ่งรันในรอบนี้');
    const hasDraft = !user.includes('"draft": null');
    const canPublish = user.includes('สิทธิ์เผยแพร่ในรอบนี้: ได้');
    if (user.includes('บทเรียนจากงานก่อนหน้า') && !user.includes('(ยังไม่มี)\n\nบทสนทนา')) log('ceo-saw-learning');
    if (/ตรวจข้อเท็จจริง/.test(msg) && hasDraft) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'ตรวจข้อเท็จจริงแล้ว' } : { thought: 'fact-check', calls: [{ tool: 'fact_check', args: {} }], done: false, reply: '' };
    }
    if (/สคริปต์/.test(msg) && hasDraft) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'เขียนสคริปต์แล้ว' } : { thought: 'script', calls: [{ tool: 'video_script', args: {} }], done: false, reply: '' };
    }
    if (/ผลิต|วิดีโอ/.test(msg) && hasDraft) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'ดำเนินการผลิตแล้ว' } : { thought: 'produce', calls: [{ tool: 'video_script', args: {} }, { tool: 'produce_clips', args: {} }], done: false, reply: '' };
    }
    if (/วิเคราะห์ผล/.test(msg)) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'วิเคราะห์ผลแล้ว' } : { thought: 'analytics', calls: [{ tool: 'analyze_performance', args: {} }], done: false, reply: '' };
    }
    if (/ลบ/.test(msg)) {
      const id = (msg.match(/\d+/) || ['1'])[0];
      return obs ? { thought: 'x', calls: [], done: true, reply: 'ส่งคำขอลบให้ยืนยันแล้ว' } : { thought: 'ลบ', calls: [{ tool: 'delete_post', args: { postId: Number(id) } }], done: false, reply: '' };
    }
    if (/เผยแพร่/.test(msg) && canPublish) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'เผยแพร่เรียบร้อยแล้ว' } : { thought: 'ขอเผยแพร่', calls: [{ tool: 'save_post', args: { status: 'published' } }], done: false, reply: '' };
    }
    if (/ปก|รูป/.test(msg) && hasDraft) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'ใส่รูปปกให้แล้ว' } : { thought: 'ทำรูปปก', calls: [{ tool: 'generate_cover', args: {} }], done: false, reply: '' };
    }
    if (/แก้|ปรับ/.test(msg) && hasDraft) {
      return obs ? { thought: 'x', calls: [], done: true, reply: 'แก้ไขแล้ว' } : { thought: 'แก้', calls: [{ tool: 'revise_draft', args: { instruction: msg } }], done: false, reply: '' };
    }
    if (/เขียน|ร่าง/.test(msg)) {
      return obs
        ? { thought: 'x', calls: [], done: true, reply: 'ร่างบทความเสร็จแล้ว' }
        : { thought: 'ค้นคว้าแล้วเขียน', calls: [{ tool: 'research', args: { query: msg } }, { tool: 'write_draft', args: { instruction: msg } }], done: false, reply: '' };
    }
    return { thought: 'ตอบ', calls: [], done: true, reply: 'รับทราบครับ' };
  }
  if (system.includes('Research Agent')) {
    return { summary: `สรุปผลค้นคว้าเรื่อง ${topic}`, facts: ['ข้อเท็จจริงจากฐานความรู้ 1', 'ข้อเท็จจริง 2'], angles: ['มุมมองครู'], gaps: [] };
  }
  if (system.includes('Writer Agent (บรรณาธิการ)')) {
    return { title: `บทความ: ${topic.slice(0, 40)}`, subtitle: 'คำโปรยทดสอบ', excerpt: 'สรุปสองประโยคสำหรับบทความทดสอบ', category: 'education', contentType: 'article', content: ARTICLE(topic.slice(0, 30)), tags: ['การศึกษา', 'ทดสอบ'], slug: 'test-article-slug', suggestedImagePrompt: 'Editorial 16:9 photo', suggestedVideoPrompt: 'Short video' };
  }
  if (system.includes('Writer Agent แก้ไขบทความ')) {
    const cur = JSON.parse(user.slice(user.lastIndexOf('{')));
    return { title: cur.title, subtitle: cur.subtitle, excerpt: cur.excerpt, content: cur.content + '\n\n## เพิ่มเติม\nย่อหน้าที่เพิ่มตามคำสั่งแก้ไข ' + 'ข้อความ '.repeat(20), tags: cur.tags };
  }
  if (system.includes('Fact-check Agent')) {
    const c = ctrl();
    const claims = c.includes('fc-unsupported')
      ? [1, 2, 3].map((i) => ({ text: `ข้ออ้างเท็จ ${i}`, verdict: 'unsupported', evidence: 'ขัดแย้งกับหลักฐาน' }))
      : c.includes('fc-revise')
      ? [{ text: 'ข้ออ้างไม่มีหลักฐาน', verdict: 'unsupported', evidence: '' }, { text: 'ข้ออ้างที่ยืนยันได้', verdict: 'supported', evidence: 'ตรงกับ KB' }]
      : [{ text: 'ข้ออ้างที่ยืนยันได้ 1', verdict: 'supported', evidence: 'ตรงกับ KB' }, { text: 'ข้ออ้างที่ยืนยันได้ 2', verdict: 'supported', evidence: 'ผลค้นคว้า' }, { text: 'ตัวเลขที่ไม่มีหลักฐาน', verdict: 'unverifiable', evidence: '' }];
    return { claims, neutrality: { score: 88, notes: 'เป็นกลาง' }, summary: 'ตรวจครบ' };
  }
  if (system.includes('Video Script Agent')) {
    return { clips: [1, 2, 3].map((i) => ({ title: `คลิป ${i}`, durationSec: 8, narration: `บทพูดคลิป ${i} สั้นๆ`, subtitle: `คำบรรยาย ${i}`, visualPrompt: `Presenter scene ${i}` })) };
  }
  if (system.includes('Analytics & Learning Agent')) {
    log('analytics saw: ' + (user.includes('"views":') ? 'metrics' : 'none'));
    return { summary: 'บทความได้รับความสนใจจากผู้อ่านตามตัวเลขจริง', whatWorked: ['หัวข้อตรงประเด็น'], toImprove: ['เพิ่มตัวอย่างจริง'], nextTopics: ['ต่อยอดหัวข้อเดิมเรื่องห้องเรียน'] };
  }
  if (system.includes('QA Agent')) {
    return ctrl().includes('qa-block')
      ? { scores: { facts: 30, language: 80, brand: 80, risk: 20 }, issues: [{ severity: 'high', text: 'อ้างตัวเลขที่ไม่มีที่มา' }], summary: 'เสี่ยงสูง' }
      : { scores: { facts: 90, language: 92, brand: 90, risk: 95 }, issues: [], summary: 'ผ่านเกณฑ์' };
  }
  if (system.includes('Publisher Agent เตรียมข้อมูลการค้นหา')) {
    return { slug: 'seo-optimized-slug', excerpt: 'คำโปรยสำหรับค้นหาที่ปรับแล้ว', tags: ['การศึกษา', 'ครู', 'AI'] };
  }
  return { ok: true };
}

// ---- social platforms (LINE / Facebook / TikTok) --------------------------------------------
async function social(url, init, j) {
  const c = ctrl();
  const bearer = String(init?.headers?.Authorization || init?.headers?.authorization || '');
  if (url.startsWith('https://api.line.me/v2/bot/info')) {
    return bearer.includes('bad') ? j({ message: 'Authentication failed' }, 401) : j({ userId: 'U123', basicId: '@komkid', displayName: 'คมคิด Official' });
  }
  if (url.startsWith('https://api.line.me/v2/bot/message/broadcast')) {
    log('line broadcast ' + bearer.slice(0, 20));
    return j({});
  }
  if (url.includes('graph.facebook.com') && url.includes('/oauth/access_token')) {
    log('fb token ' + (url.includes('fb_exchange_token') ? 'long' : 'short'));
    return url.includes('code=denied') ? j({ error: { message: 'Invalid code' } }, 400) : j({ access_token: url.includes('fb_exchange_token') ? 'LONG_USER_TOKEN_' + 'x'.repeat(30) : 'SHORT_USER_TOKEN_' + 'x'.repeat(30) });
  }
  if (url.includes('graph.facebook.com') && url.includes('/me/accounts')) {
    if (c.includes('fb-no-pages')) return j({ data: [] });
    const pages = [{ id: '1000000001', name: 'เพจคมคิด', access_token: 'PAGE_TOKEN_ONE_' + 'p'.repeat(30) }];
    if (c.includes('fb-two-pages')) pages.push({ id: '1000000002', name: 'เพจโครงการพิเศษ', access_token: 'PAGE_TOKEN_TWO_' + 'p'.repeat(30) });
    return j({ data: pages });
  }
  if (url.includes('graph.facebook.com') && /\/\d{5,}\?fields=name/.test(url)) {
    return url.includes('REVOKED') ? j({ error: { code: 190, message: 'Error validating access token' } }, 400) : j({ name: url.includes('1000000002') ? 'เพจโครงการพิเศษ' : 'เพจคมคิด', fan_count: 1234 });
  }
  if (url.includes('graph.facebook.com') && url.includes('/feed')) { log('fb feed'); return j({ id: '1000000001_999' }); }
  if (url.startsWith('https://open.tiktokapis.com/v2/oauth/token/')) {
    const body = String(init?.body || '');
    if (body.includes('grant_type=refresh_token')) { log('tiktok refresh'); return j({ access_token: 'TT_REFRESHED_' + 'r'.repeat(30), refresh_token: 'TT_REFRESH2_' + 'r'.repeat(30), expires_in: 86400 }); }
    return j({ access_token: 'TT_ACCESS_' + 'a'.repeat(30), refresh_token: 'TT_REFRESH_' + 'r'.repeat(30), expires_in: 60, open_id: 'tt-open-1' });
  }
  if (url.startsWith('https://open.tiktokapis.com/v2/user/info')) {
    return bearer.includes('TT_') ? j({ data: { user: { open_id: 'tt-open-1', display_name: 'คมคิดทีวี' } } }) : j({ error: { code: 'access_token_invalid' } }, 401);
  }
  return null;
}

globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const jj = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const soc = await social(url, init, jj);
  if (soc) return soc;
  const vendor = url.includes('api.deepseek.com') ? 'deepseek' : url.includes('api.openai.com') ? 'openai' : null;
  if (!vendor) return realFetch(input, init);
  const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (/\/models/.test(url)) {
    return vendor === 'deepseek'
      ? j({ data: [{ id: 'deepseek-reasoner', created: 2 }, { id: 'deepseek-chat', created: 1 }] })
      : j({ data: [{ id: 'gpt-5', created: 3 }, { id: 'gpt-image-1', created: 2 }, { id: 'gpt-4o-mini-tts', created: 1 }] });
  }
  if (url.includes('/images/generations')) {
    log('image ' + (JSON.parse(init.body).prompt || '').slice(0, 60));
    return j({ data: [{ b64_json: PNG }] });
  }
  if (url.includes('/chat/completions') && vendor === 'deepseek') {
    if (ctrl().includes('deepseek-down')) return j({ error: { message: 'Service Unavailable' } }, 503);
    const body = JSON.parse(init.body);
    const system = body.messages.find((m) => m.role === 'system')?.content || '';
    const user = body.messages.filter((m) => m.role === 'user').pop()?.content || '';
    const out = chatText(system, user);
    log('llm ' + (system.match(/คุณคือ ([A-Za-z ]+Agent[^ ]*)/) || [, 'other'])[1] + ' model=' + body.model);
    return j({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1000, completion_tokens: 400 } });
  }
  return j({ error: { message: 'not emulated: ' + url } }, 404);
};
