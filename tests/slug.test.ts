import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  slugify, validateSlug, uniqueSlug, ensureSlugSchema, ensurePostSlug, backfillPostSlugs,
  findPostIdBySlug, setPostSlug, isSlugTaken,
} from '../server/slug.ts';

test('slugify keeps Thai letters and combining marks, collapses punctuation', () => {
  assert.equal(slugify('การศึกษาไทย ในยุค AI!'), 'การศึกษาไทย-ในยุค-ai');
  assert.equal(slugify('  Hello,   World -- 2026 '), 'hello-world-2026');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('ก'.repeat(200)).length <= 80, true);
});

test('slugify never leaves a dangling hyphen or splits a letter from its marks', () => {
  const s = slugify('ก้า ' + 'ก'.repeat(120));
  assert.ok(!s.endsWith('-'));
  assert.ok(Array.from(s).length <= 80);
});

test('validateSlug rejects unsafe or ambiguous slugs', () => {
  assert.equal(validateSlug('ai-in-thai-education'), null);
  assert.equal(validateSlug('การศึกษา-ai'), null);
  for (const bad of ['', 'has space', '-lead', 'trail-', 'a--b', '../etc', 'a/b', '<script>', '12345', 'admin', 'a?b=1', 'a#b']) {
    assert.notEqual(validateSlug(bad), null, `should reject "${bad}"`);
  }
});

test('uniqueSlug appends a counter and avoids reserved/numeric roots', () => {
  const taken = new Set(['hello', 'hello-2']);
  assert.equal(uniqueSlug('Hello', (c) => taken.has(c)), 'hello-3');
  assert.equal(uniqueSlug('12345', () => false), 'post-12345');
  assert.equal(uniqueSlug('!!!', () => false), 'post');
});

function mkDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)');
  ensureSlugSchema(db as any);
  return db as any;
}

test('backfill gives every existing post a unique slug, idempotently', () => {
  const db = mkDb();
  for (const t of ['เรื่องเดียวกัน', 'เรื่องเดียวกัน', 'Other']) db.prepare('INSERT INTO posts (title) VALUES (?)').run(t);
  assert.equal(backfillPostSlugs(db), 3);
  const slugs = (db.prepare('SELECT slug FROM posts ORDER BY id').all() as any[]).map((r) => r.slug);
  assert.deepEqual(slugs, ['เรื่องเดียวกัน', 'เรื่องเดียวกัน-2', 'other']);
  assert.equal(backfillPostSlugs(db), 0);
});

test('renaming a slug keeps the old address resolving (redirect target) and frees nothing', () => {
  const db = mkDb();
  db.prepare('INSERT INTO posts (title) VALUES (?)').run('First');
  ensurePostSlug(db, 1);
  setPostSlug(db, 1, 'renamed');
  assert.deepEqual(findPostIdBySlug(db, 'renamed'), { postId: 1, canonical: true });
  assert.deepEqual(findPostIdBySlug(db, 'first'), { postId: 1, canonical: false });
  assert.equal(findPostIdBySlug(db, 'nope'), null);
  // another post may not take the old address
  assert.equal(isSlugTaken(db, 'first', 2), true);
  assert.equal(isSlugTaken(db, 'first', 1), false);
});
