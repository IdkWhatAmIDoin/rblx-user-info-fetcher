// DIMA signature!!
// major overhaul w   why the   why the fuck am i getting suggestions what

// im dima yk... im so cool.... 

// ─── helpers ──────────────────────────────────────────────────────────────────

function corsify(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function errorResponse(message, status, code, extra = {}) {
  return corsify(new Response(JSON.stringify({
    error: message,
    code,
    ...extra,
  }), {
    status,
    headers: { "Content-Type": "application/json" }
  }));
}

// ─── user-agent check ──────────────────────────────────────────────────────────

function isBrowser(userAgent) {
  const browserPatterns = ["Mozilla", "Chrome", "Safari", "Edg/", "Opera", "Firefox"];
  return browserPatterns.some(pattern => userAgent.includes(pattern));
}

// ─── body parsing ──────────────────────────────────────────────────────────────

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await request.json();
  } else if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData();
    const obj = {};
    for (const [key, value] of formData.entries()) {
      obj[key] = value;
    }
    return obj;
  } else {
    throw new Error('Unsupported content type. Please use JSON or form data.');
  }
}

// ─── boolean coercion ──────────────────────────────────────────────────────────

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'off') return false;
  }
  if (typeof value === 'number') return value !== 0;
  throw new Error(`Invalid boolean value for parameter: ${JSON.stringify(value)}`);
}

// ─── input validation ──────────────────────────────────────────────────────────

function sanitizeRobloxId(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && /[eE]/.test(value)) {
    throw new Error(`Invalid ${fieldName}: scientific notation is not allowed, got "${value}"`);
  }
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0 || String(n) !== String(value).trim()) {
    throw new Error(`Invalid ${fieldName}: must be a positive integer, got "${value}"`);
  }
  return n;
}

// ─── KV cache helpers ──────────────────────────────────────────────────────────

// TTLs in seconds
const CACHE_TTL = {
  profile:        600,  // 10 min
  groups:         300,  // 5 min
  avatar:         600,  // 10 min
  presence:        30,  // 30 sec
  friendsCount:   300,  // 5 min
  followersCount: 300,
  followingCount: 300,
  cool:           300,  // 5 min (ai decisions cached so we dont spam gemini)
};

const UPSTREAM_TIMEOUT_MS = 5000;

async function kvGet(env, key) {
  try {
    const raw = await env.IP_BANS.get(`cache:${key}`, { type: 'json' });
    if (!raw) return null;
    if (Date.now() > raw.expiresAt) return null; // expired
    return raw.value;
  } catch {
    return null;
  }
}

async function kvSet(env, key, value, ttlSeconds) {
  try {
    await env.IP_BANS.put(`cache:${key}`, JSON.stringify({
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    }), { expirationTtl: Math.max(ttlSeconds + 10, 60) });
  } catch (e) {
    console.error('cache write failed:', e);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('upstream timeout'), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJsonOrNull(url, options) {
  let res;
  try {
    res = await fetchWithTimeout(url, options);
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    try { res?.body?.cancel(); } catch {}
    return null;
  }

  try {
    return await res.json();
  } catch (err) {
    try { res?.body?.cancel(); } catch {}
    throw err;
  }
}

// ─── cool or not ──────────────────────────────────────────────────────────────

// hardcoded verdicts — these are final, no ai needed
const HARDCODED_COOL = {
  papaleks11:  { cool: true,  reason: "site owner. obviously cool." },
  roblox:      { cool: false, reason: "corporate account. not cool." },
  builderman:  { cool: true,  reason: "classic roblox icon. respect." },
  john_doe:    { cool: false, reason: "creepypasta. not cool." },
  jane_doe:    { cool: false, reason: "creepypasta. also not cool." },
};

async function decideCool(env, username, displayName, description, groups) {
  const lower = (username || '').toLowerCase();

  // 1. hardcoded
  if (HARDCODED_COOL[lower]) return HARDCODED_COOL[lower];

  // 2. check cache so we dont call gemini every time
  const cacheKey = `cool:${lower}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;

  // 3. try gemini
  if (env.gemini_api_key) {
    try {
      const groupSample = (groups || []).slice(0, 5).map(g => g.groupName).join(', ') || 'none';
      const prompt = `You are deciding if a Roblox user is "cool" or "not cool" for a fun personal website feature. Be playful and brief.
Username: ${username}
Display name: ${displayName}
Bio: ${description || 'none'}
Groups (sample): ${groupSample}
Respond ONLY with valid JSON in this exact format, nothing else:
{"cool": true, "reason": "one short funny sentence"}
or
{"cool": false, "reason": "one short funny sentence"}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent?key=${env.gemini_api_key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 60, temperature: 1.0 },
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (typeof parsed.cool === 'boolean' && typeof parsed.reason === 'string') {
          await kvSet(env, cacheKey, parsed, CACHE_TTL.cool);
          return parsed;
        }
      }
    } catch (e) {
      console.error('gemini cool check failed:', e);
    }
  }

  // 4. random fallback
  const cool = Math.random() > 0.5;
  const result = {
    cool,
    reason: cool ? "vibes check passed (randomly)" : "vibes check failed (randomly)",
  };
  await kvSet(env, cacheKey, result, CACHE_TTL.cool);
  return result;
}

// ─── rate limiting ─────────────────────────────────────────────────────────────

const RATE_LIMIT = 50;
const TIME_WINDOW = 60;
const BAN_DURATION = 3600;

const RATE_LIMIT_CACHE_MAX = 500;
const rateLimitCache = new Map();

let ipPolicyCache = null;
const IP_POLICY_CACHE_TTL = 30;

async function getIpPolicy(env) {
  const now = Math.floor(Date.now() / 1000);
  if (ipPolicyCache && (now - ipPolicyCache.fetchedAt) < IP_POLICY_CACHE_TTL) {
    return ipPolicyCache.bans;
  }
  try {
    const policyData = await env.IP_BANS.get('ip_policy', { type: 'json' });
    const bans = (policyData && Array.isArray(policyData.bans)) ? policyData.bans : [];
    ipPolicyCache = { bans, fetchedAt: now };
    return bans;
  } catch (err) {
    console.error('Failed to fetch IP policy:', err);
    return ipPolicyCache ? ipPolicyCache.bans : [];
  }
}

function checkIpAgainstPolicy(ip, bansArray) {
  for (const entry of bansArray) {
    if (entry.ip === ip) return entry;
  }
  return null;
}

function getClientIp(request) {
  const url = new URL(request.url);
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;

  // allow localhost testing without weakening deployed traffic.
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';

  if (isLocalhost) {
    return request.headers.get('X-Forwarded-For') || '127.0.0.1';
  }

  return null;
}

function getUpstreamErrorMessage(operation, status) {
  if (status === 429) return `${operation} temporarily unavailable`;
  if (status >= 500) return `${operation} service unavailable`;
  return `${operation} failed`;
}

async function checkRateLimit(env, ip) {
  const key = `rate:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    let data = rateLimitCache.get(ip);

    if (!data) {
      const kvData = await env.IP_BANS.get(key, { type: 'json' });
      if (kvData) {
        data = kvData;
        rateLimitCache.set(ip, data);
      } else {
        data = { count: 1, windowStart: now, banned: false, banExpiry: 0 };
        rateLimitCache.set(ip, data);
        await env.IP_BANS.put(key, JSON.stringify(data), { expirationTtl: TIME_WINDOW + 5 });
        return { allowed: true, data };
      }
    }

    if (data.banned) {
      if (now < data.banExpiry) {
        return { allowed: false, reason: 'banned', retryAfter: data.banExpiry - now };
      }
      data = { count: 1, windowStart: now, banned: false, banExpiry: 0 };
      rateLimitCache.set(ip, data);
      await env.IP_BANS.put(key, JSON.stringify(data), { expirationTtl: TIME_WINDOW + 5 });
      return { allowed: true, data };
    }

    if (now - data.windowStart > TIME_WINDOW) {
      data = { count: 1, windowStart: now, banned: false, banExpiry: 0 };
      rateLimitCache.set(ip, data);
      await env.IP_BANS.put(key, JSON.stringify(data), { expirationTtl: TIME_WINDOW + 5 });
      return { allowed: true, data };
    }

    data.count++;

    // evict oldest in-memory entry before adding if at cap (BUG-005)
    if (rateLimitCache.size >= RATE_LIMIT_CACHE_MAX) {
      rateLimitCache.delete(rateLimitCache.keys().next().value);
    }
    rateLimitCache.set(ip, data);

    if (data.count > RATE_LIMIT) {
      data.banned = true;
      data.banExpiry = now + BAN_DURATION;
      rateLimitCache.set(ip, data);
      await env.IP_BANS.put(key, JSON.stringify(data), { expirationTtl: BAN_DURATION });
      return { allowed: false, reason: 'rate_limit_exceeded', retryAfter: BAN_DURATION };
    }

    return { allowed: true, data };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return { allowed: true, data: null };
  }
}

// ─── clearance cookie helper ───────────────────────────────────────────────────

function getClearanceCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)cf_clearance=([^;]+)/);
  return match ? match[1] : null;
}

async function isClearanceValid(env, token) {
  if (!token) return false;
  try {
    const entry = await env.IP_BANS.get(`clearance:${token}`, { type: 'json' });
    return entry !== null;
  } catch {
    return false;
  }
}

// ─── main handler ──────────────────────────────────────────────────────────────

// tldr. cant even read my code lol.

export default {
  async fetch(request, env) {

    // preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    
    console.log('dima is cool '); // dima signature

    // ── /verify-challenge ────────────────────────────────────────────────────
    if (url.pathname === "/verify-challenge") {
      if (request.method !== "POST") {
        return errorResponse('Method not allowed', 405, 'method_not_allowed');
      }

      const challengeIP = getClientIp(request);
      if (!challengeIP) {
        return errorResponse('Could not determine client IP', 400, 'client_ip_missing');
      }
      const challengeRate = await checkRateLimit(env, challengeIP);
      if (!challengeRate.allowed) {
        return corsify(Response.redirect('https://rblx-uif-site.pages.dev/blocked?type=temporary', 302));
      }

      try {
        const { token, returnUrl } = await request.json();

        if (returnUrl) {
          let parsed;
          try {
            parsed = new URL(returnUrl, request.url);
          } catch {
            return errorResponse('Invalid returnUrl', 400, 'invalid_return_url');
          }
          const requestOrigin = new URL(request.url).origin;
          if (parsed.origin !== requestOrigin) {
            return errorResponse('returnUrl must be same-origin', 400, 'return_url_not_same_origin');
          }
        }

        const secretKey = env.TURNSTILE_SECRET;
        const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
        });
        const outcome = await verifyResponse.json();
        console.log('Turnstile outcome:', JSON.stringify(outcome));

        if (outcome.success) {
          const clearanceToken = crypto.randomUUID();
          await env.IP_BANS.put(
            `clearance:${clearanceToken}`,
            JSON.stringify({ createdAt: Date.now() }),
            { expirationTtl: 3600 }
          );

          const safeReturn = returnUrl || '/';
          const redirectResponse = new Response(null, {
            status: 302,
            headers: { 'Location': safeReturn }
          });
          redirectResponse.headers.append(
            'Set-Cookie',
            `cf_clearance=${clearanceToken}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`
          );
          return corsify(redirectResponse);
        } else {
          return errorResponse('Verification failed', 403, 'challenge_verification_failed');
        }
      } catch (err) {
        return errorResponse('Invalid request', 400, 'invalid_request');
      }
    }

    // ── /418 ────────────────────────────────────────────────────
    if (url.pathname === "/418") {
      if (request.method !== "GET") {
        return corsify(new Response("i know we usually use post and stuff, but this time its only get", { status: 405 }));
      }
      return corsify(new Response(
        JSON.stringify({
          uhhh: "well,,,. im not rlly a teapot, but have this image of a teapot i guess??",
          image: "https://http.cat/418"
        }),
        { status: 418, statusText: "cat in a teapot", headers: { "Content-Type": "application/json" } }
      ));
    }

    // ── ip / rate limiting ───────────────────────────────────────────────────

    const clientIP = getClientIp(request);

    if (!clientIP) {
      return errorResponse('Could not determine client IP', 400, 'client_ip_missing');
    }

    const bans = await getIpPolicy(env);
    const policyMatch = checkIpAgainstPolicy(clientIP, bans);

    if (policyMatch) {
      const action = policyMatch.action || 'block';
      if (action === 'block') {
        return corsify(Response.redirect('https://rblx-uif-site.pages.dev/blocked?type=permanent', 302));
      } else if (action === 'challenge') {
        const clearanceToken = getClearanceCookie(request);
        const cleared = await isClearanceValid(env, clearanceToken);
        if (!cleared) {
          const returnUrl = encodeURIComponent(request.url);
          return corsify(Response.redirect(`https://rblx-uif-site.pages.dev/challenge?return=${returnUrl}`, 302));
        }
      } else if (action === 'allow') {
        // explicitly allowed, fall through
      } else {
        return errorResponse('Access denied (unknown policy action).', 403, 'unknown_policy_action', {
          reason: `IP matched policy with unknown action: ${action}`,
          action
        });
      }
    }

    if (url.pathname !== "/health" && !url.pathname.startsWith("/docs/")) {
      const rateCheck = await checkRateLimit(env, clientIP);
      if (!rateCheck.allowed) {
        return corsify(Response.redirect('https://rblx-uif-site.pages.dev/blocked?type=temporary', 302));
      }
    }

    // ── /health ──────────────────────────────────────────────────────────────
    if (url.pathname === "/health") {
      const secret = request.headers.get("Secret");
  
      if (secret !== env.HEALTH_SECRET) {
        return corsify(new Response("Unauthorized", { status: 401 }));
      }
  
      return corsify(new Response("OK", { status: 200 }));
    }


    // ── browser redirect ─────────────────────────────────────────────────────
    if (request.method === "GET") {
      const userAgent = request.headers.get("User-Agent") || "";
      if (isBrowser(userAgent)) {
        return corsify(Response.redirect("https://rblx-uif-site.pages.dev", 302));
      }
    }

    if (request.method !== "POST") {
      return errorResponse("Check if you're not using POST.", 405, 'method_not_allowed');
    }

    // ── geometry dash easter egg ─────────────────────────────────────────────
    const userAgent = request.headers.get("User-Agent") || "";
    if (userAgent.toLowerCase().includes("geometrydash")) {
      return corsify(new Response(
        JSON.stringify({
          whatTheActualFuckBroQuestionMarkQuestionMark: "are you fucking launching this from GEOMETRY DASH????"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    }

    // ── main roblox user info logic ──────────────────────────────────────────
    try {
      const body = await parseBody(request);

      let userId = sanitizeRobloxId(body.userId, 'userId');
      const groupId = sanitizeRobloxId(body.groupId, 'groupId');
      const username = typeof body.username === 'string' ? body.username.trim() : null;

      let includeAvatar, includePresence, includeFriendsCount,
          includeFollowersCount, includeFollowingCount, includeGroups, includeCool;
      try {
        includeAvatar          = normalizeBoolean(body.includeAvatar, false);
        includePresence        = normalizeBoolean(body.includePresence, false);
        includeFriendsCount    = normalizeBoolean(body.includeFriendsCount, false);
        includeFollowersCount  = normalizeBoolean(body.includeFollowersCount, false);
        includeFollowingCount  = normalizeBoolean(body.includeFollowingCount, false);
        includeGroups          = normalizeBoolean(body.includeGroups, true);
        includeCool            = normalizeBoolean(body.includeCool, false);
      } catch (boolErr) {
        return errorResponse(boolErr.message, 400, 'invalid_boolean_parameter');
      }

      // cool check needs group data to give gemini useful context (BUG-003)
      if (includeCool) includeGroups = true;

      // resolve username → userId
      if (!userId && username) {
        // cache username → userId lookups too
        const userIdCacheKey = `userid:${username.toLowerCase()}`;
        const cachedUserId = await kvGet(env, userIdCacheKey);
        if (cachedUserId) {
          userId = cachedUserId;
        } else {
          const userRes = await fetchWithTimeout("https://users.roproxy.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
          });
          let userData;
          try {
            userData = await userRes.json();
          } catch (err) {
            try { userRes?.body?.cancel(); } catch {}
            throw err;
          }
          if (!userRes.ok) {
            return errorResponse(getUpstreamErrorMessage('Username lookup', userRes.status), 502, 'username_lookup_failed');
          }
          if (userData.data && userData.data.length > 0) {
            userId = userData.data[0].id;
            await kvSet(env, userIdCacheKey, userId, CACHE_TTL.profile);
          } else {
            return errorResponse('User not found', 404, 'user_not_found');
          }
        }
      }

      if (!userId) {
        return errorResponse('No userId or username provided', 400, 'missing_user_identifier');
      }

      // ── cached fetches ───────────────────────────────────────────────────
      async function cachedFetch(cacheKey, ttl, fetchFn) {
        const cached = await kvGet(env, cacheKey);
        if (cached !== null) return cached;
        const result = await fetchFn();
        if (result !== null) await kvSet(env, cacheKey, result, ttl);
        return result;
      }

      // profile (always fetched)
      const profile = await cachedFetch(`profile:${userId}`, CACHE_TTL.profile, async () => {
        const res = await fetchWithTimeout(`https://users.roproxy.com/v1/users/${userId}`);
        if (!res.ok) {
          try { res?.body?.cancel(); } catch {}
          return null;
        }
        try {
          return await res.json();
        } catch (err) {
          try { res?.body?.cancel(); } catch {}
          throw err;
        }
      });

      if (!profile) {
        return errorResponse('User profile unavailable', 502, 'user_profile_unavailable');
      }

      // build parallel fetch list with caching
      const promises = [];
      const promiseKeys = [];

      if (includeGroups) {
        promises.push(cachedFetch(`groups:${userId}`, CACHE_TTL.groups, async () => {
          return await fetchJsonOrNull(`https://groups.roproxy.com/v1/users/${userId}/groups/roles`);
        }));
        promiseKeys.push('groups');
      }
      if (includeAvatar) {
        promises.push(cachedFetch(`avatar:${userId}`, CACHE_TTL.avatar, async () => {
          return await fetchJsonOrNull(`https://thumbnails.roproxy.com/v1/users/avatar-headshot?userIds=${userId}&size=720x720&format=Png`);
        }));
        promiseKeys.push('avatar');
      }
      if (includePresence) {
        promises.push(cachedFetch(`presence:${userId}`, CACHE_TTL.presence, async () => {
          return await fetchJsonOrNull(`https://presence.roproxy.com/v1/presence/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [userId] })
          });
        }));
        promiseKeys.push('presence');
      }
      if (includeFriendsCount) {
        promises.push(cachedFetch(`friendsCount:${userId}`, CACHE_TTL.friendsCount, async () => {
          return await fetchJsonOrNull(`https://friends.roproxy.com/v1/users/${userId}/friends/count`);
        }));
        promiseKeys.push('friendsCount');
      }
      if (includeFollowersCount) {
        promises.push(cachedFetch(`followersCount:${userId}`, CACHE_TTL.followersCount, async () => {
          return await fetchJsonOrNull(`https://friends.roproxy.com/v1/users/${userId}/followers/count`);
        }));
        promiseKeys.push('followersCount');
      }
      if (includeFollowingCount) {
        promises.push(cachedFetch(`followingCount:${userId}`, CACHE_TTL.followingCount, async () => {
          return await fetchJsonOrNull(`https://friends.roproxy.com/v1/users/${userId}/followings/count`);
        }));
        promiseKeys.push('followingCount');
      }

      const results = await Promise.allSettled(promises);

      let groupsData = null, avatarData = null, presenceData = null;
      let friendsCountData = null, followersCountData = null, followingCountData = null;

      for (let i = 0; i < promiseKeys.length; i++) {
        const key = promiseKeys[i];
        const result = results[i];
        if (result.status === 'rejected') {
          console.error(`optional ${key} fetch failed:`, result.reason);
          continue;
        }
        const data = result.value;
        switch (key) {
          case 'groups':         groupsData         = data; break;
          case 'avatar':         avatarData         = data; break;
          case 'presence':       presenceData       = data; break;
          case 'friendsCount':   friendsCountData   = data; break;
          case 'followersCount': followersCountData = data; break;
          case 'followingCount': followingCountData = data; break;
        }
      }

      // build response
      const response = {
        id: profile.id,
        username: profile.name,
        displayName: profile.displayName,
        created: profile.created,
        profileUrl: `https://www.roproxy.com/users/${profile.id}/profile`,
      };

      if (profile.description) response.description = profile.description;

      if (includeGroups && groupsData?.data) {
        response.groups = groupsData.data.map(g => ({
          groupId: g.group.id,
          groupName: g.group.name,
          memberCount: g.group.memberCount,
          roleId: g.role.id,
          roleName: g.role.name,
          rank: g.role.rank,
        }));

        if (groupId) {
          const groupMatch = groupsData.data.find(g => g.group.id === groupId);
          response.requestedGroup = groupMatch ? {
            groupId: groupMatch.group.id,
            groupName: groupMatch.group.name,
            roleId: groupMatch.role.id,
            roleName: groupMatch.role.name,
            rank: groupMatch.role.rank,
          } : null;
        }
      }

      if (includeAvatar && avatarData?.data) {
        response.avatarUrl = avatarData.data[0]?.imageUrl || null;
      }

      if (includePresence && presenceData?.userPresences?.length > 0) {
        const presence = presenceData.userPresences[0];
        response.presence = {
          userPresenceType: presence.userPresenceType,
          lastLocation: presence.lastLocation,
          placeId: presence.placeId,
          rootPlaceId: presence.rootPlaceId,
          gameId: presence.gameId,
          universeId: presence.universeId
        };
      }

      if (includeFriendsCount && friendsCountData) {
        response.friendsCount = friendsCountData.count;
      }
      if (includeFollowersCount && followersCountData) {
        response.followersCount = followersCountData.count;
      }
      if (includeFollowingCount && followingCountData) {
        response.followingCount = followingCountData.count;
      }

      // ── cool or not ──────────────────────────────────────────────────────
      if (includeCool) {
        const coolResult = await decideCool(
          env,
          profile.name,
          profile.displayName,
          profile.description,
          response.groups || []
        );
        response.cool = coolResult;
      }

      return corsify(new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" }
      }));

    } catch (err) {
      if (err?.name === 'AbortError') {
        return errorResponse('Upstream request timed out', 502, 'upstream_timeout');
      }
      const isClientError = err instanceof SyntaxError || err.message?.includes('Invalid ') || err.message?.includes('Unsupported content type');
      return errorResponse('Worker Error', isClientError ? 400 : 502, isClientError ? 'invalid_request_body' : 'worker_error', {
        detail: err.message
      });
    }
  }
};
