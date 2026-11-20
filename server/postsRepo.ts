import { db } from './db.ts';

/** Removes a post and everything that points at it. Caller owns the transaction. */
export function deletePostRows(id: number): { removedComments: number } {
  const comments = Number(db.prepare('DELETE FROM comments WHERE post_id = ?').run(id).changes);
  db.prepare('DELETE FROM post_slugs WHERE post_id = ?').run(id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  const linked = db
    .prepare('SELECT id, approval_json FROM ai_workflows WHERE approval_json LIKE ?')
    .all(`%"publishedPostId":${id}%`) as { id: number; approval_json: string }[];
  for (const wf of linked) {
    try {
      const a = JSON.parse(wf.approval_json || '{}');
      if (a.publishedPostId === id) {
        a.publishedPostId = null;
        db.prepare(
          "UPDATE ai_workflows SET approval_json = ?, status = 'pending_approval', updated_at = ? WHERE id = ?"
        ).run(JSON.stringify(a), new Date().toISOString(), wf.id);
      }
    } catch {
      /* leave unparsable rows alone */
    }
  }
  // workspaces that pointed at this post become standalone drafts again
  db.prepare("UPDATE content_projects SET post_id = NULL, status = 'drafting', updated_at = ? WHERE post_id = ?").run(
    new Date().toISOString(),
    id
  );
  return { removedComments: comments };
}

/** Deletes one post atomically. Returns null when it does not exist. */
export function deletePostCascade(
  id: number
): { title: string; removedComments: number } | null {
  const existing = db.prepare('SELECT id, title FROM posts WHERE id = ?').get(id) as
    | { id: number; title: string }
    | undefined;
  if (!existing) return null;
  db.exec('BEGIN');
  try {
    const out = deletePostRows(id);
    db.exec('COMMIT');
    return { title: existing.title, removedComments: out.removedComments };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
