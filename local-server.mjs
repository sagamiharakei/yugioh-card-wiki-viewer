import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { onRequest as handleRecentRequest } from "./functions/api/recent.js";
import { onRequest as handleLookupRequest } from "./functions/api/lookup.js";
import { onRequest as handleSearchRequest } from "./functions/api/search.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const allowedHosts = new Set(["yugioh-wiki.net", "www.yugioh-wiki.net"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(body));
};

const sendFetchResponse = async (res, response) => {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
};

const decodeBody = (buffer, contentType) => {
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const encoding = charset || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
};

const handleArticle = async (req, res, requestUrl) => {
  const target = requestUrl.searchParams.get("url");
  if (!target) {
    sendJson(res, 400, { error: "url is required" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    sendJson(res, 400, { error: "invalid url" });
    return;
  }

  if (targetUrl.protocol !== "https:" || !allowedHosts.has(targetUrl.hostname)) {
    sendJson(res, 400, { error: "only ygowiki.net URLs are allowed" });
    return;
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: {
      "Accept": "text/html, text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "Yugioh Card Wiki Viewer/1.0"
    }
  });
  const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
  const buffer = await upstream.arrayBuffer();
  const html = decodeBody(buffer, contentType);
  sendJson(res, upstream.ok ? 200 : upstream.status, {
    url: targetUrl.toString(),
    contentType,
    html
  });
};

const serveFile = async (res, pathname) => {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const requested = safePath === "/" || safePath === "\\" ? "index.html" : safePath.replace(/^[/\\]+/, "");
  const filePath = join(root, requested);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  res.end(body);
};

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }
    if (requestUrl.pathname === "/api/article") {
      await handleArticle(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname === "/api/recent") {
      const response = await handleRecentRequest({
        request: new Request(requestUrl.toString(), { method: req.method || "GET" })
      });
      await sendFetchResponse(res, response);
      return;
    }
    if (requestUrl.pathname === "/api/lookup") {
      const response = await handleLookupRequest({
        request: new Request(requestUrl.toString(), { method: req.method || "GET" })
      });
      await sendFetchResponse(res, response);
      return;
    }
    if (requestUrl.pathname === "/api/search") {
      const response = await handleSearchRequest({
        request: new Request(requestUrl.toString(), { method: req.method || "GET" })
      });
      await sendFetchResponse(res, response);
      return;
    }
    await serveFile(res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`遊戯王カードWikiビューア: http://127.0.0.1:${port}`);
});
