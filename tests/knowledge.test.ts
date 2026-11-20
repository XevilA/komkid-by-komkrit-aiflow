import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rankDocuments, selectKnowledge, type KnowledgeRow } from '../server/knowledge.ts';

const kb: KnowledgeRow[] = [
  { title: 'แนวทางใช้ AI Tutor ในโรงเรียน', category: 'education', summary: 'ครูใช้ AI ช่วยสอนรายบุคคล', content: 'AI Tutor ช่วยลดความเหลื่อมล้ำในโรงเรียนขนาดเล็ก ครูประหยัดเวลาตรวจงาน', source_ref: 'a' },
  { title: 'ภาษาและอาชีพไทย-เมียนมา', category: 'international', summary: 'หลักสูตรภาษาไทยเมียนมาเพื่ออาชีพ', content: 'ความร่วมมือโรงเรียนภาษาและอาชีพในอาเซียน', source_ref: 'b' },
  { title: 'แนวทางแบรนด์ คมคิด', category: 'brand_guideline', summary: 'น้ำเสียงและค่านิยมของแบรนด์', content: 'ภาษาไทยสุภาพ เข้าใจง่าย', source_ref: 'c' },
  { title: 'การเงินส่วนบุคคล', category: 'career', summary: 'วางแผนการเงิน', content: 'ออมเงิน ลงทุน', source_ref: 'd' },
];

test('Thai text is segmented into words (not left as one long token)', () => {
  const t = tokenize('การศึกษาไทยในยุคปัญญาประดิษฐ์');
  assert.ok(t.length >= 3, `got ${JSON.stringify(t)}`);
});

test('a Thai query with no spaces still finds the relevant document', () => {
  const r = rankDocuments(kb, 'ครูใช้เอไอสอนนักเรียนที่โรงเรียนขนาดเล็ก', 4);
  assert.equal(r[0].item.title, 'แนวทางใช้ AI Tutor ในโรงเรียน');
});

test('mixed Thai/English queries rank by relevance', () => {
  assert.equal(rankDocuments(kb, 'AI Tutor', 1)[0].item.source_ref, 'a');
  assert.equal(rankDocuments(kb, 'ภาษาเมียนมา อาชีพ', 1)[0].item.source_ref, 'b');
});

test('brand guideline is always included; unrelated docs are not', () => {
  const picked = selectKnowledge(kb, 'ภาษาและอาชีพไทย-เมียนมา', 3);
  assert.ok(picked.some((d) => d.category === 'brand_guideline'));
  assert.ok(picked.some((d) => d.source_ref === 'b'));
  assert.ok(!picked.some((d) => d.source_ref === 'd'));
});

test('empty/unmatched query degrades gracefully', () => {
  assert.ok(selectKnowledge(kb, 'zzzz qqqq', 3).length > 0);
  assert.ok(selectKnowledge([], 'x', 3).length === 0);
});

import { stripEmoji } from '../server/text.ts';
test('stripEmoji removes pictographs but keeps Thai text, punctuation and arrows', () => {
  assert.equal(stripEmoji('AI ไม่ได้มาแทนครู 💡 แต่ช่วยครู 🚀!'), 'AI ไม่ได้มาแทนครู แต่ช่วยครู!');
  assert.equal(stripEmoji('ขั้นตอน → ถัดไป ✓ เสร็จ'), 'ขั้นตอน → ถัดไป เสร็จ');
  assert.equal(stripEmoji('ปกติ ธรรมดา'), 'ปกติ ธรรมดา');
});
