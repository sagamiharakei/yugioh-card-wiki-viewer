const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const WIKI_BASE = "https://yugioh-wiki.net/";
const allowedHosts = new Set(["yugioh-wiki.net", "www.yugioh-wiki.net"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }
  });

const decodeBody = (buffer, contentType) => {
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
};

const decodeHtml = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'");

const stripTags = (value) => decodeHtml(value.replace(/<[^>]+>/g, "")).trim();

const decodeEucJpComponent = (value) => {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "%" && index + 2 < value.length) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(value.charCodeAt(index));
    }
  }
  try {
    return new TextDecoder("euc-jp").decode(new Uint8Array(bytes));
  } catch {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
};

const pageNameFromUrl = (url) => {
  const rawQuery = url.search.slice(1);
  if (!rawQuery || url.searchParams.has("cmd")) return "";

  const pageParam = rawQuery
    .split("&")
    .map((part) => part.split("="))
    .find(([key]) => key === "page" || key === "refer");
  if (pageParam?.[1]) return decodeEucJpComponent(pageParam[1]);
  return rawQuery.includes("=") ? "" : decodeEucJpComponent(rawQuery);
};

const parseSearchResults = (html, limit) => {
  const bodyStart = html.indexOf('<div id="body">');
  const footerStart = html.indexOf('<div id="footer"', Math.max(bodyStart, 0));
  const body = bodyStart >= 0
    ? html.slice(bodyStart, footerStart > bodyStart ? footerStart : undefined)
    : html;
  const items = [];
  const seen = new Set();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of body.matchAll(linkPattern)) {
    const title = stripTags(match[2]);
    if (!title) continue;

    let url;
    try {
      url = new URL(decodeHtml(match[1]), WIKI_BASE);
    } catch {
      continue;
    }
    if (!allowedHosts.has(url.hostname)) continue;

    const pageName = pageNameFromUrl(url);
    if (!pageName || seen.has(pageName)) continue;
    seen.add(pageName);
    items.push({ pageName, title, url: url.toString() });
    if (items.length >= limit) break;
  }
  return items;
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "GET only" }, 405);

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit")) || 12, 1), 20);
  if (!target) return json({ error: "url is required" }, 400);

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: "invalid url" }, 400);
  }
  if (
    targetUrl.protocol !== "https:" ||
    !allowedHosts.has(targetUrl.hostname) ||
    targetUrl.searchParams.get("cmd") !== "search"
  ) {
    return json({ error: "only wiki search URLs are allowed" }, 400);
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: { Accept: "text/html, text/plain;q=0.9,*/*;q=0.8" }
  });
  if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, upstream.status);

  const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
  const html = decodeBody(await upstream.arrayBuffer(), contentType);
  return json({ items: parseSearchResults(html, limit) });
}
