const WIKI_BASE = "https://yugioh-wiki.net/";
const ARTICLE_API = "./api/article";
const RECENT_API = "./api/recent";
const READER_BASE = "https://r.jina.ai/http://r.jina.ai/http://";
const ALL_ORIGINS_BASE = "https://api.allorigins.win/raw?url=";
const STORE_KEYS = {
  saved: "ygowiki-viewer:saved",
  history: "ygowiki-viewer:history",
  favorites: "ygowiki-viewer:favorites"
};
const CARD_ALIASES_URL = "./card-aliases.json";
const MANUAL_ALIAS_ENTRIES = [
  ["ブラックマジシャン", "ブラック・マジシャン"],
  ["ブラマジ", "ブラック・マジシャン"],
  ["ブラックマジシャンガール", "ブラック・マジシャン・ガール"],
  ["ブラマジガール", "ブラック・マジシャン・ガール"],
  ["ブルーアイズホワイトドラゴン", "青眼の白龍"],
  ["ブルーアイズ・ホワイト・ドラゴン", "青眼の白龍"],
  ["ブルーアイズ", "青眼の白龍"],
  ["青眼の白竜", "青眼の白龍"],
  ["レッドアイズブラックドラゴン", "真紅眼の黒竜"],
  ["レッドアイズ・ブラックドラゴン", "真紅眼の黒竜"],
  ["レッドアイズ", "真紅眼の黒竜"],
  ["はるうらら", "灰流うらら"],
  ["うらら", "灰流うらら"],
  ["増殖するG", "増殖するＧ"],
  ["増G", "増殖するＧ"],
  ["ニビル", "《原始生命態ニビル》"],
  ["原始生命態ニビル", "《原始生命態ニビル》"]
];

const config = {
  siteName: "遊戯王カードWikiビューア",
  siteOwnerName: "遊戯王カードWikiビューア",
  amazonAssociateTag: "YOUR-AMAZON-TAG-22",
  ...(globalThis.YUGIOH_CARD_WIKI_VIEWER_CONFIG || {})
};

const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#query");
const searchSuggestions = document.querySelector("#searchSuggestions");
const article = document.querySelector("#article");
const articleTitle = document.querySelector("#articleTitle");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const networkBadge = document.querySelector("#networkBadge");
const openOriginal = document.querySelector("#openOriginal");
const saveButton = document.querySelector("#saveButton");
const favoriteButton = document.querySelector("#favoriteButton");
const bottomSave = document.querySelector("#bottomSave");
const bottomFavorite = document.querySelector("#bottomFavorite");
const clearHistory = document.querySelector("#clearHistory");
const clearSaved = document.querySelector("#clearSaved");
const installButton = document.querySelector("#installButton");
const sidePanel = document.querySelector("#listSection");
const listToggle = document.querySelector("#listToggle");
const listContent = document.querySelector("#listContent");
const listPanel = document.querySelector("#listPanel");
const listTemplate = document.querySelector("#listItemTemplate");
const affiliateLinks = document.querySelector("#affiliateLinks");
const affiliateTemplate = document.querySelector("#affiliateLinkTemplate");
const associateDisclosure = document.querySelector("#associateDisclosure");
const tagStatus = document.querySelector("#tagStatus");
const recentSection = document.querySelector("#recent");
const recentToggle = document.querySelector("#recentToggle");
const recentContent = document.querySelector("#recentContent");
const recentCards = document.querySelector("#recentCards");
const recentRefresh = document.querySelector("#recentRefresh");

let currentArticle = null;
let currentList = "history";
let deferredInstallPrompt = null;
let manualAliasMap = null;
let fullAliasMap = null;
let fullAliasMapPromise = null;
let recentLoaded = false;

const hasAmazonTag = () =>
  Boolean(config.amazonAssociateTag && !config.amazonAssociateTag.includes("YOUR-AMAZON-TAG"));

const readList = (key) => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEYS[key]) || "[]");
  } catch {
    return [];
  }
};

const writeList = (key, items) => {
  localStorage.setItem(STORE_KEYS[key], JSON.stringify(items));
  renderList();
  syncActionButtons();
};

const encodeYgoPageName = (value) => {
  const encoding = globalThis.Encoding;
  if (!encoding?.convert || !encoding?.stringToCode) return encodeURIComponent(value);

  try {
    const bytes = encoding.convert(encoding.stringToCode(value), {
      to: "EUCJP",
      from: "UNICODE"
    });
    return bytes.map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`).join("");
  } catch {
    return encodeURIComponent(value);
  }
};

const decodeEucJpComponent = (value) => {
  const encoding = globalThis.Encoding;
  if (!encoding?.convert || !encoding?.codeToString) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  try {
    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "%" && index + 2 < value.length) {
        bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(value.charCodeAt(index));
      }
    }
    const unicode = encoding.convert(bytes, { to: "UNICODE", from: "EUCJP" });
    return encoding.codeToString(unicode);
  } catch {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
};

const toKatakana = (value) =>
  Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : char;
  }).join("");

const removeCardBrackets = (value) =>
  value.trim().replace(/^《/, "").replace(/》$/, "").trim();

const aliasKey = (value) =>
  toKatakana(removeCardBrackets(value))
    .replace(/[・･ \u3000\-‐‑‒–—－ー／\/＿_]/g, "")
    .toLowerCase();

const getManualAliasMap = () => {
  if (manualAliasMap) return manualAliasMap;

  manualAliasMap = new Map();
  for (const [alias, pageName] of MANUAL_ALIAS_ENTRIES) {
    manualAliasMap.set(aliasKey(alias), pageName);
    manualAliasMap.set(aliasKey(pageName), pageName);
  }
  return manualAliasMap;
};

const loadFullAliasMap = async () => {
  if (fullAliasMap) return fullAliasMap;
  if (!fullAliasMapPromise) {
    fullAliasMapPromise = fetch(CARD_ALIASES_URL)
      .then((response) => {
        if (!response.ok) throw new Error("alias dictionary unavailable");
        return response.json();
      })
      .then((data) => {
        const map = new Map(getManualAliasMap());
        Object.entries(data.aliases || {}).forEach(([key, pageName]) => {
          if (!map.has(key)) map.set(key, pageName);
        });
        fullAliasMap = map;
        return map;
      })
      .catch(() => {
        fullAliasMap = getManualAliasMap();
        return fullAliasMap;
      });
  }
  return fullAliasMapPromise;
};

const pageNameFromWikiUrl = (url) => {
  try {
    const parsed = new URL(url, WIKI_BASE);
    const rawQuery = parsed.search.slice(1);
    if (!rawQuery) return "";

    const pageParam = rawQuery
      .split("&")
      .map((part) => part.split("="))
      .find(([key]) => key === "page" || key === "refer");
    if (pageParam?.[1]) return decodeEucJpComponent(pageParam[1]);
    if (!rawQuery.includes("=")) return decodeEucJpComponent(rawQuery);
    return "";
  } catch {
    return "";
  }
};

const isCardPageName = (value = "") => /^《.+》$/.test(value.trim());

const normalizePageName = async (value) => {
  const trimmed = value.trim();
  if (isCardPageName(trimmed)) return trimmed;

  const key = aliasKey(trimmed);
  const manualAlias = getManualAliasMap().get(key);
  if (manualAlias) return manualAlias;

  const aliases = await loadFullAliasMap();
  return aliases.get(key) || trimmed;
};

const exactAliasPageName = async (value) => {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return "";
  if (isCardPageName(trimmed)) return trimmed;

  const key = aliasKey(trimmed);
  const manualAlias = getManualAliasMap().get(key);
  if (manualAlias) return manualAlias;

  const aliases = await loadFullAliasMap();
  const pageName = aliases.get(key);
  return pageName && aliasKey(pageName) === key ? pageName : "";
};

const findSearchCandidates = async (value, limit = 12) => {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || isCardPageName(trimmed)) return [];

  const queryKey = aliasKey(trimmed);
  if (queryKey.length < 2) return [];

  const aliases = await loadFullAliasMap();
  const candidates = new Map();

  const addCandidate = (pageName, score) => {
    if (!pageName) return;
    const current = candidates.get(pageName);
    if (!current || score < current.score) {
      candidates.set(pageName, { pageName, score });
    }
  };

  for (const [key, pageName] of aliases.entries()) {
    const pageKey = aliasKey(pageName);
    if (pageKey === queryKey) {
      addCandidate(pageName, 0);
    } else if (pageKey.startsWith(queryKey)) {
      addCandidate(pageName, 10);
    } else if (pageKey.includes(queryKey)) {
      addCandidate(pageName, 20);
    } else if (key === queryKey || key.startsWith(queryKey)) {
      addCandidate(pageName, 30);
    } else if (key.includes(queryKey)) {
      addCandidate(pageName, 40);
    }
  }

  return [...candidates.values()]
    .sort((a, b) =>
      a.score - b.score ||
      removeCardBrackets(a.pageName).length - removeCardBrackets(b.pageName).length ||
      a.pageName.localeCompare(b.pageName, "ja")
    )
    .slice(0, limit);
};

const normalizeTarget = async (value) => {
  const trimmed = value.trim();
  if (!trimmed) return { url: WIKI_BASE, pageName: "遊戯王カードWiki" };
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, pageName: pageNameFromWikiUrl(trimmed) || trimmed };
  }

  const pageName = await normalizePageName(trimmed);
  return {
    url: `${WIKI_BASE}index.php?${encodeYgoPageName(pageName)}`,
    pageName
  };
};

const toCardPageName = (value = "") => {
  const pageName = removeCardBrackets(value);
  return pageName ? `《${pageName}》` : "";
};

const canRetryAsCardPage = (rawValue, pageName = "") => {
  const raw = rawValue.trim();
  if (!raw || /^https?:\/\//i.test(raw)) return false;
  return !isCardPageName(raw) && !isCardPageName(pageName);
};

const isMissingPageContent = (content = "") =>
  /ページが見つかりませんでした|存在しないページ|-\s*[^<\n]+の編集|cmd=edit|textarea\s+name=/.test(content);

const titleFromUrl = (url, fallback) => {
  const cleanFallback = fallback?.trim();
  if (cleanFallback && !/^https?:\/\//i.test(cleanFallback)) return cleanFallback;
  try {
    const parsed = new URL(url);
    return pageNameFromWikiUrl(url) || decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
  } catch {
    return cleanFallback || "遊戯王カードWiki";
  }
};

const setStatus = (title, text) => {
  if (!statusTitle || !statusText) return;
  statusTitle.textContent = title;
  statusText.textContent = text;
};

const setNetworkState = () => {
  if (!networkBadge) return;
  const online = navigator.onLine;
  networkBadge.textContent = online ? "online" : "offline";
  networkBadge.classList.toggle("offline", !online);
};

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);

const linkify = (value) =>
  value.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

const renderText = (text) => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) html.push("<ul>");
      inList = true;
      html.push(`<li>${linkify(escapeHtml(line.replace(/^[-*]\s+/, "")))}</li>`);
    } else {
      closeList();
      html.push(`<p>${linkify(escapeHtml(line))}</p>`);
    }
  }
  closeList();
  return html.join("");
};

const isWikiUrl = (url) => {
  try {
    const parsed = new URL(url, WIKI_BASE);
    return ["yugioh-wiki.net", "www.yugioh-wiki.net"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const htmlToReadableHtml = (html) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rawTitle = doc.querySelector("title")?.textContent?.trim() || "";
  if (rawTitle.endsWith(" の編集") || doc.querySelector("form[action*='cmd=edit'], textarea[name='msg']")) {
    const pageName = rawTitle
      .replace(/^遊戯王カードWiki\s*-\s*/, "")
      .replace(/\s*の編集$/, "");
    return `
      <h1>ページが見つかりませんでした</h1>
      <p>「${escapeHtml(pageName || "入力したページ名")}」は遊戯王カードWiki側で存在しないページとして返されました。</p>
      <p>中点や正式表記を含めて検索し直してください。例: ブラック・マジシャン</p>
    `;
  }

  doc.querySelectorAll([
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "#header",
    "#navigator",
    "#menubar",
    "#footer",
    ".menubar",
    ".footer",
    ".jumpmenu",
    "ins.adsbygoogle"
  ].join(",")).forEach((node) => node.remove());

  const title = doc.querySelector("h1, title")?.textContent?.trim();
  const contentCell = doc.querySelector([
    "body > table > tbody > tr > td:not(.menubar)",
    "body > table > tr > td:not(.menubar)"
  ].join(","));
  const main = contentCell || doc.querySelector("#body, #content, main, article, .contents") || doc.body;

  main.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if ([
        "align",
        "border",
        "cellpadding",
        "cellspacing",
        "height",
        "nowrap",
        "size",
        "valign",
        "width"
      ].includes(name) || name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
      }
    });
  });

  main.querySelectorAll("a[href]").forEach((link) => {
    const rawHref = link.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;

    let resolved;
    try {
      resolved = new URL(rawHref, WIKI_BASE);
    } catch {
      link.removeAttribute("href");
      return;
    }

    if (!["http:", "https:"].includes(resolved.protocol)) {
      link.removeAttribute("href");
      return;
    }

    const resolvedUrl = resolved.toString();
    if (isWikiUrl(resolvedUrl)) {
      link.href = "#home";
      link.dataset.wikiUrl = resolvedUrl;
      link.classList.add("wiki-link");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      return;
    }
    link.target = "_blank";
    link.rel = "noopener";
  });

  const body = main.innerHTML
    .replace(/\u00a0/g, " ")
    .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .trim();
  return title ? `<h1>${escapeHtml(title.replace(/\s+-遊戯王カードWiki$/, ""))}</h1>${body}` : body;
};

const fetchText = async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`取得に失敗しました (${response.status})`);
  return response.text();
};

const fetchViaArticleApi = async (url) => {
  const endpoint = new URL(ARTICLE_API, location.href);
  endpoint.searchParams.set("url", url);
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`取得APIに接続できません (${response.status})`);
  const data = await response.json();
  if (data.text) return renderText(data.text);
  if (data.html) return htmlToReadableHtml(data.html);
  throw new Error("取得APIの応答が空でした");
};

const fetchArticle = async (url) => {
  const attempts = [
    () => fetchViaArticleApi(url),
    () => fetchText(`${READER_BASE}${url}`).then(renderText),
    () => fetchText(`${ALL_ORIGINS_BASE}${encodeURIComponent(url)}`).then(htmlToReadableHtml)
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const content = await attempt();
      if (content.length > 80) return content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("ページを取得できませんでした");
};

const renderRecentCards = (items) => {
  if (!recentCards) return;
  recentCards.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "list-url";
    empty.textContent = "最近更新されたカードを取得できませんでした。";
    recentCards.append(empty);
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.className = "recent-card";
    button.type = "button";

    const title = document.createElement("strong");
    title.textContent = item.title || item.pageName;

    const meta = document.createElement("small");
    meta.textContent = [item.date, item.time, item.relative ? `${item.relative}前` : ""]
      .filter(Boolean)
      .join(" / ");

    button.append(title, meta);
    button.addEventListener("click", () => {
      queryInput.value = item.pageName || item.title;
      openArticle(item.url);
    });
    recentCards.append(button);
  }
};

const loadRecentCards = async () => {
  if (!recentCards) return;

  recentLoaded = true;
  recentCards.innerHTML = '<p class="list-url">最近更新されたカードを読み込み中です。</p>';
  if (recentRefresh) recentRefresh.disabled = true;

  try {
    const endpoint = new URL(RECENT_API, location.href);
    endpoint.searchParams.set("limit", "10");
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`recent ${response.status}`);
    const data = await response.json();
    renderRecentCards(Array.isArray(data.items) ? data.items : []);
  } catch {
    recentCards.innerHTML = `
      <p class="list-url">最近更新されたカードを取得できませんでした。公開URLまたはローカルサーバーから開いてください。</p>
    `;
  } finally {
    if (recentRefresh) recentRefresh.disabled = false;
  }
};

const setRecentCollapsed = (collapsed, shouldLoad = true) => {
  if (!recentSection || !recentToggle || !recentContent) return;

  recentSection.classList.toggle("is-collapsed", collapsed);
  recentToggle.textContent = collapsed ? "表示" : "閉じる";
  recentToggle.setAttribute("aria-expanded", String(!collapsed));
  recentContent.hidden = collapsed;

  if (!collapsed && shouldLoad && !recentLoaded) {
    loadRecentCards();
  }
};

const environmentHelp = () => {
  if (location.protocol === "file:") {
    return "現在 file:// で開いているため、記事取得APIを使えません。local-server.mjs またはCloudflare Pagesなどの公開URLから開いてください。";
  }
  return "公開先に /api/article の取得APIが無い、または外部取得が制限されています。Cloudflare Pages Functions付きで公開してください。";
};

const toItem = ({ title, url, content = "" }) => ({
  title,
  url,
  content,
  updatedAt: new Date().toISOString()
});

const upsertList = (key, item, limit = 50) => {
  const next = readList(key).filter((entry) => entry.url !== item.url);
  next.unshift(item);
  writeList(key, next.slice(0, limit));
};

const isInList = (key, url) => readList(key).some((item) => item.url === url);

const syncActionButtons = () => {
  const hasArticle = Boolean(currentArticle);
  const favorited = hasArticle && isInList("favorites", currentArticle.url);
  const saved = hasArticle && isInList("saved", currentArticle.url);

  for (const button of [favoriteButton, bottomFavorite]) {
    button.disabled = !hasArticle;
    button.classList.toggle("active", favorited);
    button.textContent = favorited ? "お気に入り済み" : "お気に入り";
  }

  for (const button of [saveButton, bottomSave]) {
    button.disabled = !hasArticle;
    button.classList.toggle("active", saved);
    button.textContent = saved ? "保存済み" : "保存";
  }
};

const amazonUrl = (keyword) => {
  const url = new URL("https://www.amazon.co.jp/s");
  url.searchParams.set("k", keyword);
  if (hasAmazonTag()) url.searchParams.set("tag", config.amazonAssociateTag);
  return url.toString();
};

const affiliateItemsFor = (title = "") => {
  const base = title && title !== "未選択" ? title.replace(/^遊戯王カードWiki\s*-\s*/, "") : "遊戯王";
  return [
    {
      kicker: "カード検索",
      title: `${base} 関連カード`,
      text: "カード名に近い商品をAmazonで検索します。",
      keyword: `${base} 遊戯王`
    },
    {
      kicker: "保護",
      title: "スリーブ",
      text: "よく使うカードの保護用品を探します。",
      keyword: "遊戯王 スリーブ"
    },
    {
      kicker: "持ち運び",
      title: "デッキケース",
      text: "大会・店舗対戦向けのケースを探します。",
      keyword: "遊戯王 デッキケース"
    },
    {
      kicker: "整理",
      title: "ストレージ",
      text: "余ったカードやパーツ整理用の収納を探します。",
      keyword: "遊戯王 カード ストレージ"
    },
    {
      kicker: "補充",
      title: "パック・公式サプライ",
      text: "パックや公式周辺アイテムを探します。",
      keyword: "遊戯王 オフィシャルカードゲーム"
    }
  ];
};

const renderAffiliateLinks = (title) => {
  affiliateLinks.innerHTML = "";
  for (const item of affiliateItemsFor(title)) {
    const node = affiliateTemplate.content.firstElementChild.cloneNode(true);
    node.href = amazonUrl(item.keyword);
    node.querySelector(".affiliate-kicker").textContent = item.kicker;
    node.querySelector(".affiliate-title").textContent = item.title;
    node.querySelector(".affiliate-text").textContent = item.text;
    affiliateLinks.append(node);
  }
};

const clearSearchSuggestions = () => {
  if (!searchSuggestions) return;
  searchSuggestions.hidden = true;
  searchSuggestions.innerHTML = "";
};

const renderSearchSuggestions = (query, candidates) => {
  if (!searchSuggestions) return;

  searchSuggestions.innerHTML = "";
  if (!candidates.length) {
    clearSearchSuggestions();
    return;
  }

  const heading = document.createElement("div");
  heading.className = "search-suggestions-heading";

  const title = document.createElement("strong");
  title.textContent = `候補が複数あります`;

  const note = document.createElement("span");
  note.textContent = `「${query}」に近い候補から選んでください。`;

  heading.append(title, note);

  const list = document.createElement("div");
  list.className = "search-suggestion-list";

  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.className = "search-suggestion";
    button.type = "button";
    button.textContent = candidate.pageName;
    button.addEventListener("click", () => {
      clearSearchSuggestions();
      queryInput.value = candidate.pageName;
      openArticle(candidate.pageName);
    });
    list.append(button);
  }

  searchSuggestions.append(heading, list);
  searchSuggestions.hidden = false;
};

const scrollToViewer = () => {
  requestAnimationFrame(() => {
    document.querySelector(".viewer-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
};

const showArticle = ({ title, url, content, fromSaved = false }) => {
  currentArticle = toItem({ title, url, content });
  articleTitle.textContent = title;
  openOriginal.href = url;
  article.classList.remove("empty");
  article.innerHTML = /<\/?[a-z][\s\S]*>/i.test(content) ? content : renderText(content);
  renderAffiliateLinks(title);
  syncActionButtons();
  scrollToViewer();

  if (!fromSaved) {
    upsertList("history", toItem({ title, url }), 30);
  }
};

const handleSearch = async (value) => {
  const raw = value.trim();
  if (!raw || /^https?:\/\//i.test(raw) || isCardPageName(raw)) {
    clearSearchSuggestions();
    openArticle(value);
    return;
  }

  const exactPageName = await exactAliasPageName(raw);
  if (exactPageName) {
    clearSearchSuggestions();
    openArticle(exactPageName);
    return;
  }

  const candidates = await findSearchCandidates(raw);
  if (candidates.length > 1) {
    renderSearchSuggestions(raw, candidates);
    return;
  }

  clearSearchSuggestions();
  openArticle(candidates[0]?.pageName || raw);
};

const openArticle = async (value) => {
  clearSearchSuggestions();
  const target = await normalizeTarget(value);
  const url = target.url;
  const title = titleFromUrl(url, target.pageName);
  const rawTitle = value.trim();
  const saved = readList("saved").find((item) =>
    item.url === url || item.title === rawTitle || item.title === target.pageName
  );

  articleTitle.textContent = title;
  openOriginal.href = url;
  article.classList.add("empty");
  article.innerHTML = "<p>読み込み中です...</p>";
  currentArticle = null;
  renderAffiliateLinks(title);
  syncActionButtons();
  setStatus("読み込み中", "遊戯王カードWikiのページを取得しています。");

  if (!navigator.onLine && saved) {
    showArticle({ ...saved, fromSaved: true });
    setStatus("保存済みを表示", "オフラインのため、端末に保存した内容を開きました。");
    return;
  }

  try {
    let content = await fetchArticle(url);
    let displayTitle = title;
    let displayUrl = url;

    if (isMissingPageContent(content) && canRetryAsCardPage(rawTitle, target.pageName)) {
      const cardPageName = toCardPageName(target.pageName || rawTitle);
      const retryTarget = await normalizeTarget(cardPageName);

      if (retryTarget.url !== url) {
        try {
          const retryContent = await fetchArticle(retryTarget.url);
          if (!isMissingPageContent(retryContent)) {
            content = retryContent;
            displayUrl = retryTarget.url;
            displayTitle = titleFromUrl(displayUrl, retryTarget.pageName);
            queryInput.value = retryTarget.pageName;
          }
        } catch {
          // 元の検索結果をそのまま表示します。
        }
      }
    }

    showArticle({ title: displayTitle, url: displayUrl, content });
    setStatus("表示しました", "必要なら保存しておくとオフラインでも読めます。");
  } catch (error) {
    if (saved) {
      showArticle({ ...saved, fromSaved: true });
      setStatus("保存済みを表示", "オンライン取得に失敗したため、保存済みの内容を開きました。");
      return;
    }
    article.classList.add("empty");
    article.innerHTML = `
      <h2>ページを取得できませんでした</h2>
      <p>通信状態、取得元サイト、ブラウザの制限によって失敗することがあります。原文ボタンから公式ページを開けます。</p>
      <p>${escapeHtml(environmentHelp())}</p>
      <p>${escapeHtml(error.message)}</p>
    `;
    setStatus("取得失敗", "原文ボタンから公式ページを開いてください。");
  }
};

const toggleFavorite = () => {
  if (!currentArticle) return;
  if (isInList("favorites", currentArticle.url)) {
    writeList("favorites", readList("favorites").filter((item) => item.url !== currentArticle.url));
    setStatus("お気に入り解除", "お気に入りから外しました。");
    return;
  }
  upsertList("favorites", toItem(currentArticle), 80);
  setStatus("お気に入り追加", "あとで開きやすいように登録しました。");
};

const saveCurrentArticle = () => {
  if (!currentArticle) return;
  upsertList("saved", toItem(currentArticle), 40);
  setStatus("保存しました", "この端末でオフライン表示できるようになりました。");
};

const currentListLabel = (key = currentList) => ({
  history: "履歴",
  favorites: "お気に入り",
  saved: "保存済み"
})[key];

const syncListControls = () => {
  if (clearHistory) clearHistory.disabled = readList("history").length === 0;
};

const openStoredItem = (item, listKey = currentList) => {
  if (item.content) {
    showArticle({ ...item, fromSaved: listKey === "saved" });
    setStatus(`${currentListLabel(listKey)}を表示`, "端末内のリストから開きました。");
    return;
  }
  queryInput.value = item.title;
  openArticle(item.url);
};

const renderList = () => {
  listPanel.innerHTML = "";
  syncListControls();

  const items = readList(currentList);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "list-url";
    empty.textContent = `${currentListLabel()}はまだありません。`;
    listPanel.append(empty);
    return;
  }

  for (const item of items) {
    const node = listTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".list-title").textContent = item.title;
    node.addEventListener("click", () => {
      openStoredItem(item, currentList);
    });
    listPanel.append(node);
  }
};

const selectList = (key, scrollIntoView = false) => {
  currentList = key;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.list === key);
  });
  renderList();
  if (scrollIntoView) {
    setListCollapsed(false);
    document.querySelector(".side-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

const setListCollapsed = (collapsed) => {
  if (!sidePanel || !listToggle || !listContent) return;

  sidePanel.classList.toggle("is-collapsed", collapsed);
  listToggle.textContent = collapsed ? "表示" : "閉じる";
  listToggle.setAttribute("aria-expanded", String(!collapsed));
  listContent.hidden = collapsed;
};

const setupAffiliateDisclosure = () => {
  associateDisclosure.textContent = `Amazonのアソシエイトとして、${config.siteOwnerName}は適格販売により収入を得ています。`;
  tagStatus.textContent = hasAmazonTag() ? "タグ設定済み" : "タグ未設定";
  tagStatus.classList.toggle("ready", hasAmazonTag());
};

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    selectList(button.dataset.list);
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSearch(queryInput.value);
});

queryInput.addEventListener("input", () => {
  if (!queryInput.value.trim()) clearSearchSuggestions();
});

article.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-wiki-url]");
  if (!link) return;
  event.preventDefault();
  const targetUrl = link.dataset.wikiUrl;
  if (!targetUrl) return;
  queryInput.value = pageNameFromWikiUrl(targetUrl) || link.textContent.trim();
  openArticle(targetUrl);
});

favoriteButton.addEventListener("click", toggleFavorite);
bottomFavorite.addEventListener("click", toggleFavorite);
saveButton.addEventListener("click", saveCurrentArticle);
bottomSave.addEventListener("click", saveCurrentArticle);

clearSaved.addEventListener("click", () => {
  if (!readList("saved").length) return;
  if (confirm("保存済み記事をすべて削除しますか？")) {
    writeList("saved", []);
    setStatus("整理しました", "保存済み記事を削除しました。");
  }
});

clearHistory?.addEventListener("click", () => {
  if (!readList("history").length) return;
  if (confirm("履歴をすべて削除しますか？")) {
    writeList("history", []);
    setStatus("履歴を削除しました", "検索履歴を空にしました。");
  }
});

listToggle?.addEventListener("click", () => {
  setListCollapsed(!sidePanel.classList.contains("is-collapsed"));
});

recentRefresh?.addEventListener("click", () => {
  setRecentCollapsed(false, false);
  loadRecentCards();
});

recentToggle?.addEventListener("click", () => {
  setRecentCollapsed(!recentSection.classList.contains("is-collapsed"));
});

window.addEventListener("online", setNetworkState);
window.addEventListener("offline", setNetworkState);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

setupAffiliateDisclosure();
setNetworkState();
renderList();
setListCollapsed(true);
renderAffiliateLinks();
syncActionButtons();
setRecentCollapsed(true);
