#!/usr/bin/env node
/**
 * 一次性修复：旧版 RSS id 用 base64 截断导致全部撞车为 rss-aHR0cHM6Ly9tcC53ZWl4。
 * 按 url 用 sha256 重新生成 id。仅处理含 http(s) 的 url。
 */
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

function rssArticleIdFromLink(link) {
  const s = String(link || "").trim();
  if (!s) return "";
  return `rss-${crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 24)}`;
}

async function main() {
  const file = path.join(__dirname, "..", "data", "articles.json");
  const raw = await fs.readFile(file, "utf-8");
  const articles = JSON.parse(raw);
  if (!Array.isArray(articles)) {
    throw new Error("articles.json 应为数组");
  }
  let n = 0;
  for (const a of articles) {
    const url = String(a.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (String(a.id || "").startsWith("wx-")) continue;
    const next = rssArticleIdFromLink(url);
    if (next && a.id !== next) {
      a.id = next;
      n += 1;
    }
  }
  await fs.writeFile(file, JSON.stringify(articles, null, 2), "utf-8");
  console.log(`已更新 ${n} 条 RSS 文章的 id（按 url 重算）。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
