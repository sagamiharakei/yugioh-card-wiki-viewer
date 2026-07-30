const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const allowedHosts = new Set(["yugioh-wiki.net", "www.yugioh-wiki.net"]);
const DIRECT_TIMEOUT_MS = 3500;
const READER_TIMEOUT_MS = 10000;

const withTimeout = async (operation, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

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

const readerFallback = async (targetUrl) => {
  const readerUrl = `https://r.jina.ai/${targetUrl.toString()}`;
  const result = await withTimeout(async (signal) => {
    const response = await fetch(readerUrl, {
      signal,
      headers: {
        "Accept": "text/plain,*/*;q=0.8"
      }
    });
    const text = await response.text();
    return { response, text };
  }, READER_TIMEOUT_MS);

  if (!result.response.ok) {
    throw new Error(`reader ${result.response.status}`);
  }

  return json({
    url: targetUrl.toString(),
    contentType: "text/plain; charset=utf-8",
    text: result.text
  });
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

  let result;
  try {
    result = await withTimeout(async (signal) => {
      const upstream = await fetch(targetUrl.toString(), {
        signal,
        headers: {
          "Accept": "text/html, text/plain;q=0.9,*/*;q=0.8"
        }
      });
      const contentType = upstream.headers.get("content-type") || "text/html; charset=utf-8";
      const body = await upstream.arrayBuffer();
      return { upstream, contentType, body };
    }, DIRECT_TIMEOUT_MS);
  } catch {
    try {
      return await readerFallback(targetUrl);
    } catch {
      return json({ error: "upstream and reader fallback unavailable" }, 504);
    }
  }

  const { upstream, contentType, body } = result;
  const html = decodeBody(body, contentType);

  if (!upstream.ok) {
    try {
      return await readerFallback(targetUrl);
    } catch {
      return json({ error: `upstream ${upstream.status}`, html }, upstream.status);
    }
  }

  return json({
    url: targetUrl.toString(),
    contentType,
    html
  });
}
