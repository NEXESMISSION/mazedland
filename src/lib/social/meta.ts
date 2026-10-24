import { createHmac } from "node:crypto";

/**
 * The few Graph API calls the Social Publisher makes — Facebook page posts,
 * Instagram publishing, and the OAuth steps that give us a page token.
 *
 * Facebook page (pages_manage_posts):
 *   photos uploaded unpublished  POST /{page}/photos  url, published=false
 *   then one post with them      POST /{page}/feed    message, attached_media
 * Instagram (instagram_content_publish), JPEG only, at a public URL:
 *   one photo     POST /{ig}/media  image_url, caption            → container
 *   a carousel    POST /{ig}/media  image_url, is_carousel_item   (each, ≤ 10)
 *                 POST /{ig}/media  media_type=CAROUSEL, children, caption
 *   then          POST /{ig}/media_publish  creation_id            → media id
 *
 * Every error is sorted into what the engine can do about it (`kind`): retry
 * later, wait for the quota, ask a person to reconnect the page, fix the
 * photo, or give up. A network failure is « network »: the post may or may
 * not exist, so the engine looks for it before trying again.
 */
export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type GraphErrorKind =
  | "auth"              // token expired or revoked, permission missing → reconnect
  | "rate_limit"        // too many calls, or the 24 h publishing quota → wait
  | "transient"         // Meta's side, retry soon
  | "network"           // no answer: the outcome is unknown
  | "media"             // the photo was refused (format, size, ratio, download)
  | "expired_container" // Instagram container older than 24 h → make a new one
  | "duplicate"         // Facebook says this exact post exists
  | "permanent";        // a request we got wrong; retrying will not help

export class GraphError extends Error {
  constructor(
    message: string,
    readonly kind: GraphErrorKind,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; type?: string };
};

const IG_MEDIA_SUBCODES = new Set([2207004, 2207005, 2207009, 2207023, 2207026, 2207052, 2207003]);

/** Meta's error codes, sorted by what can be done about them. */
export function classifyGraphError(status: number, body: GraphErrorBody): GraphErrorKind {
  const e = body.error ?? {};
  const code = e.code ?? null;
  const sub = e.error_subcode ?? null;
  if (sub === 2207020) return "expired_container";
  if (sub === 2207042) return "rate_limit";
  if (sub === 2207001) return "transient";
  if (sub !== null && IG_MEDIA_SUBCODES.has(sub)) return "media";
  if (code === 36003 || code === 9004 || code === 324) return "media";
  if (code === 506) return "duplicate";
  if (code === 190 || code === 102 || code === 10 || (code !== null && code >= 200 && code <= 299)) return "auth";
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 368 || (code !== null && code >= 80000 && code <= 80014)) {
    return "rate_limit";
  }
  if (e.is_transient || code === 1 || code === 2 || status >= 500) return "transient";
  if (status === 401) return "auth";
  if (status === 429) return "rate_limit";
  return "permanent";
}

type Params = Record<string, string | number | boolean | undefined>;
export type Fetch = typeof fetch;

export type GraphClient = {
  get<T>(path: string, params?: Params): Promise<T>;
  post<T>(path: string, params?: Params): Promise<T>;
  del<T>(path: string): Promise<T>;
};

/**
 * Calls made with one access token. With the app secret, each call carries
 * `appsecret_proof`, so a token copied out of a log is useless elsewhere
 * (and the app can require it in Meta's settings).
 */
export function graphClient(
  token: string,
  opts: { appSecret?: string | null; fetch?: Fetch; timeoutMs?: number; base?: string } = {},
): GraphClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.base ?? GRAPH;
  const proof = opts.appSecret ? createHmac("sha256", opts.appSecret).update(token).digest("hex") : null;

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}): Promise<T> {
    const all: Record<string, string> = { access_token: token };
    if (proof) all.appsecret_proof = proof;
    for (const [k, v] of Object.entries(params)) if (v !== undefined) all[k] = String(v);
    const body = new URLSearchParams(all);
    const url = method === "POST" ? `${base}${path}` : `${base}${path}?${body}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new GraphError(err instanceof Error ? err.message : "network error", "network");
    }
    const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      throw new GraphError(
        e.message ?? `HTTP ${res.status}`,
        classifyGraphError(res.status, json),
        e.code ?? null,
        e.error_subcode ?? null,
        res.status,
      );
    }
    return json;
  }

  return {
    get: (path, params) => call("GET", path, params),
    post: (path, params) => call("POST", path, params),
    del: (path) => call("DELETE", path),
  };
}

// ── Facebook page ─────────────────────────────────────────────────────────

export type PostedRef = { id: string; url: string | null };

/** One post with up to four photos (fewer is fine; none posts the text alone). */
export async function publishPagePost(
  g: GraphClient,
  pageId: string,
  input: { message: string; imageUrls: string[] },
): Promise<PostedRef> {
  const media: { media_fbid: string }[] = [];
  for (const url of input.imageUrls.slice(0, 4)) {
    const photo = await g.post<{ id: string }>(`/${pageId}/photos`, { url, published: false });
    media.push({ media_fbid: photo.id });
  }
  const post = await g.post<{ id: string }>(`/${pageId}/feed`, {
    message: input.message,
    attached_media: media.length ? JSON.stringify(media) : undefined,
  });
  return { id: post.id, url: await pagePostUrl(g, post.id) };
}

export async function pagePostUrl(g: GraphClient, postId: string): Promise<string | null> {
  try {
    const p = await g.get<{ permalink_url?: string }>(`/${postId}`, { fields: "permalink_url" });
    return p.permalink_url ?? null;
  } catch {
    return null;
  }
}

/** A recent page post whose text carries `marker` (the request's reference). */
export async function findPagePost(g: GraphClient, pageId: string, marker: string): Promise<PostedRef | null> {
  const r = await g.get<{ data?: { id: string; message?: string; permalink_url?: string }[] }>(`/${pageId}/posts`, {
    fields: "id,message,permalink_url",
    limit: 25,
  });
  const hit = (r.data ?? []).find((p) => p.message?.includes(marker));
  return hit ? { id: hit.id, url: hit.permalink_url ?? null } : null;
}

export async function editPagePost(g: GraphClient, postId: string, message: string): Promise<void> {
  await g.post(`/${postId}`, { message });
}

export async function deletePagePost(g: GraphClient, postId: string): Promise<void> {
  await g.del(`/${postId}`);
}

// ── Instagram ─────────────────────────────────────────────────────────────

/** The container to publish: one photo, or a carousel of up to ten. */
export async function createIgContainer(
  g: GraphClient,
  igId: string,
  input: { caption: string; imageUrls: string[] },
): Promise<string> {
  const urls = input.imageUrls.slice(0, 10);
  if (urls.length === 0) throw new GraphError("Instagram needs at least one photo", "media");
  if (urls.length === 1) {
    const c = await g.post<{ id: string }>(`/${igId}/media`, { image_url: urls[0], caption: input.caption });
    return c.id;
  }
  const children: string[] = [];
  for (const image_url of urls) {
    const c = await g.post<{ id: string }>(`/${igId}/media`, { image_url, is_carousel_item: true });
    children.push(c.id);
  }
  const carousel = await g.post<{ id: string }>(`/${igId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: input.caption,
  });
  return carousel.id;
}

export type IgContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

export async function igContainerStatus(g: GraphClient, containerId: string): Promise<IgContainerStatus> {
  const r = await g.get<{ status_code?: IgContainerStatus }>(`/${containerId}`, { fields: "status_code" });
  return r.status_code ?? "IN_PROGRESS";
}

export async function publishIgContainer(g: GraphClient, igId: string, containerId: string): Promise<PostedRef> {
  const r = await g.post<{ id: string }>(`/${igId}/media_publish`, { creation_id: containerId });
  return { id: r.id, url: await igPermalink(g, r.id) };
}

export async function igPermalink(g: GraphClient, mediaId: string): Promise<string | null> {
  try {
    const r = await g.get<{ permalink?: string }>(`/${mediaId}`, { fields: "permalink" });
    return r.permalink ?? null;
  } catch {
    return null;
  }
}

export async function findIgMedia(g: GraphClient, igId: string, marker: string): Promise<PostedRef | null> {
  const r = await g.get<{ data?: { id: string; caption?: string; permalink?: string }[] }>(`/${igId}/media`, {
    fields: "id,caption,permalink",
    limit: 25,
  });
  const hit = (r.data ?? []).find((m) => m.caption?.includes(marker));
  return hit ? { id: hit.id, url: hit.permalink ?? null } : null;
}

/** Posts used and allowed in the last 24 hours. */
export async function igPublishingLimit(g: GraphClient, igId: string): Promise<{ used: number; total: number } | null> {
  try {
    const r = await g.get<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
      `/${igId}/content_publishing_limit`,
      { fields: "quota_usage,config" },
    );
    const d = r.data?.[0];
    return d ? { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 50 } : null;
  } catch {
    return null;
  }
}

// ── OAuth: connecting the page ────────────────────────────────────────────

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
] as const;

/**
 * The Facebook dialog. A « Facebook Login for Business » app names its
 * permissions in a configuration (config_id); a classic one asks for scopes.
 */
export function oauthDialogUrl(opts: { appId: string; redirectUri: string; state: string; configId?: string | null }): string {
  const q = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    response_type: "code",
  });
  if (opts.configId) q.set("config_id", opts.configId);
  else q.set("scope", META_SCOPES.join(","));
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

async function tokenCall(url: string, doFetch: Fetch): Promise<{ access_token: string; expires_in?: number }> {
  let res: Response;
  try {
    res = await doFetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new GraphError(err instanceof Error ? err.message : "network error", "network");
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number } & GraphErrorBody;
  if (!res.ok || !json.access_token) {
    throw new GraphError(json.error?.message ?? `HTTP ${res.status}`, classifyGraphError(res.status, json), json.error?.code ?? null);
  }
  return { access_token: json.access_token, expires_in: json.expires_in };
}

/** The code from the dialog → a long-lived user token (about 60 days). */
export async function userTokenFromCode(
  opts: { appId: string; appSecret: string; redirectUri: string; code: string },
  doFetch: Fetch = fetch,
): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await tokenCall(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: opts.appId,
      client_secret: opts.appSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code,
    })}`,
    doFetch,
  );
  const long = await tokenCall(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: opts.appId,
      client_secret: opts.appSecret,
      fb_exchange_token: short.access_token,
    })}`,
    doFetch,
  );
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}

export type ManagedPage = {
  id: string;
  name: string;
  /** The page's vanity name (facebook.com/<username>), when it has one. */
  username: string | null;
  /** A page token from a long-lived user token does not expire. */
  accessToken: string;
  instagram: { id: string; username: string | null } | null;
};

/** The pages the person manages, each with its token and linked Instagram account. */
export async function managedPages(g: GraphClient): Promise<ManagedPage[]> {
  const r = await g.get<{
    data?: { id: string; name: string; username?: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  }>("/me/accounts", { fields: "id,name,username,access_token,instagram_business_account{id,username}", limit: 50 });
  return (r.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    username: p.username ?? null,
    accessToken: p.access_token,
    instagram: p.instagram_business_account
      ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
      : null,
  }));
}

/** Whether a token still works, and until when (GET /debug_token with the app token). */
export async function inspectToken(
  opts: { appId: string; appSecret: string; token: string },
  doFetch: Fetch = fetch,
): Promise<{ valid: boolean; expiresAt: Date | null; scopes: string[] }> {
  const q = new URLSearchParams({ input_token: opts.token, access_token: `${opts.appId}|${opts.appSecret}` });
  const res = await doFetch(`${GRAPH}/debug_token?${q}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as { data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] } };
  const d = json.data ?? {};
  return {
    valid: d.is_valid === true,
    // 0 means « never ».
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    scopes: d.scopes ?? [],
  };
}
