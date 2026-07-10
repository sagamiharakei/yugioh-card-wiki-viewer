const WIKI_BASE = "https://yugioh-wiki.net/";
const ARTICLE_API = "./api/article";
const READER_BASE = "https://r.jina.ai/http://r.jina.ai/http://";
const ALL_ORIGINS_BASE = "https://api.allorigins.win/raw?url=";
const STORE_KEYS = {
  saved: "ygowiki-viewer:saved",
  history: "ygowiki-viewer:history",
  favorites: "ygowiki-viewer:favorites"
};
const PAGE_ALIASES = new Map([
  ["ブラックマジシャン", "ブラック・マジシャン"],
  ["ブラックマジシャンガール", "ブラック・マジシャン・ガール"],
  ["ブルーアイズホワイトドラゴン", "青眼の白龍"],
  ["青眼の白竜", "青眼の白龍"],
  ["レッドアイズブラックドラゴン", "真紅眼の黒竜"]
]);

const config = {
  siteName: "遊戯王カードWikiビューア",
  siteOwnerName: "遊戯王カードWikiビューア",
  amazonAssociateTag: "YOUR-AMAZON-TAG-22",
  ...(globalThis.YUGIOH_CARD_WIKI_VIEWER_CONFIG || {})
};

const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#query");
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
const clearSaved = document.querySelector("#clearSaved");
const installButton = document.querySelector("#installButton");
const listPanel = document.querySelector("#listPanel");
const listTemplate = document.querySelector("#listItemTemplate");
const affiliateLinks = document.querySelector("#affiliateLinks");
const affiliateTemplate = document.querySelector("#affiliateLinkTemplate");
const associateDisclosure = document.querySelector("#associateDisclosure");
const tagStatus = document.querySelector("#tagStatus");

let currentArticle = null;
let currentList = "history";
let deferredInstallPrompt = null;

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

const normalizePageName = (value) => {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[・\s　]/g, "");
  return PAGE_ALIASES.get(compact) || trimmed;
};

const normalizeUrl = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return WIKI_BASE;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${WIKI_BASE}index.php?${encodeYgoPageName(normalizePageName(trimmed))}`;
};

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
  statusTitle.textContent = title;
  statusText.textContent = text;
};

const setNetworkState = () => {
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
      if (name.startsWith("on") || name === "style") element.removeAttribute(attribute.name);
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

const showArticle = ({ title, url, content, fromSaved = false }) => {
  currentArticle = toItem({ title, url, content });
  articleTitle.textContent = title;
  openOriginal.href = url;
  article.classList.remove("empty");
  article.innerHTML = /<\/?[a-z][\s\S]*>/i.test(content) ? content : renderText(content);
  renderAffiliateLinks(title);
  syncActionButtons();

  if (!fromSaved) {
    upsertList("history", toItem({ title, url }), 30);
  }
};

const openArticle = async (value) => {
  const url = normalizeUrl(value);
  const title = titleFromUrl(url, /^https?:\/\//i.test(value.trim()) ? value : normalizePageName(value));
  const saved = readList("saved").find((item) => item.url === url || item.title === value.trim());

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
    const content = await fetchArticle(url);
    showArticle({ title, url, content });
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

const currentListLabel = () => ({
  history: "履歴",
  favorites: "お気に入り",
  saved: "保存済み"
})[currentList];

const renderList = () => {
  listPanel.innerHTML = "";
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
    node.querySelector(".list-url").textContent = item.url;
    node.addEventListener("click", () => {
      if (item.content) {
        showArticle({ ...item, fromSaved: currentList === "saved" });
        setStatus(`${currentListLabel()}を表示`, "端末内のリストから開きました。");
      } else {
        queryInput.value = item.title;
        openArticle(item.url);
      }
    });
    listPanel.append(node);
  }
};

const setupAffiliateDisclosure = () => {
  associateDisclosure.textContent = `Amazonのアソシエイトとして、${config.siteOwnerName}は適格販売により収入を得ています。`;
  tagStatus.textContent = hasAmazonTag() ? "タグ設定済み" : "タグ未設定";
  tagStatus.classList.toggle("ready", hasAmazonTag());
};

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentList = button.dataset.list;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    renderList();
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  openArticle(queryInput.value);
});

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.page;
    openArticle(button.dataset.page);
  });
});

article.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-wiki-url]");
  if (!link) return;
  event.preventDefault();
  const targetUrl = link.dataset.wikiUrl;
  if (!targetUrl) return;
  queryInput.value = pageNameFromWikiUrl(targetUrl) || link.textContent.trim();
  openArticle(targetUrl);
  document.querySelector("#home")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
renderAffiliateLinks();
syncActionButtons();
