const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const allowedHosts = new Set(["yugioh-wiki.net", "www.yugioh-wiki.net"]);

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

const pageTitle = (html) => decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
  .replace(/<[^>]+>/g, "")
  .trim();

const isMissingPage = (html, title) =>
  /<form[^>]+action=["'][^"']*cmd=edit/i.test(html) ||
  /<textarea[^>]+name=["']msg/i.test(html) ||
  /の編集$/.test(title);

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "GET only" }, 405);

  const sourceUrl = new URL(request.url);
  const target = sourceUrl.searchParams.get("url");
  if (!target) return json({ error: "url is required" }, 400);

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: "invalid url" }, 400);
  }
  if (targetUrl.protocol !== "https:" || !allowedHosts.has(targetUrl.hostname)) {
    return json({ error: "only yugioh-wiki.net URLs are allowed" }, 400);
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: { Accept: "text/html, text/plain;q=0.9,*/*;q=0.8" }
  });
  const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
  const html = decodeBody(await upstream.arrayBuffer(), contentType);
  const title = pageTitle(html);

  return json({
    exists: upstream.ok && !isMissingPage(html, title),
    title
  }, upstream.ok ? 200 : upstream.status);
}
