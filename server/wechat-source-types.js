/**
 * 微信公众号名称 → 前端信源类型（与资讯列表「信源」筛选一致）
 * 行业协会 / 头部企业官方：当前订阅无对应账号
 */
const WECHAT_CHANNEL_SOURCE_TYPE = {
  人民日报: "official_media",
  央视新闻: "official_media",
  科技日报: "official_media",
  新京报: "official_media",
  观察者网: "official_media",
  中国政府网: "government",
  国资小新: "government",
  聚龙智库: "thinktank",
  全球技术地图: "thinktank",
  财经早餐: "industry_media",
  财经网: "industry_media",
  势能资本: "self_media",
};

function resolveSourceTypeForWechatChannel(channelTitle) {
  const raw = String(channelTitle || "").trim();
  if (WECHAT_CHANNEL_SOURCE_TYPE[raw]) {
    return WECHAT_CHANNEL_SOURCE_TYPE[raw];
  }
  const stripped = raw.replace(/公众号|微信|订阅号|服务号|\s+/g, "").trim();
  if (stripped && WECHAT_CHANNEL_SOURCE_TYPE[stripped]) {
    return WECHAT_CHANNEL_SOURCE_TYPE[stripped];
  }
  return "official_media";
}

function normalizeArticleSourceType(article) {
  if (!article || typeof article !== "object") {
    return article;
  }
  const name = article.sourceName || article.source_name || "";
  const sourceType = resolveSourceTypeForWechatChannel(name);
  if (article.sourceType === sourceType) {
    return article;
  }
  return { ...article, sourceType };
}

function normalizeArticlesSourceTypes(articles) {
  if (!Array.isArray(articles)) {
    return [];
  }
  return articles.map(normalizeArticleSourceType);
}

module.exports = {
  WECHAT_CHANNEL_SOURCE_TYPE,
  resolveSourceTypeForWechatChannel,
  normalizeArticleSourceType,
  normalizeArticlesSourceTypes,
};
