#!/usr/bin/env node
/**
 * 使用与 wechat-download-api 兼容的接口批量订阅公众号，并生成 WECHAT_RSS_URLS 配置片段。
 * 依赖：.env 中已配置 WECHAT_RSS_URL（完整地址，含 token），用于解析 origin 与 query。
 *
 * 用法：
 *   node scripts/wechat-subscribe.js
 *   node scripts/wechat-subscribe.js --file data/wechat-subscriptions.json
 *
 * 文档：https://github.com/tmwgsicp/wechat-download-api
 */

const fs = require("fs/promises");
const path = require("path");

try {
  require(path.join(__dirname, "..", "server", "node_modules", "dotenv")).config({
    path: path.join(__dirname, "..", ".env"),
    override: true,
  });
} catch {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.join(__dirname, "..", "data", "wechat-subscriptions.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) {
      file = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { file };
}

function baseFromWechatRssUrl() {
  const raw = String(process.env.WECHAT_RSS_URL || "").trim();
  if (!raw) {
    throw new Error("请在 .env 中配置 WECHAT_RSS_URL（与控制台复制的 RSS 链接一致，含 token）");
  }
  const u = new URL(raw);
  const origin = u.origin;
  const qs = u.search || "";
  return { origin, qs, templateUrl: raw };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function main() {
  const { file } = parseArgs();
  const { origin, qs } = baseFromWechatRssUrl();

  const subscribeUrl = `${origin}/api/rss/subscribe${qs}`;
  const pollUrl = `${origin}/api/rss/poll${qs}`;
  const listUrl = `${origin}/api/rss/subscriptions${qs}`;

  const raw = await fs.readFile(file, "utf-8");
  const accounts = JSON.parse(raw);
  if (!Array.isArray(accounts)) {
    throw new Error("订阅文件必须是 JSON 数组");
  }

  const filled = accounts.filter((a) => a && String(a.fakeid || "").trim());
  if (!filled.length) {
    console.error("没有在 data/wechat-subscriptions.json 中填写任何 fakeid。");
    console.error("请先在 SaaS 控制台搜索公众号，或用 searchbiz 拿到 fakeid 后填入该文件。");
    process.exit(1);
  }

  console.log(`准备订阅 ${filled.length} 个公众号（接口：${origin}）...\n`);

  for (const row of filled) {
    const fakeid = String(row.fakeid).trim();
    const nickname = String(row.nickname || "").trim() || fakeid;
    const { ok, status, data } = await postJson(subscribeUrl, { fakeid, nickname });
    const msg = data?.message || data?.detail || (ok ? "ok" : JSON.stringify(data).slice(0, 200));
    console.log(`${ok ? "✓" : "✗"} ${nickname} (${fakeid}) → ${status} ${msg}`);
  }

  console.log("\n触发一次轮询（拉取最新文章到 RSS 缓存）...");
  const pollRes = await postJson(pollUrl, {});
  console.log(
    pollRes.ok
      ? `轮询：${pollRes.status} ${pollRes.data?.message || JSON.stringify(pollRes.data).slice(0, 120)}`
      : `轮询失败：${pollRes.status} ${pollRes.text?.slice(0, 300)}`
  );

  const listRes = await fetch(listUrl);
  const listText = await listRes.text();
  console.log("\n当前订阅列表（原始响应前 500 字符）：");
  console.log(listText.slice(0, 500) + (listText.length > 500 ? "..." : ""));

  const limit = process.env.WECHAT_RSS_LIMIT || "60";
  let qsWithLimit = qs;
  if (qsWithLimit && !/[?&]limit=/.test(qsWithLimit)) {
    qsWithLimit += `${qsWithLimit.includes("?") ? "&" : "?"}limit=${encodeURIComponent(limit)}`;
  } else if (!qsWithLimit) {
    qsWithLimit = `?limit=${encodeURIComponent(limit)}`;
  }
  const rssUrls = filled.map((row) => {
    const id = String(row.fakeid).trim();
    return `${origin}/api/rss/${id}${qsWithLimit}`;
  });

  console.log("\n=== 请将下面整行追加到 .env（多路 RSS 合并拉取）===\n");
  console.log(`WECHAT_RSS_URLS='${JSON.stringify(rssUrls)}'`);
  console.log("\n保留原来的 WECHAT_RSS_URL 亦可；刷新数据时会合并 WECHAT_RSS_URLS 中全部订阅源。");
  console.log("修改 .env 后请重启后端：cd server && node index.js\n");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
