const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

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
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const encoding = charset || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
};

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return json({ error: "GET only" }, 405);
  }

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");
  if (!target) {
    return json({ error: "url is required" }, 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return json({ error: "invalid url" }, 400);
  }

  if (targetUrl.protocol !== "https:" || !allowedHosts.has(targetUrl.hostname)) {
    return json({ error: "only ygowiki.net URLs are allowed" }, 400);
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: {
      "Accept": "text/html, text/plain;q=0.9,*/*;q=0.8"
    }
  });

  const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
  const body = await upstream.arrayBuffer();
  const html = decodeBody(body, contentType);

  if (!upstream.ok) {
    return json({ error: `upstream ${upstream.status}`, html }, upstream.status);
  }

  return json({
    url: targetUrl.toString(),
    contentType,
    html
  });
}
