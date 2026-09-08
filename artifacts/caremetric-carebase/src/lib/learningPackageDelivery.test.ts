import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { proxyLearningPackage } from "../../server/learning-package-proxy.mjs";

const sessionId = "11111111-1111-4111-8111-111111111111";
const nonce = "a".repeat(64);
const path = `/_learning-packages/${sessionId}/${nonce}/course/index.html`;
const servers: Server[] = [];
async function serverWith(fetchImpl: typeof fetch, supabaseUrl: string | undefined = "https://backend.example") {
  const server = createServer((req, res) => {
    void proxyLearningPackage(req, res, req.url ?? "/", { supabaseUrl, fetchImpl }).then((handled: boolean) => {
      if (!handled) { res.writeHead(404); res.end(); }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

describe("package HTTP delivery", () => {
  it("serves real HTML with an enforced response sandbox even on direct navigation", async () => {
    const origin = await serverWith(async () => new Response('<html><script>window.packageLoaded = true</script></html>', {
      headers: { "Content-Type": "application/octet-stream", "X-Learning-Content-Type": "text/html; charset=utf-8" },
    }));
    const response = await fetch(origin + path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("sandbox allow-scripts allow-forms allow-popups");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("allow-top-navigation");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("window.packageLoaded");
  });

  it("preserves nested relative paths and allows credential-free opaque-origin JSON requests", async () => {
    let calledUrl = "";
    let calledHeaders: HeadersInit | undefined;
    const origin = await serverWith(async (url, init) => {
      calledUrl = String(url); calledHeaders = init?.headers;
      return new Response('{"lesson":2}', { headers: { "X-Learning-Content-Type": "application/json" } });
    });
    const asset = path.replace("index.html", "assets/lesson%20data.json?cache=123");
    const response = await fetch(origin + asset, { headers: { Origin: "null", Cookie: "session=host-secret", Authorization: "Bearer host-secret" } });
    expect(calledUrl).toBe(`https://backend.example/functions/v1/learning-package-asset/${sessionId}/${nonce}/course/assets/lesson%20data.json`);
    expect(new Headers(calledHeaders).has("cookie")).toBe(false);
    expect(new Headers(calledHeaders).has("authorization")).toBe(false);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
    expect(await response.json()).toEqual({ lesson: 2 });
  });

  it("forwards HEAD and single byte ranges for package media", async () => {
    let requestMethod = "";
    const origin = await serverWith(async (_url, init) => {
      requestMethod = init?.method ?? "";
      expect(new Headers(init?.headers).get("range")).toBe("bytes=3-8");
      return new Response(null, { status: 206, headers: { "X-Learning-Content-Type": "video/mp4", "Content-Range": "bytes 3-8/25", "Content-Length": "6" } });
    });
    const response = await fetch(origin + path.replace("index.html", "lesson.mp4"), { method: "HEAD", headers: { Range: "bytes=3-8" } });
    expect(requestMethod).toBe("HEAD");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 3-8/25");
    expect(await response.text()).toBe("");
  });

  it("rejects encoded traversal without contacting the backend", async () => {
    let calls = 0;
    const origin = await serverWith(async () => { calls++; return new Response("unexpected"); });
    for (const suffix of ["course/%2e%2e%2foutside.html", "course/%5c..%5coutside.html", "course/%00name.html", "course//name.html"]) {
      const response = await fetch(`${origin}/_learning-packages/${sessionId}/${nonce}/${suffix}`);
      expect(response.status).toBe(404);
    }
    expect(calls).toBe(0);
  });

  it("never treats auth errors, login redirects or invalid media types as package HTML", async () => {
    for (const upstream of [
      new Response("private backend diagnostic", { status: 404 }),
      new Response("login", { status: 302, headers: { Location: "https://evil.example" } }),
      new Response("unvalidated", { headers: { "Content-Type": "text/html" } }),
      new Response("unvalidated", { headers: { "X-Learning-Content-Type": "application/x-unreviewed" } }),
    ]) {
      const origin = await serverWith(async (_url, init) => { expect(init?.redirect).toBe("error"); return upstream; });
      const response = await fetch(origin + path, { redirect: "manual" });
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.has("location")).toBe(false);
      expect(await response.text()).not.toContain("private backend diagnostic");
    }
  });
});
