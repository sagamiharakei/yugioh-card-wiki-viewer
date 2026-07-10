const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const RECENT_CHANGES_URL = "https://yugioh-wiki.net/index.php?RecentChanges";
const WIKI_BASE = "https://yugioh-wiki.net/";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store"
    }
  });

const decodeBody = (buffer, contentType) => {
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const encoding = charset || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
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
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));

const stripTags = (value) => decodeHtml(value.replace(/<[^>]+>/g, "")).trim();

const normalizeWikiUrl = (href) => {
  const url = new URL(decodeHtml(href), WIKI_BASE);
  url.protocol = "https:";
  url.hostname = "yugioh-wiki.net";
  url.port = "";
  return url.toString();
};

const parseRecentCards = (html, limit) => {
  const bodyStart = html.indexOf("<div id=\"body\">");
  const body = bodyStart >= 0 ? html.slice(bodyStart) : html;
  const items = [];
  const seen = new Set();
  const itemPattern = /<li>\s*(\d{4}-\d{2}-\d{2})\s+\(([^)]+)\)\s+(\d{2}:\d{2}:\d{2})\s+-\s+<a\s+[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of body.matchAll(itemPattern)) {
    const title = stripTags(match[6]);
    if (!/^《.+》$/.test(title)) continue;
    const titleAttribute = decodeHtml(match[5]);

    const pageName = title.replace(/^《/, "").replace(/》$/, "").trim();
    const key = pageName || title;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      title,
      pageName,
      url: normalizeWikiUrl(match[4]),
      date: match[1],
      weekday: match[2],
      time: match[3],
      relative: titleAttribute.match(/\(([^)]+)\)$/)?.[1] || ""
    });

    if (items.length >= limit) break;
  }

  return items;
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return json({ error: "GET only" }, 405);
  }

  const requestUrl = new URL(request.url);
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit")) || 10, 1), 20);

  const upstream = await fetch(RECENT_CHANGES_URL, {
    headers: {
      "Accept": "text/html, text/plain;q=0.9,*/*;q=0.8"
    }
  });
  const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
  const body = await upstream.arrayBuffer();
  const html = decodeBody(body, contentType);

  if (!upstream.ok) {
    return json({ error: `upstream ${upstream.status}` }, upstream.status);
  }

  return json({
    sourceUrl: RECENT_CHANGES_URL,
    fetchedAt: new Date().toISOString(),
    items: parseRecentCards(html, limit)
  });
}
