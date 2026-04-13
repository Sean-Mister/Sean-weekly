const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const { XMLParser } = require("fast-xml-parser");

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });
const {
  scoreArticles,
  summarizeArticle,
  buildWeekly,
  skillScreenArticle,
} = require("./bailian");
const {
  resolveSourceTypeForWechatChannel,
  normalizeArticlesSourceTypes,
} = require("./wechat-source-types");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const DATA_DIR = path.join(__dirname, "..", "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const RSS_SYNC_STATE_FILE = path.join(DATA_DIR, "rss-sync-state.json");
const CHANNEL_INDUSTRIES_FILE = path.join(DATA_DIR, "wechat-channel-industries.json");
const DEFAULT_RSS_URL = process.env.WECHAT_RSS_URL || "";
/** 多路 RSS（12 个公众号等）：JSON 数组字符串，或逗号/换行分隔的多个完整 RSS URL */
function getRssUrlsFromEnv() {
  const multi = String(process.env.WECHAT_RSS_URLS || "").trim();
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed)) {
        return parsed.map((u) => String(u).trim()).filter(Boolean);
      }
    } catch {
      return multi
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  const single = String(process.env.WECHAT_RSS_URL || "").trim();
  return single ? [single] : [];
}
/** 同步前先调用 wechat-download-api 的 POST /api/rss/poll（与 WECHAT_RSS_URL 同源同 token） */
const WECHAT_RSS_POLL = String(process.env.WECHAT_RSS_POLL || "true").toLowerCase() !== "false";

/** 部分 SaaS（如 waytomaster）上 RSS 可读，但 /api/rss/poll 会 404「未订阅」或仅允许 GET；此类失败不应让同步表现为报错 */
function isBenignWechatPollError(message) {
  const s = String(message || "");
  if (/未订阅/.test(s)) return true;
  if (/RSS 轮询请求失败\s+404/.test(s)) return true;
  if (/RSS 轮询请求失败\s+405/.test(s)) return true;
  if (/RSS 轮询请求失败/.test(s) && /Method Not Allowed/i.test(s)) return true;
  return false;
}
const WEIXIN_MONGO_URI = process.env.WEIXIN_MONGO_URI || "mongodb://127.0.0.1:27017";
const WEIXIN_MONGO_DB = process.env.WEIXIN_MONGO_DB || "WeixinData4";

async function readJsonFileSafe(filePath, fallback = []) {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** 同步拉取新列表时，按 id 合并本地已有字段，避免已模型打分/人工状态被覆盖 */
function mergeArticleExtrasFromPrevious(prevList, incoming) {
  const prev = Array.isArray(prevList) ? prevList : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  /** 远端 0 条时不得清空本地：incoming.map([]) 会得到 [] 误删全部文章 */
  if (incomingList.length === 0) {
    return prev;
  }
  const byId = new Map(prev.map((a) => [a.id, a]));
  return incomingList.map((item) => {
    const old = byId.get(item.id);
    if (!old) {
      return item;
    }
    const merged = { ...item };
    if (old.skillEnrich && typeof old.skillEnrich === "object") {
      merged.skillEnrich = old.skillEnrich;
    }
    if (old.issueStatuses && typeof old.issueStatuses === "object") {
      merged.issueStatuses = old.issueStatuses;
    }
    if (typeof old.aiSummary === "string" && old.aiSummary.trim()) {
      merged.aiSummary = old.aiSummary;
    }
    if (typeof old.aiCommentary === "string" && old.aiCommentary.trim()) {
      merged.aiCommentary = old.aiCommentary;
    }
    return merged;
  });
}

function normalizeDateInput(input, endOfDay = false) {
  const value = String(input || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const dt = new Date(`${value}${suffix}`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function pickArticleText(raw) {
  return raw.article || raw.digest || raw.machine_digest || "";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageFromHtml(html) {
  const raw = String(html || "");
  const imgMatch = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : "";
}

function mapWeixinDoc(raw, index) {
  const publishDate = raw.p_date instanceof Date
    ? raw.p_date.toISOString().slice(0, 10)
    : String(raw.p_date || "").slice(0, 10);
  return {
    id: raw.content_url ? `wx-${Buffer.from(raw.content_url).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}` : `wx-${index + 1}`,
    title: raw.title || `未命名文章${index + 1}`,
    sourceName: raw.nickname || "微信公众号",
    sourceType: resolveSourceTypeForWechatChannel(raw.nickname || ""),
    publishDate,
    imageUrl: raw.cover || "",
    url: raw.content_url || raw.source_url || "",
    body: pickArticleText(raw),
    status: "new"
  };
}

async function syncArticlesFromWeixin({ startDate, endDate }) {
  const client = new MongoClient(WEIXIN_MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const db = client.db(WEIXIN_MONGO_DB);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const collectionNames = collections
      .map((item) => item.name)
      .filter((name) => !name.startsWith("system."))
      .filter((name) => name !== "queue");
    const allDocs = [];
    const start = normalizeDateInput(startDate, false);
    const end = normalizeDateInput(endDate, true);

    for (const name of collectionNames) {
      const col = db.collection(name);
      const filter = {
        title: { $exists: true, $nin: ["", "-"] },
        content_url: { $exists: true, $nin: ["", "-"] },
      };
      if (start && end) {
        filter.p_date = { $gte: start, $lte: end };
      }
      const docs = await col.find(filter).project({
        _id: 0,
        nickname: 1,
        title: 1,
        content_url: 1,
        source_url: 1,
        digest: 1,
        machine_digest: 1,
        article: 1,
        cover: 1,
        p_date: 1,
      }).toArray();
      allDocs.push(...docs);
    }

    const dedup = new Map();
    allDocs.forEach((doc) => {
      const key = doc.content_url || `${doc.nickname || ""}-${doc.title || ""}`;
      if (!dedup.has(key)) dedup.set(key, doc);
    });

    const mapped = [...dedup.values()]
      .map(mapWeixinDoc)
      .filter((item) => item.title && item.url)
      .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

    const prevArticles = await readJsonFileSafe(ARTICLES_FILE, []);
    const merged = mergeArticleExtrasFromPrevious(prevArticles, mapped);
    await writeJsonFile(ARTICLES_FILE, merged);
    return {
      count: mapped.length,
      startDate,
      endDate,
      scannedCollections: collectionNames.length,
      source: "weixin",
      keptPreviousBecauseEmpty: mapped.length === 0 && prevArticles.length > 0,
      persistedCount: merged.length,
    };
  } finally {
    await client.close();
  }
}

/**
 * 与开源 wechat-download-api 一致：POST /api/rss/poll 手动触发轮询，再读 RSS 才有最新文章。
 * SaaS（如 waytomaster）部分仅允许 GET /api/rss/poll?token=...，POST 会 405，故在 405 时回退 GET。
 */
async function triggerWechatRssPoll(fullRssUrl) {
  let pollUrl;
  try {
    const u = new URL(String(fullRssUrl).trim());
    pollUrl = `${u.origin}/api/rss/poll${u.search}`;
  } catch {
    throw new Error("WECHAT_RSS_URL 格式无效，需为完整 https URL");
  }
  const jsonHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  let res = await fetch(pollUrl, {
    method: "POST",
    headers: jsonHeaders,
    body: "{}",
  });
  if (res.status === 405) {
    res = await fetch(pollUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.data?.message || data?.message || text.slice(0, 300);
    throw new Error(`RSS 轮询请求失败 ${res.status}: ${msg}`);
  }
  if (data && data.success === false) {
    const msg = data.data?.message || data.message || "RSS 轮询未成功";
    throw new Error(msg);
  }
  return { pollUrl, data };
}

/** 保证拉取条数：在查询串中设置 limit（默认每源 60 条，可由 WECHAT_RSS_PER_FEED_LIMIT 覆盖） */
/** 微信文章链接稳定哈希；勿再用 base64 截断（会与 mp.weixin 前缀大量碰撞） */
function rssArticleIdFromLink(link) {
  const s = String(link || "").trim();
  if (!s) return "";
  return `rss-${crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 24)}`;
}

function ensureWechatRssFeedLimit(urlStr, limit = 60) {
  try {
    const u = new URL(String(urlStr).trim());
    u.searchParams.set("limit", String(limit));
    return u.toString();
  } catch {
    return String(urlStr).trim();
  }
}

/**
 * 首次 RSS 同步：不写回 issueStatuses / aiSummary 等本地字段（见 mergeArticleExtrasFromPrevious）。
 * 状态文件 data/rss-sync-state.json；删除该文件或传 resetFirstRssImport 可再次「首次清空」。
 * 环境变量 RSS_FORCE_MERGE_MANUAL=true 时始终合并（与旧行为一致）。
 */
async function syncArticlesFromRss({ rssUrl, rssUrls, startDate, endDate, resetFirstRssImport, forceMergeManual }) {
  if (resetFirstRssImport) {
    try {
      await fs.unlink(RSS_SYNC_STATE_FILE);
    } catch {
      /* 不存在则忽略 */
    }
  }
  let urlList = [];
  if (Array.isArray(rssUrls) && rssUrls.length) {
    urlList = rssUrls.map((u) => String(u).trim()).filter(Boolean);
  } else if (String(rssUrl || "").trim()) {
    urlList = [String(rssUrl).trim()];
  } else {
    urlList = getRssUrlsFromEnv();
  }
  if (!urlList.length) {
    throw new Error("缺少 RSS 地址：请在 .env 配置 WECHAT_RSS_URL 或 WECHAT_RSS_URLS，或在请求体传入 rssUrl / rssUrls");
  }

  const perFeedLimit = Math.min(
    200,
    Math.max(1, Number(process.env.WECHAT_RSS_PER_FEED_LIMIT || "60") || 60)
  );
  urlList = urlList.map((u) => ensureWechatRssFeedLimit(u, perFeedLimit));

  let pollResult = null;
  if (WECHAT_RSS_POLL) {
    const pollErrors = [];
    let pollOk = 0;
    for (let i = 0; i < urlList.length; i++) {
      try {
        await triggerWechatRssPoll(urlList[i]);
        pollOk += 1;
      } catch (err) {
        pollErrors.push({ feedIndex: i, message: err.message || String(err) });
      }
      if (i < urlList.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    pollResult =
      pollOk === 0 && pollErrors.length
        ? pollErrors.every((e) => isBenignWechatPollError(e.message))
          ? { benignAllFailed: true, errors: pollErrors }
          : { error: pollErrors[0].message || "全部 RSS 轮询失败" }
        : {
            ok: true,
            fedCount: pollOk,
            totalFeeds: urlList.length,
            errors: pollErrors.length ? pollErrors : undefined,
          };
  } else {
    pollResult = { skipped: true };
  }

  const start = normalizeDateInput(startDate, false);
  const end = normalizeDateInput(endDate, true);

  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });

  const allMapped = [];
  const errors = [];

  for (let fi = 0; fi < urlList.length; fi++) {
    const feedUrl = urlList[fi];
    try {
      const response = await fetch(feedUrl, { redirect: "follow" });
      if (!response.ok) {
        errors.push({ feedUrl, status: response.status });
        continue;
      }
      const xmlText = await response.text();
      const parsed = parser.parse(xmlText);
      const channel = parsed?.rss?.channel || {};
      const channelTitle = channel?.title || "微信公众号";
      const itemsRaw = channel?.item || [];
      const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

      items.forEach((item, index) => {
        const rawHtml = item["content:encoded"] || item.description || "";
        const body = htmlToText(rawHtml);
        const publishDate = new Date(item.pubDate || "");
        allMapped.push({
          id: item.link ? rssArticleIdFromLink(item.link) : `rss-${fi}-${index + 1}`,
          title: item.title || `未命名文章${index + 1}`,
          sourceName: channelTitle,
          sourceType: resolveSourceTypeForWechatChannel(channelTitle),
          publishDate: Number.isNaN(publishDate.getTime()) ? "" : publishDate.toISOString().slice(0, 10),
          imageUrl: extractImageFromHtml(rawHtml),
          url: item.link || "",
          body,
          status: "new"
        });
      });
    } catch (err) {
      errors.push({ feedUrl, error: err.message || String(err) });
    }
  }

  const dedup = new Map();
  allMapped
    .filter((item) => item.title && item.url)
    .forEach((item) => {
      if (!dedup.has(item.url)) dedup.set(item.url, item);
    });

  const mapped = [...dedup.values()];
  const filtered = mapped
    .filter((item) => {
      if (!start || !end || !item.publishDate) return true;
      const dt = new Date(`${item.publishDate}T12:00:00.000Z`);
      return dt >= start && dt <= end;
    })
    .sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  const prevArticles = await readJsonFileSafe(ARTICLES_FILE, []);
  const rssState = await readJsonFileSafe(RSS_SYNC_STATE_FILE, { firstRssImportDone: false });
  const envForceMerge = String(process.env.RSS_FORCE_MERGE_MANUAL || "").toLowerCase() === "true";
  const bodyForceMerge = forceMergeManual === true;
  const firstImportDone = rssState && rssState.firstRssImportDone === true;
  const shouldMergeManual =
    envForceMerge || bodyForceMerge || firstImportDone;

  let merged;
  let clearedManualOnFirstRss = false;
  let keptPreviousBecauseEmpty = false;
  if (shouldMergeManual) {
    merged = mergeArticleExtrasFromPrevious(prevArticles, filtered);
    keptPreviousBecauseEmpty = filtered.length === 0 && prevArticles.length > 0;
  } else {
    if (filtered.length === 0 && prevArticles.length > 0) {
      merged = prevArticles;
      keptPreviousBecauseEmpty = true;
    } else {
      merged = filtered;
      clearedManualOnFirstRss = true;
      await writeJsonFile(RSS_SYNC_STATE_FILE, { firstRssImportDone: true });
    }
  }

  await writeJsonFile(ARTICLES_FILE, merged);
  const pollPayload = pollResult?.skipped
    ? { ok: false, skipped: true, message: "已跳过远端轮询（WECHAT_RSS_POLL=false）" }
    : pollResult?.benignAllFailed
      ? {
          ok: true,
          message:
            "远端轮询接口不可用或未开放（如仅支持读 RSS），已跳过轮询并直接导入 RSS，内容仍可用",
          pollErrors: pollResult.errors,
        }
      : pollResult?.error
        ? { ok: false, message: pollResult.error }
        : pollResult?.fedCount != null
        ? {
            ok: true,
            message: `已对 ${pollResult.fedCount}/${pollResult.totalFeeds} 路公众号 RSS 触发轮询`,
            fedCount: pollResult.fedCount,
            totalFeeds: pollResult.totalFeeds,
            pollErrors: pollResult.errors,
          }
        : {
            ok: true,
            message: pollResult?.data?.data?.message || pollResult?.data?.message || "轮询完成",
          };
  return {
    count: filtered.length,
    startDate,
    endDate,
    source: "rss",
    rssFeeds: urlList.length,
    perFeedLimit,
    rssUrl: urlList[0],
    rssUrls: urlList,
    feedErrors: errors.length ? errors : undefined,
    poll: pollPayload,
    rssManualStateCleared: clearedManualOnFirstRss,
    rssMergeManual: shouldMergeManual,
    keptPreviousBecauseEmpty,
    persistedCount: merged.length,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "weekly-server",
    model: process.env.ARK_MODEL || "seed-2-0-mini-260215",
  });
});

/**
 * 前端用：是否已在服务端配置 RSS（token 只在 .env，不下发完整地址）
 * 文档：https://github.com/tmwgsicp/wechat-download-api
 */
app.get("/api/config", (req, res) => {
  const urls = getRssUrlsFromEnv();
  const rssConfigured = urls.length > 0;
  res.json({
    ok: true,
    wechatRssConfigured: rssConfigured,
    wechatRssFeedCount: urls.length,
    wechatDownloadApiRepo: "https://github.com/tmwgsicp/wechat-download-api",
    wechatRssSaaS: "https://wechatrss.waytomaster.com",
  });
});

/** 公众号名称 → 产业栏目标签（与前端 SASAC 栏目一致，供筛选联动） */
app.get("/api/channel-industries", async (req, res) => {
  try {
    const raw = await fs.readFile(CHANNEL_INDUSTRIES_FILE, "utf-8");
    const map = JSON.parse(raw);
    res.json({ ok: true, map: typeof map === "object" && map ? map : {} });
  } catch {
    res.json({ ok: true, map: {} });
  }
});

app.get("/api/articles", async (req, res) => {
  const raw = await readJsonFileSafe(ARTICLES_FILE, []);
  const articles = normalizeArticlesSourceTypes(raw);
  res.json({ ok: true, count: articles.length, articles });
});

app.post("/api/articles", async (req, res) => {
  const { articles } = req.body || {};
  if (!Array.isArray(articles)) {
    return res.status(400).json({ ok: false, message: "articles 必须是数组" });
  }

  const normalized = normalizeArticlesSourceTypes(articles);
  await writeJsonFile(ARTICLES_FILE, normalized);
  return res.json({ ok: true, count: normalized.length });
});

app.post("/api/articles/refresh", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      source = "weixin",
      rssUrl,
      rssUrls,
      resetFirstRssImport,
      forceMergeManual,
    } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({ ok: false, message: "startDate 和 endDate 不能为空，格式为 YYYY-MM-DD" });
    }
    const result = source === "rss"
      ? await syncArticlesFromRss({
          rssUrl,
          rssUrls,
          startDate,
          endDate,
          resetFirstRssImport: resetFirstRssImport === true,
          forceMergeManual: forceMergeManual === true,
        })
      : await syncArticlesFromWeixin({ startDate, endDate });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "同步微信公众号数据失败" });
  }
});

app.post("/api/skill-screen", async (req, res) => {
  try {
    const { article } = req.body || {};
    if (!article || typeof article !== "object") {
      return res.status(400).json({ ok: false, message: "article 必须是对象" });
    }
    const result = await skillScreenArticle(article);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "skill-screen 失败" });
  }
});

app.post("/api/score", async (req, res) => {
  try {
    const {
      articles,
      preference = "高质量、信息密度高、结构清晰、可执行性强",
      topN = 10,
    } = req.body || {};

    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ ok: false, message: "articles 不能为空数组" });
    }

    const result = await scoreArticles(articles, preference, Number(topN) || 10);
    return res.json({ ok: true, count: result.length, articles: result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "score 失败" });
  }
});

app.post("/api/summarize", async (req, res) => {
  try {
    const { article } = req.body || {};
    if (!article || typeof article !== "object") {
      return res.status(400).json({ ok: false, message: "article 必须是对象" });
    }

    const summary = await summarizeArticle(article);
    return res.json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "summarize 失败" });
  }
});

app.post("/api/weekly", async (req, res) => {
  try {
    const { articles, weeklyTitle = "本周精选周刊" } = req.body || {};
    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({ ok: false, message: "articles 不能为空数组" });
    }

    const html = await buildWeekly(articles, weeklyTitle);
    return res.json({ ok: true, html });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || "weekly 失败" });
  }
});

app.use(express.static(FRONTEND_DIR));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
