import { createRemoteJWKSet, jwtVerify } from "jose";

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_JWKS_URL?: string;
  APP_ORIGINS?: string;
}

interface Identity {
  sub: string;
  email?: string;
}

interface User {
  id: string;
  auth_subject: string;
  email: string | null;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let cachedJwksUrl = "";

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const fail = (message: string, status: number) => json({ error: message }, status);

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.APP_ORIGINS ?? "capacitor://localhost,http://localhost")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  if (allowed.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

async function authenticate(request: Request, env: Env): Promise<Identity | null> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URL) return null;
  try {
    if (!cachedJwks || cachedJwksUrl !== env.AUTH_JWKS_URL) {
      cachedJwksUrl = env.AUTH_JWKS_URL;
      cachedJwks = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));
    }
    const { payload } = await jwtVerify(token, cachedJwks, {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      algorithms: ["RS256", "ES256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return null;
  }
}

async function currentUser(identity: Identity, env: Env): Promise<User> {
  const id = crypto.randomUUID();
  return await env.DB.prepare(
    "INSERT INTO users (id, auth_subject, email) VALUES (?, ?, ?) " +
    "ON CONFLICT(auth_subject) DO UPDATE SET email = COALESCE(excluded.email, users.email), " +
    "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
    "RETURNING id, auth_subject, email"
  ).bind(id, identity.sub, identity.email ?? null).first<User>() as User;
}

async function bodyJson<T>(request: Request): Promise<T | null> {
  try { return await request.json() as T; } catch { return null; }
}

function ageOn(dateString: string): number {
  const birth = new Date(dateString + "T00:00:00Z");
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== dateString) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "one-api", version: "0.1.0" });
  }

  const identity = await authenticate(request, env);
  if (!identity) return fail("Authentication required or token is invalid.", 401);
  const user = await currentUser(identity, env);

  if (path === "/api/me" && method === "GET") return json({ id: user.id, email: user.email });

  if (path === "/api/profile" && method === "GET") {
    const profile = await env.DB.prepare(
      "SELECT display_name, birth_date, city, bio, intention, published, updated_at " +
      "FROM profiles WHERE user_id = ?"
    ).bind(user.id).first();
    const photos = await env.DB.prepare(
      "SELECT id, content_type, byte_size, sort_order FROM photos WHERE user_id = ? ORDER BY sort_order"
    ).bind(user.id).all();
    return json({ profile, photos: photos.results });
  }

  if (path === "/api/profile" && method === "PUT") {
    const input = await bodyJson<{
      displayName?: string; birthDate?: string; city?: string;
      bio?: string; intention?: string; published?: boolean;
    }>(request);
    if (!input || typeof input.displayName !== "string" ||
      typeof input.birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) {
      return fail("A display name and valid birth date are required.", 400);
    }
    if (ageOn(input.birthDate) < 18 || ageOn(input.birthDate) > 110) {
      return fail("ONE is available to adults aged 18 and over.", 403);
    }
    const name = input.displayName.trim();
    const bio = (input.bio ?? "").trim();
    const city = (input.city ?? "").trim();
    const intention = input.intention ?? "relationship";
    if (name.length < 1 || name.length > 60 || bio.length > 1000 || city.length > 100 ||
      !["relationship", "casual", "friendship", "unsure"].includes(intention)) {
      return fail("One or more profile fields are invalid.", 400);
    }
    await env.DB.prepare(
      "INSERT INTO profiles (user_id, display_name, birth_date, city, bio, intention, published) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET " +
      "display_name=excluded.display_name, birth_date=excluded.birth_date, city=excluded.city, " +
      "bio=excluded.bio, intention=excluded.intention, published=excluded.published, " +
      "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(user.id, name, input.birthDate, city, bio, intention, input.published ? 1 : 0).run();
    return json({ saved: true });
  }

  if (path === "/api/discover" && method === "GET") {
    const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
    const results = await env.DB.prepare(
      "SELECT p.user_id AS id, p.display_name AS displayName, CAST((julianday('now') - julianday(p.birth_date)) / 365.2425 AS INTEGER) AS age, " +
      "p.city, p.bio, p.intention FROM profiles p " +
      "WHERE p.published=1 AND p.user_id<>? " +
      "AND NOT EXISTS (SELECT 1 FROM blocks b WHERE " +
      "(b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)) " +
      "AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_user_id=? AND l.to_user_id=p.user_id) " +
      "ORDER BY p.updated_at DESC LIMIT ?"
    ).bind(user.id, user.id, user.id, user.id, limit).all();
    return json({ profiles: results.results });
  }

  if (path === "/api/likes" && method === "POST") {
    const input = await bodyJson<{ targetUserId?: string }>(request);
    const target = input?.targetUserId;
    if (!target || target === user.id) return fail("A valid target user is required.", 400);
    const blocked = await env.DB.prepare(
      "SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)"
    ).bind(user.id, target, target, user.id).first();
    if (blocked) return fail("This action is unavailable.", 404);
    const exists = await env.DB.prepare("SELECT 1 FROM profiles WHERE user_id=? AND published=1")
      .bind(target).first();
    if (!exists) return fail("Profile not found.", 404);
    await env.DB.prepare("INSERT OR IGNORE INTO likes (from_user_id,to_user_id) VALUES (?,?)")
      .bind(user.id, target).run();
    const reciprocal = await env.DB.prepare(
      "SELECT 1 FROM likes WHERE from_user_id=? AND to_user_id=?"
    ).bind(target, user.id).first();
    if (!reciprocal) return json({ matched: false });
    const [a, b] = [user.id, target].sort();
    const matchId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO matches (id,user_a,user_b) VALUES (?,?,?)")
        .bind(matchId, a, b),
      env.DB.prepare("INSERT OR IGNORE INTO conversations (id,match_id) " +
        "SELECT ?, id FROM matches WHERE user_a=? AND user_b=?")
        .bind(conversationId, a, b),
    ]);
    const match = await env.DB.prepare("SELECT id FROM matches WHERE user_a=? AND user_b=?")
      .bind(a, b).first<{ id: string }>();
    const conversation = match ? await env.DB.prepare(
      "SELECT id FROM conversations WHERE match_id=?"
    ).bind(match.id).first<{ id: string }>() : null;
    return json({ matched: true, matchId: match?.id, conversationId: conversation?.id });
  }

  if (path === "/api/matches" && method === "GET") {
    const results = await env.DB.prepare(
      "SELECT m.id, m.created_at, CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END AS otherUserId, " +
      "p.display_name AS displayName, p.city, p.bio, c.id AS conversationId " +
      "FROM matches m JOIN profiles p ON p.user_id=CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END " +
      "JOIN conversations c ON c.match_id=m.id WHERE m.user_a=? OR m.user_b=? ORDER BY m.created_at DESC"
    ).bind(user.id, user.id, user.id, user.id).all();
    return json({ matches: results.results });
  }

  const messageRoute = path.match(/^\/api\/conversations\/([a-f0-9-]+)\/messages$/i);
  if (messageRoute) {
    const conversationId = messageRoute[1];
    const member = await env.DB.prepare(
      "SELECT 1 FROM conversations c JOIN matches m ON m.id=c.match_id " +
      "WHERE c.id=? AND (m.user_a=? OR m.user_b=?)"
    ).bind(conversationId, user.id, user.id).first();
    if (!member) return fail("Conversation not found.", 404);
    if (method === "GET") {
      const before = url.searchParams.get("before");
      const rows = before
        ? await env.DB.prepare(
          "SELECT id, sender_id AS senderId, body, created_at AS createdAt FROM messages " +
          "WHERE conversation_id=? AND created_at<? ORDER BY created_at DESC LIMIT 50"
        ).bind(conversationId, before).all()
        : await env.DB.prepare(
          "SELECT id, sender_id AS senderId, body, created_at AS createdAt FROM messages " +
          "WHERE conversation_id=? ORDER BY created_at DESC LIMIT 50"
        ).bind(conversationId).all();
      return json({ messages: rows.results.reverse() });
    }
    if (method === "POST") {
      const input = await bodyJson<{ body?: string }>(request);
      const body = input?.body?.trim() ?? "";
      if (!body || body.length > 4000) return fail("Message must contain 1–4000 characters.", 400);
      const blocked = await env.DB.prepare(
        "SELECT 1 FROM matches m WHERE m.id=(SELECT match_id FROM conversations WHERE id=?) " +
        "AND (EXISTS (SELECT 1 FROM blocks WHERE blocker_id=m.user_a AND blocked_id=m.user_b) " +
        "OR EXISTS (SELECT 1 FROM blocks WHERE blocker_id=m.user_b AND blocked_id=m.user_a))"
      ).bind(conversationId).first();
      if (blocked) return fail("Messaging is unavailable.", 403);
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO messages (id,conversation_id,sender_id,body) VALUES (?,?,?,?)")
        .bind(id, conversationId, user.id, body).run();
      return json({ id, senderId: user.id, body }, 201);
    }
  }

  if (path === "/api/blocks" && method === "POST") {
    const input = await bodyJson<{ targetUserId?: string }>(request);
    const target = input?.targetUserId;
    if (!target || target === user.id) return fail("A valid target user is required.", 400);
    await env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker_id,blocked_id) VALUES (?,?)")
      .bind(user.id, target).run();
    return json({ blocked: true });
  }

  if (path === "/api/reports" && method === "POST") {
    const input = await bodyJson<{ targetUserId?: string; reason?: string; details?: string }>(request);
    const target = input?.targetUserId;
    const reason = input?.reason?.trim() ?? "";
    const details = input?.details?.trim() ?? "";
    if (!target || target === user.id || reason.length < 3 || reason.length > 100 || details.length > 2000) {
      return fail("A valid report target and reason are required.", 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO reports (id,reporter_id,reported_user_id,reason,details) VALUES (?,?,?,?,?)"
    ).bind(id, user.id, target, reason, details).run();
    return json({ reportId: id, received: true }, 201);
  }

  return fail("Not found.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    try {
      const response = await handle(request, env);
      const merged = new Headers(response.headers);
      headers.forEach((value, key) => merged.set(key, value));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
    } catch (error) {
      console.error("ONE API request failed", error);
      const response = fail("An unexpected server error occurred.", 500);
      const merged = new Headers(response.headers);
      headers.forEach((value, key) => merged.set(key, value));
      return new Response(response.body, { status: 500, headers: merged });
    }
  },
};
