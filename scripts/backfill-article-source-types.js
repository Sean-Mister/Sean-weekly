#!/usr/bin/env node
/**
 * 按 server/wechat-source-types.js 规则，一次性修正 data/articles.json 中的 sourceType。
 * 用法：cd server && npm run backfill:source-types
 */
const fs = require("fs/promises");
const path = require("path");
const { normalizeArticlesSourceTypes } = require("../server/wechat-source-types");

const ARTICLES_FILE = path.join(__dirname, "..", "data", "articles.json");

async function main() {
  let raw;
  try {
    raw = await fs.readFile(ARTICLES_FILE, "utf-8");
  } catch (e) {
    console.error("无法读取", ARTICLES_FILE, e.message);
    process.exit(1);
  }
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) {
    console.error("articles.json 应为数组");
    process.exit(1);
  }
  const next = normalizeArticlesSourceTypes(arr);
  const before = JSON.stringify(arr);
  const after = JSON.stringify(next);
  if (before === after) {
    console.log("无需修改：sourceType 已与信源名称一致。");
    return;
  }
  await fs.writeFile(ARTICLES_FILE, JSON.stringify(next, null, 2), "utf-8");
  console.log(`已更新 ${arr.length} 条文章的 sourceType，已写回 ${ARTICLES_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
