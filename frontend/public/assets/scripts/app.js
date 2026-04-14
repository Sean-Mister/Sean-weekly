/** GitHub Pages（/docs）静态托管时由 docs/index.html 注入为 true */
function isWeeklyStaticDeploy() {
  return typeof window !== "undefined" && window.__WEEKLY_STATIC_DEPLOY__ === true;
}

function buildAppConfig() {
  if (isWeeklyStaticDeploy()) {
    return {
      listEndpoint: "data/articles.json",
      articlesSaveEndpoint: "data/articles.json",
      configEndpoint: "data/config.json",
      channelIndustriesEndpoint: "data/channel-industries.json",
      refreshEndpoint: "/api/articles/refresh",
      scoreEndpoint: "/api/score",
      skillScreenEndpoint: "/api/skill-screen",
      summarizeEndpoint: "/api/summarize",
      weeklyEndpoint: "/api/weekly"
    };
  }
  return {
    listEndpoint: "/api/articles",
    articlesSaveEndpoint: "/api/articles",
    configEndpoint: "/api/config",
    channelIndustriesEndpoint: "/api/channel-industries",
    refreshEndpoint: "/api/articles/refresh",
    scoreEndpoint: "/api/score",
    skillScreenEndpoint: "/api/skill-screen",
    summarizeEndpoint: "/api/summarize",
    weeklyEndpoint: "/api/weekly"
  };
}

const APP_CONFIG = buildAppConfig();

/** 本地标记：用户已成功执行过「刷新数据」，之后才自动拉取列表与模型 */
const STORAGE_KEY_ARTICLE_SYNC = "weekly_article_sync_v1";

/**
 * 每期 = 固定 7 个自然日：结束日 = 开始日 + MAX_ISSUE_RANGE_DAYS（相差 6 天即一周 7 日）。
 * 第 N 期起始日 = ISSUE_REF_WEEK_START + (N - ISSUE_REF_NUMBER)×7。
 * 214 期为当前最后一期；选往期可查看该期在 article.issueStatuses[`issue-${N}`] 等中的记录。
 */
const ISSUE_REF_NUMBER = 214;
const ISSUE_REF_WEEK_START = "2026-04-06";
const ISSUE_SELECT_MIN = 1;
const ISSUE_SELECT_MAX = 214;

function getCurrentIssueNumber() {
  const el = document.getElementById("issue-select");
  if (!el || el.value === "") {
    return ISSUE_REF_NUMBER;
  }
  const n = Number(el.value);
  return Number.isFinite(n) ? n : ISSUE_REF_NUMBER;
}

function getCurrentIssueId() {
  return `issue-${getCurrentIssueNumber()}`;
}

const SCORE_RULES = [
  { key: "industry", label: "素材完整度与产业相关性", max: 20 },
  { key: "authority", label: "来源规范与可信度", max: 20 },
  { key: "impact", label: "事实密度与产业意义", max: 30 },
  { key: "novelty", label: "条型匹配度", max: 20 },
  { key: "verifiability", label: "可入版性与语言克制", max: 10 }
];

/** 与 sasac-weekly-screener/SKILL.md 第六步栏目一致（产业筛选、初判、大模型输出均对齐） */
const SASAC_INDUSTRY_LABELS = [
  "工作部署",
  "产业动态",
  "新一代信息技术产业",
  "高端装备制造产业",
  "新材料产业",
  "生物制造产业",
  "新能源汽车产业",
  "新能源产业",
  "节能环保产业",
  "低空经济产业",
  "商业航天产业",
  "其他",
];

const INDUSTRY_KEYWORDS = {
  工作部署: ["部署", "印发", "出台", "方案", "意见", "通知", "领导小组", "督察", "考核", "专题会议", "国务院", "部委联合"],
  产业动态: ["产业运行", "行业数据", "同比增长", "环比", "景气", "产能", "市场格局", "行业动态", "运行态势"],
  新一代信息技术产业: ["人工智能", "芯片", "半导体", "算力", "网络安全", "智能体", "插件", "漏洞", "数据中心", "5g", "6g", "信创", "大模型"],
  高端装备制造产业: ["机床", "工业机器人", "轨道交通", "大飞机", "发动机", "盾构机", "装备制造", "首台套", "数控"],
  新材料产业: ["碳纤维", "稀土", "合金", "高分子", "新材料", "化工材料", "特种钢", "复合材料"],
  生物制造产业: ["合成生物", "生物制造", "发酵", "酶工程", "基因工程", "创新药", "疫苗", "医疗器械", "生物制药", "细胞治疗"],
  新能源汽车产业: ["新能源汽车", "电动车", "动力电池", "整车", "充电", "换电", "车企", "智能驾驶", "车规级"],
  新能源产业: ["光伏", "风电", "储能", "氢能", "电网", "太阳能", "光储", "绿电", "装机"],
  节能环保产业: ["节能", "环保", "碳达峰", "碳中和", "绿色", "排污", "垃圾处理", "焚烧", "生态", "循环经济"],
  低空经济产业: ["低空", "无人机", "evtol", "飞行器", "通航", "空域", "航路"],
  商业航天产业: ["卫星", "火箭", "航天", "星座", "激光通信", "文昌", "发射场", "嫦娥", "探月"],
  其他: [],
};

const CANDIDATE_TYPE_PATTERNS = {
  "领导活动与工作部署类": ["总书记", "国务院", "国资委", "会议强调", "部署", "工作部署", "专题会议"],
  "政策法规与制度发布类": ["印发", "出台", "发布", "通知", "意见", "管理办法", "制度", "细则"],
  "风险预警与规范提醒类": ["风险", "预警", "通报", "漏洞", "安全提示", "风险提示", "应急提醒"],
  "国际博弈与外部规则施压类": ["制裁", "出口管制", "实体清单", "关税", "禁令", "施压"],
  "国际趋势与竞争变量变化类": ["国际", "全球", "欧盟", "美国", "日本", "韩国", "趋势", "竞争变量"],
  "投资合作与资本运作类": ["融资", "并购", "投资", "收购", "签约", "合作", "上市", "重组"],
  "产品发布与平台上线类": ["发布", "推出", "上线", "平台", "系统", "产品", "模型"],
  "标志性成果与首台套突破类": ["首台套", "首个", "首次", "突破", "填补空白", "量产"],
  "性能突破与数据披露类": ["同比", "环比", "增长", "下降", "装机", "出货", "交付", "数据披露"],
  "医药研发进展子类": ["临床", "获批", "适应症", "药物", "新药", "药审"],
  "负面调整与合作终止子类": ["终止", "暂停", "撤回", "下调", "裁员", "减产", "合作终止"],
  "讲话提炼型工作部署子类": ["讲话", "指出", "强调", "提出", "工作要求", "部署要求"]
};

const AUTHORITY_SCORES = {
  official_media: 18,
  government: 20,
  association: 16,
  enterprise: 15,
  thinktank: 14,
  industry_media: 11,
  self_media: 4
};

const STRONG_AUTHORITY_TYPES = new Set(["official_media", "government", "association", "enterprise", "thinktank"]);
const HIGH_VALUE_TITLE_HINTS = ["首台套", "最大", "突破", "规范", "部署", "政策", "国产替代", "自主可控", "量产", "联动", "退出", "风险"];

const MOCK_ARTICLES = [
  {
    id: "art-001",
    title: "六部门部署进一步规范光伏产业竞争秩序",
    sourceName: "新华社",
    sourceType: "official_media",
    publishDate: "2026-04-08",
    url: "https://example.com/policy-photovoltaic",
    body: "新华社北京4月8日电，国家发展改革委、工业和信息化部等六部门联合部署进一步规范光伏产业竞争秩序，要求加强投资管理、产品质量监督和落后产能退出，推动光伏产业高质量发展。通知明确提出将围绕重点企业、重点产能和重点区域开展专项治理，并强调加强政策联动和产业链上下游协同，维护市场秩序。",
    issueStatuses: { [getCurrentIssueId()]: "new" }
  },
  {
    id: "art-002",
    title: "国家互联网应急中心提示 OpenClaw 应用安全风险",
    sourceName: "国家互联网应急中心",
    sourceType: "government",
    publishDate: "2026-04-08",
    url: "https://example.com/openclaw-risk",
    body: "国家互联网应急中心发布安全风险提示称，OpenClaw 应用存在插件投毒、恶意依赖调用和敏感数据外传等风险，可能影响党政机关、企事业单位、金融、能源等关键场景。通报建议相关单位立即开展漏洞排查、权限收敛和日志审计，并对高风险版本暂停使用。",
    issueStatuses: { [getCurrentIssueId()]: "new" }
  },
  {
    id: "art-003",
    title: "NetNewsWire 开源 RSS 阅读器体验文章",
    sourceName: "个人博客",
    sourceType: "self_media",
    publishDate: "2023-11-12",
    url: "",
    body: "这是一篇介绍个人使用 RSS 阅读器体验的文章，主要讲阅读界面、同步体验、主题配色和消费级应用感受，没有明确产业政策、重大技术突破、产业协同、商业事件或可验证数据。",
    issueStatuses: { [getCurrentIssueId()]: "rejected" }
  },
  {
    id: "art-004",
    title: "某央企发布高强度碳纤维规模化量产进展",
    sourceName: "中国建材集团",
    sourceType: "enterprise",
    publishDate: "2026-04-07",
    url: "https://example.com/carbon-fiber",
    body: "中国建材集团发布消息称，新一代高强度碳纤维实现规模化量产，相关产品已面向航空航天和高端装备领域开展批量验证。公告披露称，产品强度和模量较上一代提升明显，并将推动国产替代和产业链协同发展。",
    issueStatuses: { [getCurrentIssueId()]: "candidate", "issue-111": "review" }
  }
];

const state = {
  articles: [],
  filteredArticles: [],
  selectedId: null,
  resultsById: {},
  activeTaskView: "new",
  viewedByIssue: {},
  /** 服务端是否已配置 WECHAT_RSS_URL（token 仅存在 .env） */
  serverRssConfigured: false,
  /** /api/config 返回的 RSS 路数，用于同步弹窗提示 */
  wechatRssFeedCount: 0,
  /** 当前正在为哪篇文章请求 AI 摘要（用于展示「生成中」） */
  pendingSummaryArticleId: null,
  /** 最近一次「刷新数据」接口返回的导入条数；null 表示本会话尚未成功刷新过 */
  lastRefreshImportedCount: null,
  /** 列表过大时跳过全量 AI 初筛，改为点击单篇时再请求 */
  lazySkillEnrichAfterLoad: false,
  /** 公众号名称 → 产业栏目标签（来自 /api/channel-industries） */
  channelIndustryMap: {}
};

/** 超过此条数时不自动跑全量 skill-screen，避免千级文章阻塞界面 */
const MAX_BULK_SKILL_ENRICH = 80;

/** 点击「刷新数据」时展示轻量提示，请求结束后关闭 */
function startRefreshSyncModal() {
  const overlay = document.getElementById("refresh-sync-overlay");
  if (!overlay) {
    return;
  }
  stopRefreshSyncModal();
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("refresh-sync-open");
}

function stopRefreshSyncModal() {
  const overlay = document.getElementById("refresh-sync-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("refresh-sync-open");
}

const articleListEl = document.getElementById("article-list");
const listCountEl = document.getElementById("list-count");
const articleTotalCountEl = document.getElementById("article-total-count");
const taskViewTabsEl = document.getElementById("task-view-tabs");
const toolbarNewDataWrapEl = document.getElementById("toolbar-new-data-wrap");
const newDataCountEl = document.getElementById("new-data-count");
const searchInputEl = document.getElementById("search-input");
const industryFilterEl = document.getElementById("industry-filter");
const sourceFilterEl = document.getElementById("source-filter");
const scoreFilterEl = document.getElementById("score-filter");
const statusFilterEl = document.getElementById("status-filter");
const weekStartInputEl = document.getElementById("week-start-input");
const weekEndInputEl = document.getElementById("week-end-input");
const issueSelectEl = document.getElementById("issue-select");
const filterApplyBtnEl = document.getElementById("filter-apply-btn");
const refreshBtnEl = document.getElementById("refresh-btn");
const loadDemoBtnEl = document.getElementById("load-demo-btn");
const userDisplayNameEl = document.getElementById("user-display-name");
const userAvatarEl = document.getElementById("user-avatar");
const logoutBtnEl = document.getElementById("logout-btn");

const emptyStateEl = document.getElementById("empty-state");
const detailViewEl = document.getElementById("detail-view");
const detailTitleEl = document.getElementById("detail-title");
const detailMetaEl = document.getElementById("detail-meta");
const detailIndustryLineEl = document.getElementById("detail-industry-line");
const detailUserStatusEl = document.getElementById("detail-user-status");
const detailPanelStatusWrapEl = document.getElementById("detail-panel-status-wrap");
const detailAiSuggestionEl = document.getElementById("detail-ai-suggestion");
const detailAiSuggestionTitleEl = document.getElementById("detail-ai-suggestion-title");
const detailLinkEl = document.getElementById("detail-link");
const detailLinkHintEl = document.getElementById("detail-link-hint");
const detailBodyEl = document.getElementById("detail-body");
const totalScoreEl = document.getElementById("total-score");
const metricIndustryEl = document.getElementById("metric-industry");
const metricAuthorityEl = document.getElementById("metric-authority");
const metricImpactEl = document.getElementById("metric-impact");
const metricNoveltyEl = document.getElementById("metric-novelty");
const metricVerifiabilityEl = document.getElementById("metric-verifiability");
const hardChecksEl = document.getElementById("hard-checks");
const hardCheckAlertsEl = document.getElementById("hard-check-alerts");
const finalAdviceEl = document.getElementById("final-advice");
const summaryLoadingEl = document.getElementById("summary-loading");
const summaryErrorEl = document.getElementById("summary-error");
const detailSummaryContentEl = document.getElementById("detail-summary-content");
const decisionReasonsEl = document.getElementById("decision-reasons");
const scoreDetailModalEl = document.getElementById("score-detail-modal");
const openScoreDetailBtnEl = document.getElementById("open-score-detail-btn");
const scoreDetailModalCloseEl = document.getElementById("score-detail-modal-close");
const markCandidateBtnEl = document.getElementById("mark-candidate-btn");
const markReviewBtnEl = document.getElementById("mark-review-btn");
const markRejectedBtnEl = document.getElementById("mark-rejected-btn");
const candidateProgressEl = document.getElementById("candidate-progress");
const candidateSelectedCountEl = document.getElementById("candidate-selected-count");
const candidateProgressBarEl = document.getElementById("candidate-progress-bar");
const candidateCoveredIndustriesEl = document.getElementById("candidate-covered-industries");
const candidateStructureListEl = document.getElementById("candidate-structure-list");
const candidateStructureInsightsEl = document.getElementById("candidate-structure-insights");
const candidateMiniListCountEl = document.getElementById("candidate-mini-list-count");
const candidateMiniListEl = document.getElementById("candidate-mini-list");
const generateWeeklyBtnEl = document.getElementById("generate-weekly-btn");
const downloadWeeklyBtnEl = document.getElementById("download-weekly-btn");

const ISSUE_TARGET_COUNT = 22;
const EXPECTED_INDUSTRIES = [...SASAC_INDUSTRY_LABELS];

let latestWeeklyHtml = "";

/** 本期起止相差最多 6 天 → 含首尾共 7 个自然日（一周） */
const MAX_ISSUE_RANGE_DAYS = 6;

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(ymd) {
  if (!ymd || typeof ymd !== "string") {
    return null;
  }
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3) {
    return null;
  }
  const [y, mo, day] = parts;
  const dt = new Date(y, mo - 1, day);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) {
    return null;
  }
  return dt;
}

/** 本地日历「今天」0 点，用于日期上限与「实时」结束日 */
function getTodayLocalDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 结束日、开始日均不可晚于今日（浏览器 date 控件 + 逻辑双保险） */
function setIssueDateInputsMaxToday() {
  if (!weekEndInputEl) {
    return;
  }
  const ymd = formatDateInput(getTodayLocalDate());
  weekEndInputEl.max = ymd;
  if (weekStartInputEl) {
    weekStartInputEl.max = ymd;
  }
}

function issueNumberFromWeekStart(startStr) {
  const ref = parseLocalDate(ISSUE_REF_WEEK_START);
  const start = parseLocalDate(startStr);
  if (!ref || !start) {
    return ISSUE_REF_NUMBER;
  }
  const diffDays = Math.round((start.getTime() - ref.getTime()) / 86400000);
  return ISSUE_REF_NUMBER + Math.floor(diffDays / 7);
}

function issueContainingDate(d) {
  const ref = parseLocalDate(ISSUE_REF_WEEK_START);
  if (!ref) {
    return ISSUE_REF_NUMBER;
  }
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((day.getTime() - ref.getTime()) / 86400000);
  return ISSUE_REF_NUMBER + Math.floor(diffDays / 7);
}

function populateIssueSelect() {
  if (!issueSelectEl || issueSelectEl.options.length > 0) {
    return;
  }
  for (let i = ISSUE_SELECT_MIN; i <= ISSUE_SELECT_MAX; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = i === ISSUE_SELECT_MAX ? `第${i}期（本期）` : `第${i}期`;
    issueSelectEl.appendChild(opt);
  }
}

function applyIssueNumber(issueNum) {
  if (!weekStartInputEl || !weekEndInputEl || !issueSelectEl) {
    return;
  }
  const n = Math.min(ISSUE_SELECT_MAX, Math.max(ISSUE_SELECT_MIN, Number(issueNum) || ISSUE_REF_NUMBER));
  const ref = parseLocalDate(ISSUE_REF_WEEK_START);
  if (!ref) {
    return;
  }
  const start = new Date(ref);
  start.setDate(start.getDate() + (n - ISSUE_REF_NUMBER) * 7);
  let end = new Date(start);
  end.setDate(end.getDate() + MAX_ISSUE_RANGE_DAYS);
  const today = getTodayLocalDate();
  if (end > today) {
    end = new Date(today);
  }
  if (start > end) {
    start = new Date(end);
    start.setDate(start.getDate() - MAX_ISSUE_RANGE_DAYS);
  }
  weekStartInputEl.value = formatDateInput(start);
  weekEndInputEl.value = formatDateInput(end);
  issueSelectEl.value = String(n);
}

function syncIssueSelectFromDates() {
  if (!weekStartInputEl || !issueSelectEl) {
    return;
  }
  const n = issueNumberFromWeekStart(weekStartInputEl.value);
  const clamped = Math.min(ISSUE_SELECT_MAX, Math.max(ISSUE_SELECT_MIN, n));
  if (issueSelectEl.value !== String(clamped)) {
    issueSelectEl.value = String(clamped);
  }
}

function clampIssueDateRange(changed) {
  if (!weekStartInputEl || !weekEndInputEl) {
    return;
  }
  let start = parseLocalDate(weekStartInputEl.value);
  let end = parseLocalDate(weekEndInputEl.value);
  if (!start || !end) {
    return;
  }
  const today = getTodayLocalDate();
  if (end > today) {
    end = new Date(today);
  }
  if (start > today) {
    start = new Date(today);
  }
  if (end < start) {
    if (changed === "start") {
      end = new Date(start);
    } else {
      start = new Date(end);
    }
  }
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays > MAX_ISSUE_RANGE_DAYS) {
    if (changed === "start") {
      end = new Date(start);
      end.setDate(end.getDate() + MAX_ISSUE_RANGE_DAYS);
      if (end > today) {
        end = new Date(today);
        start = new Date(end);
        start.setDate(start.getDate() - MAX_ISSUE_RANGE_DAYS);
      }
    } else {
      start = new Date(end);
      start.setDate(start.getDate() - MAX_ISSUE_RANGE_DAYS);
    }
  }
  if (end > today) {
    end = new Date(today);
  }
  if (start > end) {
    start = new Date(end);
    start.setDate(start.getDate() - MAX_ISSUE_RANGE_DAYS);
  }
  weekStartInputEl.value = formatDateInput(start);
  weekEndInputEl.value = formatDateInput(end);
  syncIssueSelectFromDates();
}

function initWeekRange() {
  if (!weekStartInputEl || !weekEndInputEl) {
    return;
  }
  populateIssueSelect();
  if (!issueSelectEl) {
    const end = getTodayLocalDate();
    const start = new Date(end);
    start.setDate(start.getDate() - MAX_ISSUE_RANGE_DAYS);
    weekStartInputEl.value = formatDateInput(start);
    weekEndInputEl.value = formatDateInput(end);
    setIssueDateInputsMaxToday();
    return;
  }
  const today = getTodayLocalDate();
  const n = issueContainingDate(today);
  const clamped = Math.min(ISSUE_SELECT_MAX, Math.max(ISSUE_SELECT_MIN, n));
  applyIssueNumber(clamped);
  setIssueDateInputsMaxToday();
}

async function loadServerConfig() {
  try {
    const response = await fetch(APP_CONFIG.configEndpoint);
    if (!response.ok) return;
    const data = await response.json();
    state.serverRssConfigured = Boolean(data.wechatRssConfigured);
    state.wechatRssFeedCount = Number(data.wechatRssFeedCount) || 0;
  } catch {
    state.serverRssConfigured = false;
    state.wechatRssFeedCount = 0;
  }
  try {
    const r = await fetch(APP_CONFIG.channelIndustriesEndpoint);
    if (r.ok) {
      const data = await r.json();
      const m = data?.map;
      state.channelIndustryMap = m && typeof m === "object" ? m : {};
    }
  } catch {
    state.channelIndustryMap = {};
  }
}

function getChannelIndustryTagsForSource(sourceName) {
  const map = state.channelIndustryMap || {};
  const key = String(sourceName || "").trim();
  if (!key) {
    return [];
  }
  const direct = map[key];
  if (Array.isArray(direct)) {
    return direct.map((t) => normalizeIndustryLabel(t)).filter(Boolean);
  }
  const stripped = key.replace(/公众号|微信|订阅号|服务号|\s+/g, "").trim();
  if (stripped && stripped !== key) {
    const alt = map[stripped];
    if (Array.isArray(alt)) {
      return alt.map((t) => normalizeIndustryLabel(t)).filter(Boolean);
    }
  }
  return [];
}

function normalizeText(input) {
  return (input || "").trim().toLowerCase();
}

function sourceMatchesFilter(article, sourceFilter) {
  const v = String(sourceFilter || "all");
  if (v === "all") {
    return true;
  }
  const t = String(article.sourceType || "").trim();
  const groupMap = {
    "source-government": new Set(["government"]),
    "source-association": new Set(["association"]),
    "source-enterprise": new Set(["enterprise"]),
    "source-mainstream-media": new Set(["official_media", "industry_media"]),
    "source-thinktank": new Set(["thinktank"]),
    "source-self-media": new Set(["self_media"]),
  };
  if (groupMap[v]) {
    return groupMap[v].has(t);
  }
  return t === v;
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function normalizeIndustryLabel(raw) {
  const t = String(raw || "").trim();
  if (SASAC_INDUSTRY_LABELS.includes(t)) {
    return t;
  }
  const legacy = {
    生物医药产业: "生物制造产业",
    未识别: "其他",
    无对应产业栏目: "其他",
    无对应栏目: "其他",
  };
  if (legacy[t]) {
    return legacy[t];
  }
  for (const label of SASAC_INDUSTRY_LABELS) {
    if (t.includes(label) || label.includes(t)) {
      return label;
    }
  }
  return "其他";
}

function detectIndustry(text) {
  let bestMatch = { label: "其他", score: 0 };

  Object.entries(INDUSTRY_KEYWORDS).forEach(([label, keywords]) => {
    if (label === "其他") {
      return;
    }
    const matchCount = keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
    if (matchCount > bestMatch.score) {
      bestMatch = { label, score: matchCount };
    }
  });

  return { label: normalizeIndustryLabel(bestMatch.label), score: bestMatch.score };
}

function detectCandidateType(text) {
  let found = "产业动态（一般）";

  Object.entries(CANDIDATE_TYPE_PATTERNS).some(([label, keywords]) => {
    if (containsAny(text, keywords)) {
      found = label;
      return true;
    }
    return false;
  });

  return found;
}

function detectTimeliness(publishDate) {
  if (!publishDate) {
    return { ok: false, label: "缺少发布时间", stale: true };
  }

  const now = new Date();
  const published = new Date(publishDate);
  const diffDays = Math.floor((now - published) / (1000 * 60 * 60 * 24));

  if (Number.isNaN(diffDays)) {
    return { ok: false, label: "时间格式异常", stale: true };
  }

  if (diffDays <= 14) {
    return { ok: true, label: `有效（${diffDays}天内）`, stale: false };
  }

  if (diffDays <= 30) {
    return { ok: true, label: `偏旧（${diffDays}天）`, stale: false };
  }

  return { ok: false, label: `超出时效（${diffDays}天）`, stale: true };
}

function analyzeScores(article) {
  const mergedText = `${article.title} ${article.body}`.toLowerCase();
  const industryResult = detectIndustry(mergedText);
  const candidateType = detectCandidateType(mergedText);
  const timeliness = detectTimeliness(article.publishDate);
  const hasNumbers = /\d/.test(article.body);
  const hasSourceLink = Boolean(article.url);
  const highValueHit = HIGH_VALUE_TITLE_HINTS.filter((word) => mergedText.includes(word.toLowerCase()));
  const noiseHit = containsAny(mergedText, ["体验", "上手", "开箱", "推荐", "真香", "必买", "测评", "评测"]);
  const propagandaHit = containsAny(mergedText, ["隆重", "重磅", "震撼", "全面领先", "彻底改变", "极致"]);
  const absoluteHit = containsAny(mergedText, ["完全", "绝对", "彻底", "唯一", "必然"]);
  const hasSourceName = Boolean(String(article.sourceName || "").trim());
  const hasPublishDate = Boolean(String(article.publishDate || "").trim());
  const hasActionVerb = containsAny(mergedText, ["发布", "出台", "部署", "提示", "投资", "签约", "突破", "增长", "下降", "通报", "上线"]);
  const hasCoreFact = String(article.body || "").trim().length >= 80;

  const completenessCount = [hasSourceName, hasPublishDate, hasActionVerb, hasCoreFact].filter(Boolean).length;

  let industryScore = 4 + completenessCount * 3;
  if (industryResult.score >= 2) {
    industryScore += 4;
  } else if (industryResult.score === 1) {
    industryScore += 2;
  }
  industryScore = Math.min(20, industryScore);

  let authorityScore = AUTHORITY_SCORES[article.sourceType] || 0;
  if (["新华社", "中国政府网", "国家互联网应急中心"].includes(article.sourceName)) {
    authorityScore = 20;
  }

  let impactScore = 8;
  if (hasNumbers) {
    impactScore += 6;
  }
  if (highValueHit.length >= 2) {
    impactScore += 8;
  } else if (highValueHit.length === 1) {
    impactScore += 4;
  }
  if (containsAny(mergedText, ["产业链", "供应链", "治理", "政策导向", "竞争格局", "安全"])) {
    impactScore += 8;
  }
  if (containsAny(mergedText, ["首台套", "首次", "替代", "关键能力"])) {
    impactScore += 5;
  }
  impactScore = Math.min(30, impactScore);

  let noveltyScore = candidateType === "产业动态（一般）" ? 8 : 15;
  if (containsAny(mergedText, ["国家能力", "主权云", "算力", "量子", "底层能力"])) {
    noveltyScore += 3;
  }
  if (containsAny(mergedText, ["讲话", "强调", "工作要求"]) && candidateType.includes("子类")) {
    noveltyScore += 1;
  }
  noveltyScore = Math.min(20, noveltyScore);

  let verifiabilityScore = 8;
  if (hasNumbers) {
    verifiabilityScore += 1;
  }
  if (!hasSourceLink && !STRONG_AUTHORITY_TYPES.has(article.sourceType)) {
    verifiabilityScore -= 2;
  }
  if (noiseHit || propagandaHit || absoluteHit) {
    verifiabilityScore -= 3;
  }
  verifiabilityScore = Math.max(0, Math.min(10, verifiabilityScore));

  const scoreMap = {
    industry: {
      value: industryScore,
      reason: industryResult.score ? `命中 ${industryResult.label} 相关关键词，具备产业归属。` : "未明显命中重点产业关键词，产业相关度偏弱。"
    },
    authority: {
      value: authorityScore,
      reason: `根据信源类型 ${article.sourceType} 和信源名称 ${article.sourceName || "未填写"} 进行初判。`
    },
    impact: {
      value: impactScore,
      reason: highValueHit.length ? `命中高影响信号：${highValueHit.join("、")}。` : "未识别到显著产业格局或政策拐点信号。"
    },
    novelty: {
      value: noveltyScore,
      reason: candidateType !== "产业动态（一般）" ? `识别为 ${candidateType}，条型匹配较清晰。` : "更接近一般动态，条型辨识度一般。"
    },
    verifiability: {
      value: verifiabilityScore,
      reason: `${hasNumbers ? "含数字信息" : "缺少数字信息"}，${hasSourceLink ? "有原文链接" : "缺少原文链接"}。`
    }
  };

  const hardChecks = [
    {
      label: "素材要素完整",
      pass: completenessCount >= 3,
      reason: completenessCount >= 3 ? "主体/时间/动作/事实层信息基本齐备。" : "主体、时间、动作、事实层要素不完整。"
    },
    {
      label: "与产业无关",
      pass: industryResult.score > 0,
      reason: industryResult.score > 0 ? `已识别到 ${industryResult.label} 相关信号。` : "未识别到重点产业关键词。"
    },
    {
      label: "来源可标注",
      pass: hasSourceName,
      reason: hasSourceName ? "来源名称可用于正文来源标注。" : "缺少来源名称，无法满足来源写法规范。"
    },
    {
      label: "时效可用",
      pass: !timeliness.stale,
      reason: timeliness.label
    },
    {
      label: "非宣传腔",
      pass: !noiseHit && !propagandaHit && !absoluteHit,
      reason: !noiseHit && !propagandaHit && !absoluteHit ? "语言风格基本可入版。" : "存在评测化、宣传化或绝对化表达。"
    },
    {
      label: "可追溯",
      pass: Boolean(article.url || STRONG_AUTHORITY_TYPES.has(article.sourceType)),
      reason: article.url ? "有原文链接，可追溯。" : "缺少原文链接，仅依赖信源可信度兜底。"
    }
  ];

  const totalScore = Object.values(scoreMap).reduce((sum, item) => sum + item.value, 0);
  const hardRejected = hardChecks.some((item) => !item.pass);

  let decision = "淘汰";
  if (!hardRejected && totalScore >= 72) {
    decision = "进入候选池";
  } else if (!hardRejected && totalScore >= 60) {
    decision = "备选，建议人工复核";
  }

  const positives = [];
  const risks = [];

  if (industryResult.score > 0) {
    positives.push(`栏目初判为 ${industryResult.label}。`);
  }
  if (candidateType !== "产业动态（一般）") {
    positives.push(`识别到条型：${candidateType}。`);
  }
  if (authorityScore >= 16) {
    positives.push("信源权威性较强。");
  }
  if (hasNumbers) {
    positives.push("正文含有可验证数字或量化信息。");
  }
  if (containsAny(mergedText, ["政策", "部署", "通报", "通知", "管理"])) {
    positives.push("文章具备明确政策或治理属性。");
  }

  if (noiseHit || propagandaHit || absoluteHit) {
    risks.push("文本存在宣传腔、评测腔或绝对化表达，需先降噪再入刊。");
  }
  if (!hasSourceLink) {
    risks.push("缺少原文链接，溯源能力不足。");
  }
  if (timeliness.stale) {
    risks.push(`时效性不足：${timeliness.label}。`);
  }
  if (propagandaHit) {
    risks.push("存在宣传腔或绝对化表述，建议谨慎处理。");
  }
  if (authorityScore < 10) {
    risks.push("信源权威等级较低，默认不建议直接入池。");
  }

  let advice = "建议先完成文章分析。";
  if (decision === "进入候选池") {
    advice = `初筛规则认为可考虑纳入候选（条型：${candidateType}）。是否进入本期候选池须由您在详情中点击「加入候选池」确认；未确认前不会出现在右侧「本期候选池」。`;
  } else if (decision === "备选，建议人工复核") {
    advice = "建议标记为备选，由编辑复核时效、信源和产业关联后再决定是否入池。";
  } else {
    advice = "建议直接淘汰，避免进入后续加工链路占用编辑时间。";
  }

  return {
    totalScore,
    industryGuess: industryResult.label,
    relatedIndustries: [],
    candidateType,
    timelinessLabel: timeliness.label,
    scoreMap,
    hardChecks,
    positives,
    risks,
    decision,
    advice,
  };
}

function mapArticle(raw) {
  return {
    id: raw.id || raw.article_id || `article-${Math.random().toString(16).slice(2, 8)}`,
    title: raw.title || "",
    sourceName: raw.sourceName || raw.source_name || "未知信源",
    sourceType: raw.sourceType || raw.source_type || "industry_media",
    sourceRegion: raw.sourceRegion || raw.source_region || raw.country || raw.region || "",
    author: raw.author || raw.authors || "",
    publishDate: raw.publishDate || raw.publish_date || "",
    imageUrl: raw.imageUrl || raw.image_url || raw.cover_image || raw.thumbnail || "",
    url: raw.url || raw.link || "",
    body: raw.body || raw.content || raw.summary || "",
    evidence: raw.evidence || raw.original_excerpt || raw.content_excerpt || "",
    aiSummary: raw.aiSummary || raw.ai_summary || "",
    aiCommentary: raw.aiCommentary || raw.ai_commentary || "",
    status: raw.status || "new",
    issueStatuses: raw.issueStatuses || raw.issue_statuses || null,
    skillEnrich: raw.skillEnrich || null
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mergeSkillIntoResult(article, payload, options = {}) {
  const persist = options.persist !== false;
  const skill = { ...payload };
  delete skill.ok;
  const base = state.resultsById[article.id] || analyzeScores(article);
  const primarySec = normalizeIndustryLabel(skill.tagSection);
  const rel = Array.isArray(skill.relatedIndustries)
    ? skill.relatedIndustries.map((x) => normalizeIndustryLabel(x)).filter((x) => x && x !== primarySec)
    : [];
  state.resultsById[article.id] = {
    ...base,
    totalScore: skill.totalScore,
    industryGuess: primarySec,
    relatedIndustries: rel,
    candidateType: skill.tagCandidateType,
    decision: skill.decision,
    scoreMap: {
      industry: { value: skill.industry, reason: "初筛模型·产业性" },
      authority: { value: skill.authority, reason: "初筛模型·信源权威性" },
      impact: { value: skill.impact, reason: "初筛模型·产业影响力" },
      novelty: { value: skill.novelty, reason: "初筛模型·新颖性" },
      verifiability: { value: skill.verifiability, reason: "初筛模型·可验证性" },
    },
  };
  article.skillEnrich = skill;
  if (persist) {
    void persistArticlesToServer();
  }
}

function getArticleListTags(article, result) {
  if (article.skillEnrich) {
    return [
      article.skillEnrich.tagSection,
      formatCandidateTag(article.skillEnrich.tagCandidateType),
    ];
  }
  const r = result || analyzeScores(article);
  return [r.industryGuess, formatCandidateTag(r.candidateType)];
}

async function runSkillEnrichSingle(article, options = {}) {
  if (isWeeklyStaticDeploy()) {
    return;
  }
  if (!article || article.skillEnrich) {
    return;
  }
  const refreshUi = options.refreshUi !== false;
  try {
    const data = await postJson(APP_CONFIG.skillScreenEndpoint, {
      article: {
        title: article.title,
        body: article.body,
        url: article.url,
        sourceName: article.sourceName,
        publishDate: article.publishDate,
      },
    });
    if (data.ok === false) {
      throw new Error(data.message || "skill-screen 失败");
    }
    mergeSkillIntoResult(article, data);
    if (refreshUi) {
      buildIndustryOptions();
      applyFilters();
    }
  } catch (err) {
    console.warn("[skill-screen]", article.id, err.message);
  }
}

async function runSkillEnrichQueue() {
  if (isWeeklyStaticDeploy()) {
    return;
  }
  for (const article of state.articles) {
    if (article.skillEnrich) {
      continue;
    }
    await runSkillEnrichSingle(article, { refreshUi: false });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  buildIndustryOptions();
  applyFilters();
}

async function fetchArticles() {
  const response = await fetch(APP_CONFIG.listEndpoint);
  if (!response.ok) {
    throw new Error(`list api error: ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data) ? data : data.articles || data.items || data.data || [];
  return items.map(mapArticle);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${url} 请求失败: ${response.status} ${text}`);
  }
  return response.json();
}

/** 将当前列表写回服务端，持久化 skillEnrich / 人工状态等，避免重复模型打分 */
async function persistArticlesToServer() {
  if (isWeeklyStaticDeploy()) {
    return;
  }
  try {
    await postJson(APP_CONFIG.articlesSaveEndpoint, { articles: state.articles });
  } catch (err) {
    console.warn("[persist-articles]", err.message);
  }
}

/** 首次进入且未同步过：不请求列表、不调模型，界面为空状态 */
function showInitialEmptyWorkspace() {
  state.articles = [];
  state.filteredArticles = [];
  state.resultsById = {};
  state.lazySkillEnrichAfterLoad = false;
  state.lastRefreshImportedCount = null;
  buildIndustryOptions();
  applyFilters();
  showEmptyDetail();
}

async function loadArticles(useMockFallback = true) {
  state.resultsById = {};
  let fromServer = false;
  try {
    state.articles = await fetchArticles();
    fromServer = true;
  } catch (error) {
    if (!useMockFallback) {
      throw error;
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY_ARTICLE_SYNC) !== "1") {
      state.articles = [];
      fromServer = false;
    } else {
      state.articles = MOCK_ARTICLES.map((item) => ({ ...item }));
      fromServer = false;
    }
  }

  state.lazySkillEnrichAfterLoad = false;
  state.articles.sort((a, b) => String(b.publishDate || "").localeCompare(String(a.publishDate || "")));

  state.filteredArticles = [...state.articles];
  runAutoAnalysis();
  buildIndustryOptions();
  applyFilters();

  /** 仅服务端拉取：少量文章时全量 AI 初筛；大量时跳过以免长时间阻塞，改为点击单篇时补跑 */
  if (fromServer && !isWeeklyStaticDeploy()) {
    if (state.articles.length <= MAX_BULK_SKILL_ENRICH) {
      await runSkillEnrichQueue();
      buildIndustryOptions();
      applyFilters();
    } else {
      state.lazySkillEnrichAfterLoad = true;
    }
  }
}

function articleMatchesIndustryFilter(article, result, industryFilter) {
  if (industryFilter === "all") {
    return true;
  }
  const primary = normalizeIndustryLabel(result.industryGuess);
  if (primary === industryFilter) {
    return true;
  }
  const rel = result.relatedIndustries || article.skillEnrich?.relatedIndustries;
  if (Array.isArray(rel) && rel.some((x) => normalizeIndustryLabel(x) === industryFilter)) {
    return true;
  }
  const channelTags = getChannelIndustryTagsForSource(article.sourceName);
  if (channelTags.some((t) => t === industryFilter)) {
    return true;
  }
  return false;
}

function buildIndustryOptions() {
  const prev = industryFilterEl.value;
  industryFilterEl.innerHTML = [
    `<option value="all">全部产业</option>`,
    ...SASAC_INDUSTRY_LABELS.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
  ].join("");
  const allowed = new Set(["all", ...SASAC_INDUSTRY_LABELS]);
  if (allowed.has(prev)) {
    industryFilterEl.value = prev;
  }
}

function runAutoAnalysis() {
  state.articles.forEach((article) => {
    if (article.skillEnrich) {
      mergeSkillIntoResult(article, article.skillEnrich, { persist: false });
    } else {
      state.resultsById[article.id] = analyzeScores(article);
    }
  });
}

function applyFilters() {
  if (state.activeTaskView === "all") {
    state.activeTaskView = "new";
  }
  if (state.activeTaskView === "candidate") {
    state.activeTaskView = "accept";
  }
  if (state.activeTaskView === "irrelevant") {
    state.activeTaskView = "new";
  }

  const query = normalizeText(searchInputEl.value);
  const industry = industryFilterEl.value;
  const source = sourceFilterEl.value;
  const scoreTier = scoreFilterEl.value;
  const status = statusFilterEl.value;
  const taskView = state.activeTaskView;

  /** 下拉选择「建议入选」时与左侧「建议入选」分档联动（仅初筛结论，不含已手动入选） */
  if (status === "suggested") {
    state.activeTaskView = "accept";
  }

  state.filteredArticles = state.articles.filter((article) => {
    const result = state.resultsById[article.id] || analyzeScores(article);
    const merged = `${article.title} ${article.body} ${article.sourceName}`.toLowerCase();
    const articleStatus = getArticleStatus(article);

    if (query && !merged.includes(query)) {
      return false;
    }
    if (!articleMatchesIndustryFilter(article, result, industry)) {
      return false;
    }
    if (!sourceMatchesFilter(article, source)) {
      return false;
    }
    if (!scoreMatchesFilter(result.totalScore, scoreTier)) {
      return false;
    }
    if (status !== "all") {
      if (status === "suggested") {
        if (result.decision !== "进入候选池") {
          return false;
        }
      } else if (articleStatus !== status) {
        return false;
      }
    }
    if (status === "all" && !matchesTaskView(article, result, taskView)) {
      return false;
    }
    return true;
  });

  renderTaskViewTabs();
  renderList();
  updateStats();

  if (!state.selectedId || !state.filteredArticles.some((item) => item.id === state.selectedId)) {
    const first = state.filteredArticles[0];
    if (first) {
      selectArticle(first.id, { markViewed: false });
    } else {
      showEmptyDetail();
    }
  } else {
    renderDetail();
  }
}

function isViewedInCurrentIssue(articleId) {
  return Boolean(state.viewedByIssue[getCurrentIssueId()]?.[articleId]);
}

function markArticleViewed(articleId) {
  state.viewedByIssue[getCurrentIssueId()] = {
    ...(state.viewedByIssue[getCurrentIssueId()] || {}),
    [articleId]: true
  };
}

function matchesTaskView(article, result, taskView) {
  const articleStatus = getArticleStatus(article);
  switch (taskView) {
    case "new":
      return articleStatus === "new";
    case "accept":
      return (
        result.decision === "进入候选池" ||
        articleStatus === "candidate"
      );
    case "reject_group":
      return result.decision === "淘汰";
    case "review":
      return result.decision === "备选，建议人工复核";
    case "reject":
      return result.decision === "淘汰";
    case "candidate":
      return articleStatus === "candidate";
    default:
      return false;
  }
}

function countArticlesForTaskView(viewKey) {
  return state.articles.filter((article) => {
    const result = state.resultsById[article.id];
    if (!result) {
      return false;
    }
    return matchesTaskView(article, result, viewKey);
  }).length;
}

function renderTaskViewTabs() {
  if (!taskViewTabsEl) {
    return;
  }

  const nNew = countArticlesForTaskView("new");
  const nAccept = countArticlesForTaskView("accept");
  const nRejectGroup = countArticlesForTaskView("reject_group");
  const nReview = countArticlesForTaskView("review");

  const active = state.activeTaskView;

  taskViewTabsEl.innerHTML = `
    <div class="task-view-primary" role="tablist" aria-label="资讯分档">
      <div class="task-view-row task-view-row-blocks">
        <button
          type="button"
          role="tab"
          class="task-view-tab task-view-tab-block ${active === "new" ? "active" : ""}"
          data-task-view="new"
          aria-selected="${active === "new"}"
        >
          <span class="task-view-block-label">未处理</span>
          <span class="task-view-count task-view-block-count">${nNew}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="task-view-tab task-view-tab-block ${active === "accept" ? "active" : ""}"
          data-task-view="accept"
          aria-selected="${active === "accept"}"
        >
          <span class="task-view-block-label">建议入选</span>
          <span class="task-view-count task-view-block-count">${nAccept}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="task-view-tab task-view-tab-block ${active === "reject_group" ? "active" : ""}"
          data-task-view="reject_group"
          aria-selected="${active === "reject_group"}"
        >
          <span class="task-view-block-label">建议淘汰</span>
          <span class="task-view-count task-view-block-count">${nRejectGroup}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="task-view-tab task-view-tab-block ${active === "review" ? "active" : ""}"
          data-task-view="review"
          aria-selected="${active === "review"}"
        >
          <span class="task-view-block-label">建议复核</span>
          <span class="task-view-count task-view-block-count">${nReview}</span>
        </button>
      </div>
    </div>
  `;

  taskViewTabsEl.querySelectorAll("[data-task-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTaskView = button.dataset.taskView;
      applyFilters();
    });
  });
}

function getStatusLabel(status) {
  const statusMap = {
    new: "未处理",
    candidate: "入选",
    review: "待复核",
    rejected: "已淘汰"
  };
  return statusMap[status] || "未处理";
}

function getArticleStatus(article) {
  if (article.issueStatuses && article.issueStatuses[getCurrentIssueId()]) {
    return article.issueStatuses[getCurrentIssueId()];
  }
  return article.status || "new";
}

function getDecisionBadgeClass(decision) {
  if (decision === "进入候选池") {
    return "success";
  }
  if (decision === "备选，建议人工复核") {
    return "warning";
  }
  return "danger";
}

function getDecisionLabel(decision) {
  if (decision === "进入候选池") {
    return "初筛建议候选";
  }
  if (decision === "备选，建议人工复核") {
    return "初筛建议复核";
  }
  return "初筛建议淘汰";
}

function formatCandidateTag(candidateType) {
  return String(candidateType || "").replace("候选", "");
}

/** 总分档位：0–20 红，21–55 黄，56–85 橙，86–100 蓝 */
function getScoreTierClass(score) {
  const n = Number(score);
  if (Number.isNaN(n)) {
    return "score-tier-none";
  }
  if (n <= 20) {
    return "score-tier-d";
  }
  if (n <= 55) {
    return "score-tier-c";
  }
  if (n <= 85) {
    return "score-tier-b";
  }
  return "score-tier-a";
}

/** 筛选是否与总分档位一致（与列表/详情分数颜色、card-score 档位联动） */
function scoreMatchesFilter(totalScore, filterValue) {
  const v = String(filterValue || "all");
  if (v === "all" || v === "0") {
    return true;
  }
  const nScore = Number(totalScore) || 0;
  if (v === "decision-candidate") {
    return nScore >= 72;
  }
  if (v === "decision-review") {
    return nScore >= 60 && nScore <= 71;
  }
  if (v === "decision-reject") {
    return nScore < 60;
  }
  const tierClass = getScoreTierClass(totalScore);
  const tierMap = {
    "tier-a": "score-tier-a",
    "tier-b": "score-tier-b",
    "tier-c": "score-tier-c",
    "tier-d": "score-tier-d",
  };
  if (tierMap[v]) {
    return tierClass === tierMap[v];
  }
  const min = Number(v);
  if (!Number.isNaN(min) && min > 0) {
    return Number(totalScore) >= min;
  }
  return true;
}

/** 仅随模型初筛结论变化，不随用户点选状态变化 */
function buildAiSuggestionTitle(result) {
  const d = result.decision;
  if (d === "进入候选池") {
    return "初筛建议候选（尚未入选）";
  }
  if (d === "备选，建议人工复核") {
    return "初筛建议复核";
  }
  return "初筛建议淘汰";
}

function buildAiSuggestionText(result) {
  const advice = (result.advice || "").trim();
  if (advice) {
    return advice.endsWith("。") ? advice : `${advice}。`;
  }
  return `初筛结论为「${result.decision}」。`;
}

function reorderChoiceButtons(decision) {
  const group = document.getElementById("detail-choice-group");
  if (!group || !markCandidateBtnEl || !markReviewBtnEl || !markRejectedBtnEl) {
    return;
  }
  const bCandidate = markCandidateBtnEl;
  const bReview = markReviewBtnEl;
  const bReject = markRejectedBtnEl;
  const ordered =
    decision === "进入候选池"
      ? [bCandidate, bReview, bReject]
      : decision === "备选，建议人工复核"
        ? [bReview, bCandidate, bReject]
        : [bReject, bReview, bCandidate];
  ordered.forEach((el) => group.appendChild(el));
}

/** 仅反映用户本期点选状态，不根据 AI 结论高亮「推荐」 */
function updateDetailChoiceStyles(article) {
  [markCandidateBtnEl, markReviewBtnEl, markRejectedBtnEl].forEach((btn) => {
    btn.classList.remove("is-selected");
  });
  const userSt = getArticleStatus(article);
  const map = {
    candidate: markCandidateBtnEl,
    review: markReviewBtnEl,
    rejected: markRejectedBtnEl,
  };
  if (userSt !== "new" && map[userSt]) {
    map[userSt].classList.add("is-selected");
  }
}

function extractObjectiveFacts(article, result) {
  const sentences = (article.body || "")
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const factPool = [];
  if (sentences[0]) {
    factPool.push(sentences[0]);
  }
  if (sentences[1] && sentences[1] !== sentences[0]) {
    factPool.push(sentences[1]);
  }
  if (result.positives.length) {
    factPool.push(...result.positives.slice(0, 2));
  }

  return factPool.slice(0, 4);
}

function buildWeeklyBrief(article, result) {
  if (article.aiSummary) {
    return {
      title: article.title,
      summary: article.aiSummary,
      commentary: article.aiCommentary || ""
    };
  }

  const facts = extractObjectiveFacts(article, result);
  const firstSentence = facts[0] || article.body || "";
  const sourcePrefix = article.sourceName ? `${article.sourceName}消息，` : "";
  const normalized = firstSentence.replace(/^[，。；：\s]+/, "");
  const summary = `${sourcePrefix}${normalized.endsWith("。") ? normalized : `${normalized}。`}`;

  let commentary = "";
  if (result.decision === "进入候选池") {
    commentary = `初筛建议按「${result.industryGuess}」关注，可突出${result.candidateType.replace("候选", "")}相关信号；若确认入刊请在详情点击「加入候选池」。`;
  } else if (result.decision === "备选，建议人工复核") {
    commentary = "建议编辑补核信源、时效和关键事实后再决定是否入刊，当前更适合作为备选条目。";
  }

  return {
    title: article.title,
    summary,
    commentary
  };
}

function buildCompactSummary(article, result) {
  if (article.aiSummary) {
    return article.aiSummary;
  }

  const parts = [];
  if (containsAny(`${article.title} ${article.body}`.toLowerCase(), ["多部门", "六部门", "联合"])) {
    parts.push("属于高层级联合发布信号");
  }
  if (result.industryGuess && result.industryGuess !== "其他") {
    parts.push(`栏目初判为${result.industryGuess}`);
  }
  if (containsAny(`${article.title} ${article.body}`.toLowerCase(), ["竞争秩序", "治理", "退出", "规范", "安全风险", "通报"])) {
    parts.push("对行业治理或竞争秩序具有明确影响");
  }
  if (!parts.length) {
    parts.push(result.advice.replace(/。$/, ""));
  }
  return parts.slice(0, 3).join("，") + "。";
}

/** 去掉模型回传里多余空行与行首行尾空白，压缩连续空白 */
function normalizeSummaryWhitespace(text) {
  if (!text || typeof text !== "string") {
    return "";
  }
  let s = text.replace(/\r\n/g, "\n");
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.replace(/\n\s*\n+/g, "\n");
  return s
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 解析 SKILL 约定的「事件摘要 / 数据亮点 / 产业意义」三段；无法识别时返回 null
 */
function parseSkillSummarySections(normalized) {
  const t = normalized;
  const titleM = t.match(/摘要标题\s*[：:]?\s*([\s\S]*?)(?=\n\s*摘要总结\s*[：:]?|$)/);
  const summaryM = t.match(/摘要总结\s*[：:]?\s*([\s\S]*)$/);
  if (titleM || summaryM) {
    return {
      title: (titleM ? titleM[1] : "").trim(),
      summary: (summaryM ? summaryM[1] : "").trim(),
      event: "",
      data: "",
      meaning: "",
    };
  }
  if (!/事件摘要[：:]/.test(t) && !/数据亮点[：:]/.test(t) && !/产业意义[：:]/.test(t)) {
    return null;
  }
  const eventM = t.match(/事件摘要[：:]\s*([\s\S]*?)(?=\n\s*数据亮点[：:]|$)/);
  const dataM = t.match(/数据亮点[：:]\s*([\s\S]*?)(?=\n\s*产业意义[：:]|$)/);
  const meaningM = t.match(/产业意义[：:]\s*([\s\S]*)$/);
  const event = (eventM ? eventM[1] : "").trim();
  const data = (dataM ? dataM[1] : "").trim();
  const meaning = (meaningM ? meaningM[1] : "").trim();
  const hasStructure = Boolean(event || data || meaning || /事件摘要[：:]/.test(t));
  if (!hasStructure) {
    return null;
  }
  return { event, data, meaning };
}

function isSkippedHighlightLine(s) {
  return !s || /^无[。…]?$/.test(s.trim());
}

/** 将摘要写入详情区：事件摘要 / 数据亮点 / 产业意义；无法解析时整段展示 */
function renderSummaryAdvice(el, rawText) {
  if (!el) {
    return;
  }
  el.textContent = "";
  const normalized = normalizeSummaryWhitespace(String(rawText ?? ""));
  if (!normalized) {
    return;
  }

  const appendSeg = (label, body) => {
    if (!body) {
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "detail-summary-seg";
    const lab = document.createElement("div");
    lab.className = "detail-summary-seg-label";
    lab.textContent = label;
    const txt = document.createElement("div");
    txt.className = "detail-summary-seg-text";
    txt.textContent = body;
    wrap.appendChild(lab);
    wrap.appendChild(txt);
    el.appendChild(wrap);
  };
  const appendPlainLine = (className, body) => {
    if (!body) {
      return;
    }
    const p = document.createElement("p");
    p.className = className;
    p.textContent = body;
    el.appendChild(p);
  };

  const skill = parseSkillSummarySections(normalized);
  if (skill) {
    if (skill.title) {
      appendPlainLine("detail-summary-title-text", `“${String(skill.title).replace(/^["“]|["”]$/g, "")}”`);
    }
    if (skill.summary) {
      appendPlainLine("detail-summary-body-text", skill.summary);
    }
    if (el.childNodes.length) {
      return;
    }
    if (skill.event) {
      appendSeg("事件摘要", skill.event);
    }
    if (!isSkippedHighlightLine(skill.data)) {
      appendSeg("数据亮点", skill.data);
    }
    if (!isSkippedHighlightLine(skill.meaning)) {
      appendSeg("产业意义", skill.meaning);
    }
    if (el.childNodes.length) {
      return;
    }
  }

  const p = document.createElement("p");
  p.className = "detail-summary-plain";
  p.textContent = normalized;
  el.appendChild(p);
}

function renderList() {
  if (articleTotalCountEl) {
    articleTotalCountEl.textContent = String(state.articles.length);
  }
  if (listCountEl) {
    listCountEl.textContent = String(state.filteredArticles.length);
  }

  if (!state.filteredArticles.length) {
    let emptyMsg = "没有符合条件的资讯。";
    if (state.articles.length === 0) {
      emptyMsg =
        typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY_ARTICLE_SYNC) !== "1"
          ? "暂无数据，请点击上方「刷新数据」拉取公众号文章后再查看。"
          : "暂无文章，请调整本期日期范围后点击「刷新数据」更新。";
    }
    articleListEl.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
    return;
  }

  articleListEl.innerHTML = state.filteredArticles.map((article) => {
    const result = state.resultsById[article.id] || analyzeScores(article);
    const issueStatus = getArticleStatus(article);
    const preview = (article.evidence || article.body || "").replace(/\s+/g, " ").trim();
    const unread = !isViewedInCurrentIssue(article.id);
    const [tagA, tagB] = getArticleListTags(article, result);
    return `
      <article class="article-card ${unread ? "article-card--unread" : ""} ${article.id === state.selectedId ? "active" : ""}" data-id="${article.id}">
        <div class="card-top">
          <div class="card-top-left">
            <span class="view-marker ${unread ? "unread" : "read"}"></span>
            <span class="pill">${escapeHtml(article.sourceName)}</span>
            ${article.publishDate ? `<span class="subtle card-date">${escapeHtml(article.publishDate)}</span>` : ""}
          </div>
          <span class="card-score ${getScoreTierClass(result.totalScore)}">${result.totalScore}</span>
        </div>
        <h4 class="card-title">${escapeHtml(article.title)}</h4>
        <p class="card-summary">${escapeHtml(preview.slice(0, 82))}${preview.length > 82 ? "..." : ""}</p>
        <div class="meta-row">
          <span class="pill">${escapeHtml(tagA)}</span>
          <span class="pill">${escapeHtml(tagB)}</span>
        </div>
        <div class="card-footer">
          <span class="card-issue-status">本期状态：${getStatusLabel(issueStatus)}</span>
          <span class="decision-pill ${getDecisionBadgeClass(result.decision)}" title="初筛规则参考，非已入选；入选须在详情点击「加入候选池」">${getDecisionLabel(result.decision)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function updateToolbarNewDataStat() {
  const n = state.lastRefreshImportedCount;
  if (!toolbarNewDataWrapEl || !newDataCountEl) {
    return;
  }
  if (n === null || n < 1) {
    toolbarNewDataWrapEl.classList.add("hidden");
    return;
  }
  toolbarNewDataWrapEl.classList.remove("hidden");
  newDataCountEl.textContent = String(n);
}

function updateStats() {
  const candidateArticles = state.articles.filter((article) => getArticleStatus(article) === "candidate");
  const candidate = candidateArticles.length;

  const candidateByIndustry = candidateArticles
    .reduce((acc, article) => {
      const industry = state.resultsById[article.id]?.industryGuess || "其他";
      acc[industry] = (acc[industry] || 0) + 1;
      return acc;
    }, {});

  const candidateEntries = Object.entries(candidateByIndustry).sort((a, b) => b[1] - a[1]);
  const coveredIndustryCount = candidateEntries.length;
  const progressPercent = Math.min(100, Math.round((candidate / ISSUE_TARGET_COUNT) * 100));
  const missingIndustries = EXPECTED_INDUSTRIES.filter((industry) => !candidateByIndustry[industry]);
  const dominantIndustry = candidateEntries[0];
  const selectedPreview = candidateArticles
    .map((article) => ({
      article,
      result: state.resultsById[article.id]
    }))
    .sort((a, b) => b.result.totalScore - a.result.totalScore);

  candidateProgressEl.textContent = `${candidate} / ${ISSUE_TARGET_COUNT}`;
  candidateSelectedCountEl.textContent = candidate;
  candidateProgressBarEl.style.width = `${progressPercent}%`;
  candidateCoveredIndustriesEl.textContent = `已覆盖 ${coveredIndustryCount} 个栏目`;
  candidateMiniListCountEl.textContent = `${candidate} 条`;

  candidateStructureListEl.innerHTML = candidateEntries.length
    ? candidateEntries.map(([industry, count]) => `
      <div class="candidate-structure-item">
        <div>
          <strong>${industry}</strong>
          <div class="subtle">当前入选条目</div>
        </div>
        <strong>${count}</strong>
      </div>
    `).join("")
    : `<div class="candidate-insight-item"><span class="subtle">当前候选池为空，先从左侧列表挑选高价值资讯。</span></div>`;

  const insights = [];
  if (dominantIndustry && dominantIndustry[1] >= 3) {
    insights.push({
      tone: "warning",
      text: `${dominantIndustry[0]} 当前占比偏高，建议留意栏目是否过于集中。`
    });
  }
  if (missingIndustries.length) {
    insights.push({
      tone: "warning",
      text: `当前缺失栏目：${missingIndustries.slice(0, 3).join("、")}${missingIndustries.length > 3 ? " 等" : ""}。`
    });
  }
  if (!insights.length) {
    insights.push({
      tone: "success",
      text: "当前候选池结构较为均衡，可以继续补充高优先级条目。"
    });
  }

  candidateStructureInsightsEl.innerHTML = insights.map((item) => `
    <div class="candidate-insight-item ${item.tone}">
      <span class="subtle">${item.text}</span>
    </div>
  `).join("");

  candidateMiniListEl.innerHTML = selectedPreview.length
    ? selectedPreview.map(({ article, result }) => {
      const src = String(article.sourceName || "").trim() || "未知公众号";
      return `
      <div class="candidate-mini-item">
        <div class="candidate-mini-source subtle" title="公众号来源">来源 · ${escapeHtml(src)}</div>
        <div class="candidate-mini-head">
          <strong>${escapeHtml(article.title)}</strong>
          <span class="decision-pill success">入选</span>
        </div>
        <div class="meta-row">
          <span class="pill">${escapeHtml(String(result.industryGuess || "其他"))}</span>
          <span class="pill">${escapeHtml(formatCandidateTag(result.candidateType))}</span>
          <span class="subtle">${article.publishDate || "无日期"}</span>
        </div>
      </div>
    `;
    }).join("")
    : `<div class="candidate-insight-item"><span class="subtle">暂无入选条目；在详情中点「加入候选池」后，会出现在此处并显示公众号来源。</span></div>`;

  updateToolbarNewDataStat();
}

function closeScoreDetailModal() {
  if (!scoreDetailModalEl) {
    return;
  }
  scoreDetailModalEl.classList.add("hidden");
  scoreDetailModalEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-scroll-lock");
}

function openScoreDetailModal() {
  if (!scoreDetailModalEl) {
    return;
  }
  scoreDetailModalEl.classList.remove("hidden");
  scoreDetailModalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-scroll-lock");
}

function showEmptyDetail() {
  closeScoreDetailModal();
  state.selectedId = null;
  state.pendingSummaryArticleId = null;
  detailPanelStatusWrapEl?.classList.add("hidden");
  if (detailIndustryLineEl) {
    detailIndustryLineEl.hidden = true;
  }
  emptyStateEl.classList.remove("hidden");
  detailViewEl.classList.add("hidden");
  emptyStateEl.style.display = "flex";
  detailViewEl.style.display = "none";
  detailViewEl.scrollTop = 0;
}

function selectArticle(id, options = {}) {
  closeScoreDetailModal();
  const markViewed = Boolean(options.markViewed);
  state.selectedId = id;
  if (markViewed) {
    markArticleViewed(id);
  }
  detailViewEl.scrollTop = 0;
  renderList();
  const article = state.articles.find((item) => item.id === id);
  if (article && !article.aiSummary) {
    state.pendingSummaryArticleId = id;
  } else {
    state.pendingSummaryArticleId = null;
  }
  renderDetail();
  if (article && !article.aiSummary) {
    runAutoSummaryFetch(id);
  }
  if (state.lazySkillEnrichAfterLoad && article && !article.skillEnrich) {
    void runSkillEnrichSingle(article);
  }
}

async function runAutoSummaryFetch(articleId) {
  if (isWeeklyStaticDeploy()) {
    return;
  }
  const article = state.articles.find((item) => item.id === articleId);
  if (!article || article.aiSummary) {
    return;
  }

  delete article.summaryError;
  try {
    const data = await postJson(APP_CONFIG.summarizeEndpoint, {
      article: {
        title: article.title,
        content: article.body,
        url: article.url,
        sourceName: article.sourceName || "",
        publishDate: article.publishDate || ""
      }
    });
    article.aiSummary = data.summary || "暂无摘要结果";
    delete article.summaryError;
  } catch (error) {
    if (state.selectedId === articleId) {
      article.summaryError = error.message || "未知错误";
    }
  } finally {
    if (state.pendingSummaryArticleId === articleId) {
      state.pendingSummaryArticleId = null;
    }
    if (state.selectedId === articleId) {
      renderDetail();
    }
  }
}

function renderDetail() {
  const article = state.articles.find((item) => item.id === state.selectedId);
  if (!article) {
    showEmptyDetail();
    return;
  }

  let result = state.resultsById[article.id];
  if (!result) {
    result = analyzeScores(article);
    state.resultsById[article.id] = result;
  }
  emptyStateEl.classList.add("hidden");
  detailViewEl.classList.remove("hidden");
  emptyStateEl.style.display = "none";
  detailViewEl.style.display = "flex";
  detailViewEl.scrollTop = 0;
  detailPanelStatusWrapEl?.classList.remove("hidden");

  detailTitleEl.textContent = article.title;
  if (detailMetaEl) {
    detailMetaEl.textContent = `${article.sourceName} · ${article.publishDate || "无日期"}`;
  }
  if (detailIndustryLineEl) {
    const pri = normalizeIndustryLabel(result.industryGuess);
    const rel = Array.isArray(result.relatedIndustries) ? result.relatedIndustries.map((x) => normalizeIndustryLabel(x)).filter((x) => x && x !== pri) : [];
    detailIndustryLineEl.textContent = rel.length
      ? `栏目：${pri} · 关联产业：${rel.join("、")}`
      : `栏目：${pri}`;
    detailIndustryLineEl.hidden = false;
  }

  const userSt = getArticleStatus(article);
  if (detailUserStatusEl) {
    detailUserStatusEl.textContent = getStatusLabel(userSt);
    detailUserStatusEl.className = `detail-status-pill status-${userSt}`;
  }

  if (detailAiSuggestionTitleEl) {
    detailAiSuggestionTitleEl.textContent = buildAiSuggestionTitle(result);
  }
  if (detailAiSuggestionEl) {
    detailAiSuggestionEl.textContent = buildAiSuggestionText(result);
  }

  detailLinkEl.href = article.url || "#";
  detailLinkEl.style.pointerEvents = article.url ? "auto" : "none";
  detailLinkEl.style.opacity = article.url ? "1" : "0.55";
  detailLinkEl.textContent = article.url ? "打开原文" : "暂无原文链接";
  if (detailLinkHintEl) {
    detailLinkHintEl.textContent = article.url
      ? ""
      : "当前无 URL，以下为系统抓取的正文文本。";
  }

  detailBodyEl.textContent = article.evidence || article.body || "暂无正文";
  detailBodyEl.classList.remove("collapsed");
  detailBodyEl.classList.add("detail-body-full");

  totalScoreEl.textContent = result.totalScore;
  totalScoreEl.className = `detail-title-score-num ${getScoreTierClass(result.totalScore)}`;
  metricIndustryEl.textContent = result.scoreMap.industry.value;
  metricAuthorityEl.textContent = result.scoreMap.authority.value;
  metricImpactEl.textContent = result.scoreMap.impact.value;
  metricNoveltyEl.textContent = result.scoreMap.novelty.value;
  metricVerifiabilityEl.textContent = result.scoreMap.verifiability.value;

  const pendingSummary =
    state.pendingSummaryArticleId === article.id && !article.aiSummary;
  const summaryErr = Boolean(article.summaryError);

  if (summaryLoadingEl) {
    summaryLoadingEl.classList.toggle("hidden", !pendingSummary);
  }
  if (summaryErrorEl) {
    summaryErrorEl.classList.toggle("hidden", !summaryErr);
    summaryErrorEl.textContent = summaryErr ? `摘要生成失败：${article.summaryError}` : "";
  }
  if (finalAdviceEl) {
    finalAdviceEl.classList.toggle("hidden", pendingSummary || summaryErr);
    if (!pendingSummary && !summaryErr) {
      const summaryText = article.aiSummary
        ? article.aiSummary
        : buildCompactSummary(article, result);
      renderSummaryAdvice(finalAdviceEl, summaryText);
    }
  }
  if (detailSummaryContentEl) {
    const showSummaryBody =
      (summaryLoadingEl && !summaryLoadingEl.classList.contains("hidden")) ||
      (finalAdviceEl && !finalAdviceEl.classList.contains("hidden"));
    detailSummaryContentEl.classList.toggle("hidden", !showSummaryBody);
  }

  const decisionReasons = [
    ...result.positives.slice(0, 3),
    ...(result.risks.length ? [result.risks[0]] : []),
  ].slice(0, 3);
  decisionReasonsEl.innerHTML = decisionReasons.length
    ? decisionReasons
        .map((item) => `<div class="decision-reason">${item.replace(/。$/, "")}</div>`)
        .join("")
    : `<div class="decision-reason">当前文章尚未形成明确判断理由。</div>`;

  hardChecksEl.innerHTML = result.hardChecks
    .map(
      (item) => `
    <span class="hard-check-pill ${item.pass ? "pass" : "fail"}">
      <span>${item.pass ? "✓" : "!"}</span>
      <span>${item.label}</span>
    </span>
  `
    )
    .join("");

  const failedChecks = result.hardChecks.filter((item) => !item.pass);
  hardCheckAlertsEl.innerHTML = failedChecks.length
    ? failedChecks
        .map(
          (item) => `
      <div class="hard-check-alert">
        <strong>${item.label}</strong>
        <p>${item.reason}</p>
      </div>
    `
        )
        .join("")
    : "";

  updateDetailChoiceStyles(article);
  reorderChoiceButtons(result.decision);
}

function updateArticleStatus(status) {
  const article = state.articles.find((item) => item.id === state.selectedId);
  if (!article) {
    return;
  }
  article.issueStatuses = {
    ...(article.issueStatuses || {}),
    [getCurrentIssueId()]: status
  };
  void persistArticlesToServer();
  applyFilters();
}

function attachEvents() {
  openScoreDetailBtnEl?.addEventListener("click", openScoreDetailModal);
  scoreDetailModalCloseEl?.addEventListener("click", closeScoreDetailModal);
  scoreDetailModalEl?.querySelector(".score-detail-modal-backdrop")?.addEventListener("click", closeScoreDetailModal);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") {
      return;
    }
    if (scoreDetailModalEl && !scoreDetailModalEl.classList.contains("hidden")) {
      closeScoreDetailModal();
    }
  });

  articleListEl.addEventListener("click", (e) => {
    const card = e.target.closest(".article-card");
    if (!card || !articleListEl.contains(card)) {
      return;
    }
    selectArticle(card.dataset.id, { markViewed: true });
  });

  if (weekStartInputEl && weekEndInputEl) {
    weekStartInputEl.addEventListener("change", () => {
      clampIssueDateRange("start");
      applyFilters();
    });
    weekStartInputEl.addEventListener("input", () => clampIssueDateRange("start"));
    weekEndInputEl.addEventListener("change", () => {
      clampIssueDateRange("end");
      applyFilters();
    });
    weekEndInputEl.addEventListener("input", () => clampIssueDateRange("end"));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !weekEndInputEl) {
      return;
    }
    setIssueDateInputsMaxToday();
    const max = weekEndInputEl.max;
    if (max && weekEndInputEl.value > max) {
      weekEndInputEl.value = max;
      clampIssueDateRange("end");
      applyFilters();
    }
  });

  setInterval(() => {
    if (!weekEndInputEl) {
      return;
    }
    setIssueDateInputsMaxToday();
    const max = weekEndInputEl.max;
    if (max && weekEndInputEl.value > max) {
      weekEndInputEl.value = max;
      clampIssueDateRange("end");
      applyFilters();
    }
  }, 60_000);

  issueSelectEl?.addEventListener("change", () => {
    applyIssueNumber(Number(issueSelectEl.value));
    applyFilters();
  });

  filterApplyBtnEl?.addEventListener("click", () => {
    applyFilters();
  });

  searchInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters();
    }
  });

  markCandidateBtnEl.addEventListener("click", () => updateArticleStatus("candidate"));
  markReviewBtnEl.addEventListener("click", () => updateArticleStatus("review"));
  markRejectedBtnEl.addEventListener("click", () => updateArticleStatus("rejected"));

  logoutBtnEl?.addEventListener("click", () => {
    if (typeof window.WEEKLY_AUTH !== "undefined") {
      window.WEEKLY_AUTH.logout();
    }
  });

  refreshBtnEl.addEventListener("click", async () => {
    if (isWeeklyStaticDeploy()) {
      alert(
        "当前为 GitHub Pages 静态预览：无法连接后端同步数据。请在本地启动 Node 服务（server）以使用「刷新数据」等完整功能。"
      );
      return;
    }
    refreshBtnEl.disabled = true;
    refreshBtnEl.textContent = "同步中...";
    try {
      let startDate = weekStartInputEl?.value || "";
      let endDate = weekEndInputEl?.value || "";
      const rssUrl = "";
      const useRss = state.serverRssConfigured;
      if (useRss) {
        startDate = "1970-01-01";
        endDate = formatDateInput(new Date());
      }
      if (!startDate || !endDate) {
        throw new Error("请先选择开始日期和结束日期");
      }
      if (startDate > endDate) {
        throw new Error("开始日期不能晚于结束日期");
      }
      startRefreshSyncModal();
      const result = await postJson(APP_CONFIG.refreshEndpoint, {
        startDate,
        endDate,
        source: useRss ? "rss" : "weixin",
        rssUrl
      });
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_ARTICLE_SYNC, "1");
      }
      const imported = Number(result.count);
      state.lastRefreshImportedCount = Number.isFinite(imported) ? Math.max(0, Math.floor(imported)) : 0;
      refreshBtnEl.textContent = "加载资讯列表...";

      if (!Number.isFinite(imported) || imported < 1) {
        const lines = [];
        if (result.keptPreviousBecauseEmpty) {
          lines.push("本次同步未从数据源解析到新文章，已保留本地原有列表（避免因 0 条误清空）。");
        } else {
          lines.push("本次同步未拉到任何文章。");
        }
        if (result.source === "weixin") {
          lines.push(
            "当前为「微信库」同步：请确认 WEIXIN_MONGO_URI 可连、库内有公众号文章，且所选日期范围包含文章的发布时间。"
          );
        } else if (result.source === "rss") {
          lines.push(
            "当前为「RSS」同步：请检查 .env 中 WECHAT_RSS_URL(S) 是否有效、token 是否过期；或所选日期范围内 RSS 条目是否被全部过滤。"
          );
          if (Array.isArray(result.feedErrors) && result.feedErrors.length) {
            lines.push(`RSS 拉取异常（节选）：${JSON.stringify(result.feedErrors).slice(0, 500)}`);
          }
          if (result.poll && result.poll.message) {
            lines.push(`轮询说明：${result.poll.message}`);
          }
        }
        alert(lines.join("\n\n"));
      }

      await loadArticles(false);
    } catch (error) {
      alert(`刷新失败：${error.message}`);
      if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY_ARTICLE_SYNC) === "1") {
        await loadArticles(true);
      } else {
        showInitialEmptyWorkspace();
      }
    } finally {
      stopRefreshSyncModal();
      refreshBtnEl.disabled = false;
      refreshBtnEl.textContent = "刷新数据";
    }
  });

  loadDemoBtnEl?.addEventListener("click", () => {
    state.articles = MOCK_ARTICLES.map((item) => ({ ...item }));
    runAutoAnalysis();
    buildIndustryOptions();
    applyFilters();
  });

  generateWeeklyBtnEl.addEventListener("click", async () => {
    if (isWeeklyStaticDeploy()) {
      alert("静态预览模式不支持在服务端生成周刊 HTML。请在本地运行服务后使用「生成周刊预览」。");
      return;
    }
    const selected = state.articles.filter((article) => getArticleStatus(article) === "candidate");
    if (!selected.length) {
      alert("请先将至少1篇文章加入候选池。");
      return;
    }
    generateWeeklyBtnEl.disabled = true;
    generateWeeklyBtnEl.textContent = "生成中...";
    try {
      const payload = {
        weeklyTitle: "本周精选周刊",
        articles: selected.map((article) => ({
          title: article.title,
          url: article.url,
          content: article.body,
          summary: article.aiSummary || "",
          score: state.resultsById[article.id]?.totalScore || 0
        }))
      };
      const data = await postJson(APP_CONFIG.weeklyEndpoint, payload);
      latestWeeklyHtml = data.html || "";
      if (!latestWeeklyHtml) {
        throw new Error("周刊内容为空");
      }
      const previewWindow = window.open("", "_blank");
      if (previewWindow) {
        previewWindow.document.open();
        previewWindow.document.write(latestWeeklyHtml);
        previewWindow.document.close();
      }
    } catch (error) {
      alert(`周刊生成失败：${error.message}`);
    } finally {
      generateWeeklyBtnEl.disabled = false;
      generateWeeklyBtnEl.textContent = "生成周刊预览";
    }
  });

  downloadWeeklyBtnEl.addEventListener("click", () => {
    if (!latestWeeklyHtml) {
      alert("请先生成周刊预览，再下载。");
      return;
    }
    const blob = new Blob([latestWeeklyHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function initUserHeader() {
  if (typeof window.WEEKLY_AUTH === "undefined") {
    return;
  }
  const name = window.WEEKLY_AUTH.getDisplayName();
  if (userDisplayNameEl) {
    userDisplayNameEl.textContent = name;
  }
  if (userAvatarEl) {
    const ch = name.trim().slice(0, 1) || "用";
    userAvatarEl.textContent = ch;
  }
}

async function bootstrap() {
  initUserHeader();
  await loadServerConfig();
  initWeekRange();
  attachEvents();
  if (isWeeklyStaticDeploy()) {
    await loadArticles(true);
    return;
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY_ARTICLE_SYNC) === "1") {
    await loadArticles(true);
  } else {
    showInitialEmptyWorkspace();
  }
}

bootstrap();
