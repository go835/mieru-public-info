const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function validClientId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{20,80}$/.test(value); }
function validPost(body) { return body && typeof body.location === 'string' && body.location.trim().length > 0 && body.location.length <= 50 && typeof body.message === 'string' && body.message.trim().length > 0 && body.message.length <= 280 && ['suspension', 'delay', 'resume', 'incident', 'disaster', 'evacuation', 'other'].includes(body.category); }

async function listPosts(env) {
  const query = `SELECT p.id, p.source, p.category, p.location, p.message, p.created_at,
    COALESCE(SUM(CASE WHEN r.kind = 'confirm' THEN 1 ELSE 0 END), 0) AS confirmed_count,
    COALESCE(SUM(CASE WHEN r.kind = 'not_confirm' THEN 1 ELSE 0 END), 0) AS not_confirmed_count,
    COALESCE(SUM(CASE WHEN r.kind = 'helpful' THEN 1 ELSE 0 END), 0) AS helpful_count,
    COALESCE(MAX(CASE WHEN r.kind = 'confirm' THEN r.created_at END), p.created_at) AS last_confirmed_at
    FROM posts p LEFT JOIN reactions r ON r.post_id = p.id
    WHERE p.status = 'active' GROUP BY p.id ORDER BY p.last_activity_at DESC LIMIT 100`;
  const result = await env.DB.prepare(query).all();
  return json({ posts: result.results });
}

async function createPost(request, env) {
  const clientId = request.headers.get('X-Client-Id');
  if (!validClientId(clientId)) return json({ error: 'Invalid client identifier.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!validPost(body)) return json({ error: '投稿内容を確認してください。' }, 400);
  const id = crypto.randomUUID(), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO posts (id, source, category, location, message, created_at, last_activity_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, 'user', body.category, body.location.trim(), body.message.trim(), now, now, 'active'),
    env.DB.prepare('INSERT INTO reactions (post_id, client_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(id, clientId, 'confirm', now),
  ]);
  return json({ id }, 201);
}

async function react(request, env, postId) {
  const clientId = request.headers.get('X-Client-Id');
  if (!validClientId(clientId)) return json({ error: 'Invalid client identifier.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const kind = body?.kind;
  if (!['confirm', 'not_confirm', 'helpful'].includes(kind)) return json({ error: 'Invalid reaction.' }, 400);
  const exists = await env.DB.prepare('SELECT id FROM posts WHERE id = ? AND status = ?').bind(postId, 'active').first();
  if (!exists) return json({ error: '投稿が見つかりません。' }, 404);
  const now = Date.now(), statements = [];
  if (kind === 'confirm') statements.push(env.DB.prepare("DELETE FROM reactions WHERE post_id = ? AND client_id = ? AND kind = 'not_confirm'").bind(postId, clientId));
  if (kind === 'not_confirm') statements.push(env.DB.prepare("DELETE FROM reactions WHERE post_id = ? AND client_id = ? AND kind = 'confirm'").bind(postId, clientId));
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO reactions (post_id, client_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(postId, clientId, kind, now));
  statements.push(env.DB.prepare('UPDATE posts SET last_activity_at = ? WHERE id = ?').bind(now, postId));
  await env.DB.batch(statements);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true });
      if (url.pathname === '/api/posts' && request.method === 'GET') return listPosts(env);
      if (url.pathname === '/api/posts' && request.method === 'POST') return createPost(request, env);
      const match = url.pathname.match(/^\/api\/posts\/([a-zA-Z0-9-]+)\/reactions$/);
      if (match && request.method === 'POST') return react(request, env, match[1]);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: error instanceof Error ? error.message : 'unknown' }));
      return json({ error: '一時的に処理できませんでした。' }, 500);
    }
  },
};
