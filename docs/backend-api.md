# 产业情报周刊系统后端接口文档

本文档基于当前代码实现整理（`server/src/index.js` + `frontend/public/assets/scripts/app.js`）。

- 本地服务默认地址：`http://localhost:3000`
- 接口统一返回 JSON（除静态页面路由）
- 目前无鉴权（开发态）

---

## 1. 通用约定

### 1.1 响应格式

- 成功：通常包含 `ok: true`
- 失败：通常包含 `ok: false` 与 `message`

示例：

```json
{ "ok": true, "count": 123, "articles": [] }
```

```json
{ "ok": false, "message": "articles 必须是数组" }
```

### 1.2 文章核心字段（后端存储/返回）

- `id`: 文章 ID
- `title`: 标题
- `sourceName`: 信源名
- `sourceType`: 信源类型（会被服务端归一化）
- `publishDate`: `YYYY-MM-DD`
- `imageUrl`: 封面图
- `url`: 原文链接
- `body`: 正文文本
- `status`: 默认状态（通常 `new`）
- `issueStatuses`: 各期人工状态（如 `issue-214: candidate`）
- `skillEnrich`: skill 初筛结构化结果
- `aiSummary` / `aiCommentary`: AI 摘要与点评

---

## 2. 健康与配置

### 2.1 健康检查

**GET** `/api/health`

响应示例：

```json
{
  "ok": true,
  "service": "weekly-server",
  "model": "doubao-seed-1-6-flash-250828"
}
```

### 2.2 前端配置

**GET** `/api/config`

用途：前端判断是否启用 RSS 模式、展示配置说明。

响应示例：

```json
{
  "ok": true,
  "wechatRssConfigured": true,
  "wechatRssFeedCount": 12,
  "wechatDownloadApiRepo": "https://github.com/tmwgsicp/wechat-download-api",
  "wechatRssSaaS": "https://wechatrss.waytomaster.com"
}
```

### 2.3 公众号栏目映射

**GET** `/api/channel-industries`

响应示例：

```json
{
  "ok": true,
  "map": {
    "人民日报": ["产业动态"],
    "国资小新": ["工作部署"]
  }
}
```

---

## 3. 文章列表与同步

### 3.1 获取文章列表

**GET** `/api/articles`

响应示例：

```json
{
  "ok": true,
  "count": 530,
  "articles": [
    {
      "id": "rss-xxxx",
      "title": "示例标题",
      "sourceName": "人民日报",
      "sourceType": "official_media",
      "publishDate": "2026-04-13",
      "url": "https://mp.weixin.qq.com/...",
      "body": "..."
    }
  ]
}
```

### 3.2 覆盖保存文章列表

**POST** `/api/articles`

请求体：

```json
{
  "articles": []
}
```

说明：将前端当前列表写回服务端（含人工状态、skill、摘要等）。

成功响应：

```json
{ "ok": true, "count": 530 }
```

失败响应（参数错误）：

```json
{ "ok": false, "message": "articles 必须是数组" }
```

### 3.3 刷新同步文章

**POST** `/api/articles/refresh`

用途：从 Mongo 或 RSS 拉取文章并写入 `data/articles.json`。

请求体字段：

- `startDate`（必填）：`YYYY-MM-DD`
- `endDate`（必填）：`YYYY-MM-DD`
- `source`（可选）：`"weixin"` 或 `"rss"`，默认 `"weixin"`
- `rssUrl`（可选）：单个 RSS URL
- `rssUrls`（可选）：多个 RSS URL 数组
- `resetFirstRssImport`（可选，bool）：重置首次 RSS 同步状态
- `forceMergeManual`（可选，bool）：强制保留人工状态并合并

#### 3.3.1 RSS 模式成功响应示例

```json
{
  "ok": true,
  "count": 530,
  "startDate": "1970-01-01",
  "endDate": "2026-04-13",
  "source": "rss",
  "rssFeeds": 12,
  "perFeedLimit": 60,
  "rssUrl": "https://...",
  "rssUrls": ["https://..."],
  "poll": {
    "ok": true,
    "message": "已对 12/12 路公众号 RSS 触发轮询",
    "fedCount": 12,
    "totalFeeds": 12
  },
  "rssManualStateCleared": false,
  "rssMergeManual": true,
  "keptPreviousBecauseEmpty": false,
  "persistedCount": 530
}
```

#### 3.3.2 Weixin 模式成功响应示例

```json
{
  "ok": true,
  "count": 120,
  "startDate": "2026-04-07",
  "endDate": "2026-04-13",
  "scannedCollections": 28,
  "source": "weixin",
  "keptPreviousBecauseEmpty": false,
  "persistedCount": 530
}
```

#### 3.3.3 失败响应示例

```json
{
  "ok": false,
  "message": "startDate 和 endDate 不能为空，格式为 YYYY-MM-DD"
}
```

```json
{
  "ok": false,
  "message": "缺少 RSS 地址：请在 .env 配置 WECHAT_RSS_URL 或 WECHAT_RSS_URLS，或在请求体传入 rssUrl / rssUrls"
}
```

---

## 4. AI 与编辑能力接口

### 4.1 Skill 初筛（单篇）

**POST** `/api/skill-screen`

请求体：

```json
{
  "article": {
    "title": "xxx",
    "body": "xxx",
    "url": "https://...",
    "sourceName": "人民日报",
    "publishDate": "2026-04-13"
  }
}
```

成功响应（示例）：

```json
{
  "ok": true,
  "totalScore": 82,
  "industry": 18,
  "authority": 18,
  "impact": 26,
  "novelty": 12,
  "verifiability": 8,
  "tagSection": "产业动态",
  "relatedIndustries": ["新一代信息技术产业"],
  "tagCandidateType": "政策法规与制度发布候选",
  "decision": "进入候选池"
}
```

失败响应：

```json
{ "ok": false, "message": "article 必须是对象" }
```

### 4.2 批量评分

**POST** `/api/score`

请求体：

```json
{
  "articles": [{ "title": "xxx", "content": "xxx" }],
  "preference": "高质量、信息密度高、结构清晰、可执行性强",
  "topN": 10
}
```

成功响应：

```json
{
  "ok": true,
  "count": 10,
  "articles": []
}
```

### 4.3 单篇摘要

**POST** `/api/summarize`

请求体：

```json
{
  "article": {
    "title": "xxx",
    "content": "xxx",
    "url": "https://...",
    "sourceName": "人民日报",
    "publishDate": "2026-04-13"
  }
}
```

成功响应：

```json
{
  "ok": true,
  "summary": "事件摘要：... \n数据亮点：... \n产业意义：..."
}
```

### 4.4 周刊生成

**POST** `/api/weekly`

请求体：

```json
{
  "weeklyTitle": "本周精选周刊",
  "articles": [
    {
      "title": "xxx",
      "url": "https://...",
      "content": "xxx",
      "summary": "xxx",
      "score": 85
    }
  ]
}
```

成功响应：

```json
{
  "ok": true,
  "html": "<!doctype html>..."
}
```

---

## 5. 静态资源与前端路由

- 服务端静态目录：`frontend/public`
- 非 `/api` 路由会回退到 `index.html`（前端路由入口）

即：

- `GET /` -> `frontend/public/index.html`
- `GET /login.html` -> 静态文件
- `GET /xxx`（非 `/api`）-> `index.html`

---

## 6. 前端当前实际调用接口清单

来自 `frontend/public/assets/scripts/app.js` 的 `APP_CONFIG`（非 GitHub Pages 静态模式）：

- `GET /api/articles`
- `POST /api/articles`
- `GET /api/config`
- `GET /api/channel-industries`
- `POST /api/articles/refresh`
- `POST /api/score`
- `POST /api/skill-screen`
- `POST /api/summarize`
- `POST /api/weekly`

---

## 7. 运行相关环境变量（接口行为相关）

- `PORT`：服务端端口（默认 `3000`）
- `WECHAT_RSS_URL` / `WECHAT_RSS_URLS`：RSS 源
- `WECHAT_RSS_POLL`：刷新时是否触发 `/api/rss/poll`（默认 true）
- `WECHAT_RSS_PER_FEED_LIMIT`：每路 RSS 拉取条数（默认 60）
- `RSS_FORCE_MERGE_MANUAL`：RSS 同步是否强制合并保留人工状态
- `WEIXIN_MONGO_URI` / `WEIXIN_MONGO_DB`：Mongo 同步来源
- `ARK_*`：AI 能力相关配置（score / skill-screen / summarize / weekly）

