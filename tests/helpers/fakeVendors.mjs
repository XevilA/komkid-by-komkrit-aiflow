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

globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
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
