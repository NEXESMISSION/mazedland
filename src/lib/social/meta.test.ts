import { describe, it, expect } from "vitest";
import {
  classifyGraphError, createIgContainer, findPagePost, graphClient, GraphError, oauthDialogUrl, publishPagePost,
  type Fetch,
} from "./meta";

type Call = { method: string; url: string; body: URLSearchParams | null };

/** A Graph API stand-in: answers by « METHOD /path », records every call. */
function fakeGraph(routes: Record<string, (params: URLSearchParams) => unknown>) {
  const calls: Call[] = [];
  let n = 0;
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    calls.push({ method, url: url.toString(), body });
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: { message: "no route", code: 100 } }), { status: 400 });
    n += 1;
    const out = handler(body ?? url.searchParams);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? { id: `id-${n}` }), { status: 200 });
  };
  return { fetch, calls };
}

describe("classifyGraphError", () => {
  const kind = (status: number, code?: number, sub?: number, extra: Record<string, unknown> = {}) =>
    classifyGraphError(status, { error: { code, error_subcode: sub, ...extra } });

  it("asks for a reconnection when the token is no good", () => {
    expect(kind(400, 190)).toBe("auth");
    expect(kind(403, 200)).toBe("auth");
    expect(kind(400, 10)).toBe("auth");
  });
  it("waits when Meta says too many", () => {
    expect(kind(400, 4)).toBe("rate_limit");
    expect(kind(400, 32)).toBe("rate_limit");
    expect(kind(400, 9, 2207042)).toBe("rate_limit");
  });
  it("retries what is Meta's own trouble", () => {
    expect(kind(500, 1)).toBe("transient");
    expect(kind(400, 100, undefined, { is_transient: true })).toBe("transient");
    expect(kind(503)).toBe("transient");
  });
  it("tells a refused photo from a wrong request", () => {
    expect(kind(400, 36003)).toBe("media");
    expect(kind(400, 9004)).toBe("media");
    expect(kind(400, 100, 2207052)).toBe("media");
    expect(kind(400, 100)).toBe("permanent");
  });
  it("knows an expired container and a duplicate post", () => {
    expect(kind(400, 100, 2207020)).toBe("expired_container");
    expect(kind(400, 506)).toBe("duplicate");
  });
});

describe("graphClient", () => {
  it("sends the token in the body of a POST, with the app secret proof", async () => {
    const g = fakeGraph({ "POST /123/feed": () => ({ id: "123_1" }) });
    await graphClient("TOKEN", { appSecret: "SECRET", fetch: g.fetch }).post("/123/feed", { message: "hi" });
    const c = g.calls[0];
    expect(c.url).not.toContain("TOKEN");
    expect(c.body?.get("access_token")).toBe("TOKEN");
    expect(c.body?.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    expect(c.body?.get("message")).toBe("hi");
  });

  it("turns Meta's error into a GraphError of the right kind", async () => {
    const g = fakeGraph({
      "GET /me": () => new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), { status: 400 }),
    });
    const err = (await graphClient("T", { fetch: g.fetch }).get("/me").catch((e) => e)) as GraphError;
    expect(err).toBeInstanceOf(GraphError);
    expect(err.kind).toBe("auth");
    expect(err.code).toBe(190);
  });

  it("calls a dropped connection « network »: the outcome is unknown", async () => {
    const fetch: Fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const err = (await graphClient("T", { fetch }).post("/1/feed").catch((e) => e)) as GraphError;
    expect(err.kind).toBe("network");
  });
});

describe("page posts", () => {
  it("uploads the photos unpublished, then makes one post with them", async () => {
    const g = fakeGraph({
      "POST /PAGE/photos": () => undefined,
      "POST /PAGE/feed": () => ({ id: "PAGE_99" }),
      "GET /PAGE_99": () => ({ permalink_url: "https://facebook.com/PAGE/posts/99" }),
    });
    const r = await publishPagePost(graphClient("T", { fetch: g.fetch }), "PAGE", {
      message: "Réf. MZ-1A2B3C",
      imageUrls: ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg", "https://x/4.jpg", "https://x/5.jpg"],
    });
    const photos = g.calls.filter((c) => c.url.includes("/photos"));
    expect(photos).toHaveLength(4);
    expect(photos.every((c) => c.body?.get("published") === "false")).toBe(true);
    const feed = g.calls.find((c) => c.url.endsWith("/PAGE/feed"))!;
    expect(JSON.parse(feed.body!.get("attached_media")!)).toHaveLength(4);
    expect(r).toEqual({ id: "PAGE_99", url: "https://facebook.com/PAGE/posts/99" });
  });

  it("finds a post already online by its reference", async () => {
    const g = fakeGraph({
      "GET /PAGE/posts": () => ({
        data: [
          { id: "PAGE_1", message: "another one MZ-000000" },
          { id: "PAGE_2", message: "🏠 … Réf. MZ-1A2B3C", permalink_url: "https://fb/2" },
        ],
      }),
    });
    const hit = await findPagePost(graphClient("T", { fetch: g.fetch }), "PAGE", "MZ-1A2B3C");
    expect(hit).toEqual({ id: "PAGE_2", url: "https://fb/2" });
  });
});

describe("Instagram containers", () => {
  it("makes a carousel from several photos", async () => {
    const g = fakeGraph({ "POST /IG/media": (p) => ({ id: p.get("media_type") === "CAROUSEL" ? "CAROUSEL_1" : `child-${p.get("image_url")}` }) });
    const id = await createIgContainer(graphClient("T", { fetch: g.fetch }), "IG", {
      caption: "Réf. MZ-1A2B3C",
      imageUrls: ["a.jpg", "b.jpg"],
    });
    expect(id).toBe("CAROUSEL_1");
    const last = g.calls.at(-1)!.body!;
    expect(last.get("children")).toBe("child-a.jpg,child-b.jpg");
    expect(last.get("caption")).toBe("Réf. MZ-1A2B3C");
    expect(g.calls[0].body?.get("is_carousel_item")).toBe("true");
  });

  it("makes a single-photo container with the caption on it", async () => {
    const g = fakeGraph({ "POST /IG/media": () => ({ id: "ONE" }) });
    expect(await createIgContainer(graphClient("T", { fetch: g.fetch }), "IG", { caption: "c", imageUrls: ["a.jpg"] })).toBe("ONE");
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].body?.get("caption")).toBe("c");
  });

  it("refuses to post without a photo", async () => {
    const g = fakeGraph({});
    const err = await createIgContainer(graphClient("T", { fetch: g.fetch }), "IG", { caption: "c", imageUrls: [] }).catch((e) => e);
    expect(err.kind).toBe("media");
    expect(g.calls).toHaveLength(0);
  });
});

describe("oauthDialogUrl", () => {
  it("asks for the page and Instagram publishing permissions", () => {
    const u = new URL(oauthDialogUrl({ appId: "APP", redirectUri: "https://site/cb", state: "S" }));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.searchParams.get("scope")).toContain("pages_manage_posts");
    expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
    expect(u.searchParams.get("state")).toBe("S");
  });
});
