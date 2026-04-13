#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");

function pickText(item) {
  return item.article || item.content || item.digest || item.machine_digest || "";
}

function mapFromWeixin(item, index) {
  const title = item.title || `未命名文章${index + 1}`;
  const content = pickText(item);
  const publishDateRaw = item.p_date || item.publish_date || "";
  const publishDate = String(publishDateRaw).slice(0, 10);
  return {
    id: item.article_id ? `wx-${item.article_id}` : `wx-local-${index + 1}`,
    title,
    sourceName: item.nickname || "微信公众号",
    sourceType: "official_media",
    publishDate,
    url: item.content_url || item.source_url || "",
    body: content,
    status: "new"
  };
}

async function main() {
  const workspaceRoot = path.join(__dirname, "..");
  const inputPath = process.argv[2];
  const sourcePath = inputPath
    ? path.resolve(process.cwd(), inputPath)
    : path.join(workspaceRoot, "data", "weixin_export.json");
  const targetPath = path.join(workspaceRoot, "data", "articles.json");

  const raw = await fs.readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(raw);

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.articles)
      ? parsed.articles
      : [];

  if (!items.length) {
    throw new Error("导入文件中未找到文章数组（支持 [] 或 { articles: [] }）");
  }

  const mapped = items.map(mapFromWeixin).filter((a) => a.title && a.body);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(mapped, null, 2), "utf-8");

  console.log(`导入完成: ${mapped.length} 篇 -> ${targetPath}`);
}

main().catch((err) => {
  console.error("导入失败:", err.message);
  process.exit(1);
});
