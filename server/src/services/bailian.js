const fs = require("fs");
const path = require("path");

function loadSkillMarkdownDigest() {
  try {
    const skillPath = path.join(__dirname, "..", "..", "..", "sasac-weekly-screener", "SKILL.md");
    let raw = fs.readFileSync(skillPath, "utf8");
    raw = raw.replace(/^---[\s\S]*?---\s*/m, "");
    return raw.trim().slice(0, 12000);
  } catch {
    return "";
  }
}

const SKILL_MD_DIGEST = loadSkillMarkdownDigest();

function extractJsonFromModelText(text) {
  if (!text || typeof text !== "string") {
    return "{}";
  }
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    return fence[1].trim();
  }
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i !== -1 && j > i) {
    return t.slice(i, j + 1);
  }
  return t;
}

function clampInt(n, min, max) {
  const x = Math.round(Number(n));
  if (Number.isNaN(x)) {
    return min;
  }
  return Math.max(min, Math.min(max, x));
}

/** 与 sasac-weekly-screener/SKILL.md 第六步栏目一致 */
const SASAC_SECTIONS = [
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

const SECTION_ALIASES = {
  生物医药产业: "生物制造产业",
  信创: "新一代信息技术产业",
  航天: "商业航天产业",
  无对应产业栏目: "其他",
  无对应栏目: "其他",
  未识别: "其他",
};

function normalizeSasacSection(input) {
  const t = String(input || "").trim();
  if (SASAC_SECTIONS.includes(t)) {
    return t;
  }
  if (SECTION_ALIASES[t]) {
    return SECTION_ALIASES[t];
  }
  for (const s of SASAC_SECTIONS) {
    if (t.includes(s) || s.includes(t)) {
      return s;
    }
  }
  return "其他";
}

function normalizeRelatedIndustries(arr, primary) {
  const p = normalizeSasacSection(primary);
  const out = new Set();
  if (!Array.isArray(arr)) {
    return [];
  }
  for (const x of arr) {
    const n = normalizeSasacSection(x);
    if (n && n !== p) {
      out.add(n);
    }
  }
  return [...out].slice(0, 8);
}

function normalizeSkillDecision(d) {
  const s = String(d || "");
  if (s.includes("进入候选池") || (s.includes("入候选") && !s.includes("备选"))) {
    return "进入候选池";
  }
  if (s.includes("备选") || s.includes("复核")) {
    return "备选，建议人工复核";
  }
  return "淘汰";
}

function getArkConfig() {
  return {
    baseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env.ARK_API_KEY,
    model: process.env.ARK_MODEL || "seed-2-0-mini-260215",
  };
}

function ensureEnv() {
  const { apiKey } = getArkConfig();
  if (!apiKey) {
    throw new Error("缺少 ARK_API_KEY，请在 .env 中配置");
  }
}

function buildBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function looksLikeImageUrl(url) {
  if (typeof url !== "string") return false;
  const value = url.trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith("data:image/")) return true;
  if (!/^https?:\/\//.test(value)) return false;
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?(#.*)?$/.test(value);
}

async function chat(messages, temperature = 0.2) {
  ensureEnv();
  const { baseUrl, apiKey, model } = getArkConfig();

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ARK 调用失败: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "";
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (typeof part?.text === "string" && part.text.trim()) {
          return part.text.trim();
        }
      }
    }

    if (Array.isArray(item?.summary)) {
      for (const part of item.summary) {
        if (typeof part?.text === "string" && part.text.trim()) {
          return part.text.trim();
        }
      }
    }
  }

  return "";
}

async function analyzeImageWithResponses({
  imageUrl,
  text = "你看见了什么？",
  model,
} = {}) {
  ensureEnv();
  const { baseUrl, apiKey } = getArkConfig();
  const responseModel = model || process.env.ARK_RESPONSES_MODEL || process.env.ARK_MODEL;
  const finalImageUrl = imageUrl || process.env.ARK_DEMO_IMAGE_URL;

  if (!responseModel) {
    throw new Error("缺少 ARK_RESPONSES_MODEL，请在 .env 中配置");
  }
  if (!finalImageUrl) {
    throw buildBadRequestError("缺少 imageUrl，请传入图片直链地址或配置 ARK_DEMO_IMAGE_URL");
  }
  if (!looksLikeImageUrl(finalImageUrl)) {
    throw buildBadRequestError("imageUrl 必须是可访问的图片直链（如 .png/.jpg/.webp），不能传文章页链接");
  }

  const resp = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: responseModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: finalImageUrl },
            { type: "input_text", text },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ARK responses 调用失败: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  const answer = extractResponsesText(data);
  return {
    answer: answer || "模型未返回可读文本结果",
    model: responseModel,
    imageUrl: finalImageUrl,
    raw: data,
  };
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function scoreOneArticle(article, preference = "") {
  const prompt = `
你是内容编辑助手。请根据用户偏好对文章打分（0-100）。
只返回 JSON，不要任何额外文本：
{"score": 0-100的数字, "reason": "一句话理由"}

用户偏好：
${preference || "高质量、信息密度高、结构清晰、实用性强"}

文章标题：
${article.title || ""}

文章内容（可能被截断）：
${(article.content || "").slice(0, 4000)}
  `.trim();

  const raw = await chat(
    [
      { role: "system", content: "你是严格输出JSON的助手。" },
      { role: "user", content: prompt },
    ],
    0.1
  );

  const parsed = safeJsonParse(raw, { score: 0, reason: "模型返回非JSON，已降级处理" });
  const score = Number(parsed.score) || 0;
  const reason = String(parsed.reason || "无理由");

  return {
    ...article,
    score: Math.max(0, Math.min(100, score)),
    reason,
  };
}

async function scoreArticles(articles = [], preference = "", topN = 10) {
  if (!Array.isArray(articles) || articles.length === 0) return [];

  const scored = [];
  for (const article of articles) {
    try {
      const result = await scoreOneArticle(article, preference);
      scored.push(result);
    } catch (err) {
      scored.push({
        ...article,
        score: 0,
        reason: `打分失败: ${err.message}`,
      });
    }
  }

  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  return scored.slice(0, topN);
}

/**
 * 产业资讯周刊单篇初筛（对齐 sasac-weekly-screener/SKILL.md 五维模型与条型/栏目）
 */
async function skillScreenArticle(article) {
  const body = String(article.body || article.content || "").slice(0, 5000);
  const digest =
    SKILL_MD_DIGEST ||
    "先做可写性校验（主体、时间、动作、来源），再做条型判断（九主类+三子类），并按事实压缩与可入版性打分。";

  const prompt = `你是产业资讯周刊单篇初筛编辑，必须遵守下列「初筛 Skill」规范与五维打分规则。

=== Skill 正文（节选）===
${digest}
===

栏目名称（tagSection / relatedIndustries 元素）必须且只能来自以下 12 项（字面相等）：
${SASAC_SECTIONS.join("、")}

请阅读文章后只输出一个 JSON 对象（不要 markdown、不要解释），字段要求：
{
  "industry": 整数 0-20（素材完整度与产业相关性：主体/时间/动作/事实层是否齐备且与产业有关）,
  "authority": 整数 0-20（来源规范与可信度：来源是否清晰、是否可规范标注）,
  "impact": 整数 0-30（事实密度与产业意义：关键动作、数字、直接产业影响是否明确）,
  "novelty": 整数 0-20（条型匹配度：是否能稳定归入九主类或三子类）,
  "verifiability": 整数 0-10（可入版性与语言克制：是否存在宣传腔、绝对化和不可核查表达）,
  "tagSection": "主栏目，字符串，必须是上面 12 项之一",
  "relatedIndustries": ["与本文显著相关、但非主栏目的其他栏目，每项也须为上面 12 项之一；不要重复 tagSection；无则空数组"],
  "tagCandidateType": "条型：必须从以下中选择最接近的一项：领导活动与工作部署类、政策法规与制度发布类、风险预警与规范提醒类、国际博弈与外部规则施压类、国际趋势与竞争变量变化类、投资合作与资本运作类、产品发布与平台上线类、标志性成果与首台套突破类、性能突破与数据披露类、医药研发进展子类、负面调整与合作终止子类、讲话提炼型工作部署子类",
  "decision": "必须是以下之一：进入候选池、备选建议人工复核、淘汰（三选一，第二项请写完整为：备选，建议人工复核）"
}

评分时请遵守：
- 先做可写性：主体、时间、核心动作、来源任一严重缺失时，分数上限不超过 59。
- 存在明显宣传化、绝对化、评测化措辞时，下调 verifiability。
- totalScore = 五维之和，范围 0-100。
- 建议阈值：>=72 进入候选池；60-71 备选，建议人工复核；<60 淘汰。

文章标题：${article.title || ""}
来源名称：${article.sourceName || ""}
发布时间：${article.publishDate || ""}
原文链接：${article.url || ""}
正文：
${body}`;

  const raw = await chat(
    [
      {
        role: "system",
        content:
          "你是产业资讯周刊单篇初筛编辑，只输出合法 JSON，键名与字段要求与用户消息一致。",
      },
      { role: "user", content: prompt },
    ],
    0.12
  );

  const jsonStr = extractJsonFromModelText(raw);
  const parsed = safeJsonParse(jsonStr, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("模型未返回可解析 JSON");
  }

  const industry = clampInt(parsed.industry, 0, 20);
  const authority = clampInt(parsed.authority, 0, 20);
  const impact = clampInt(parsed.impact, 0, 30);
  const novelty = clampInt(parsed.novelty, 0, 20);
  const verifiability = clampInt(parsed.verifiability, 0, 10);
  const sum = industry + authority + impact + novelty + verifiability;
  let totalScore = clampInt(parsed.totalScore, 0, 100);
  if (Number.isNaN(Number(parsed.totalScore)) || Math.abs(totalScore - sum) > 3) {
    totalScore = clampInt(sum, 0, 100);
  }

  const tagSection = normalizeSasacSection(parsed.tagSection);
  const relatedIndustries = normalizeRelatedIndustries(parsed.relatedIndustries, tagSection);

  return {
    totalScore,
    industry,
    authority,
    impact,
    novelty,
    verifiability,
    tagSection,
    relatedIndustries,
    tagCandidateType: String(parsed.tagCandidateType || "一般产业动态候选").slice(0, 56),
    decision: normalizeSkillDecision(parsed.decision),
  };
}

async function summarizeArticle(article) {
  const sourceHint = article.sourceName
    ? `主信源为「${String(article.sourceName).slice(0, 80)}」。公众号来源在摘要中写「${String(article.sourceName).slice(0, 40)}公众号」；其他来源写机构或媒体名即可。`
    : "信源未提供，摘要中不要编造来源名称。";
  const timeHint = article.publishDate
    ? `文章发布日期（供写入事实层，勿与正文矛盾）：${String(article.publishDate).slice(0, 64)}`
    : "";
  const prompt = `
你是产业资讯周刊的成稿编辑，任务是把候选资讯压缩成「摘要标题 + 摘要总结」两段式成稿材料。优先信息密度与可核查性，不展示文风。

${sourceHint}
${timeHint}

写作原则（与刊物一致）：
- 优选信息，不堆砌背景；不编造事实；缺信息可简述缺口。
- 不用营销腔、口号式表述；禁用「重磅、极其、彻底、完全、爆发式」等修饰词；不做无依据的趋势断言。
- 技术细节多时要上收成治理语言、产业语言或竞争语言。

请先在心里完成「事实压缩」：保留主体、动作、时间、数字、对产业链的直接影响；删冗长背景、重复引述与宣传修辞。

然后严格按下面格式输出两段（每段单独一行标题，冒号后用正文）：
摘要标题：<结合文章标题和正文提炼，不超过26字，不加句号>
摘要总结：<约200字（建议180-220字），写成一段完整总结；覆盖时间、主体、核心动作、关键数字与影响；结尾补一个来源写法，如「（XX公众号）」或「（XX机构）」>

标题：
${article.title || ""}

正文（可能被截断）：
${(article.content || "").slice(0, 6000)}
  `.trim();

  const summary = await chat(
    [
      {
        role: "system",
        content:
          "你是熟悉国资委产业研究类周刊语境的中文编辑，只输出用户要求的「摘要标题 / 摘要总结」两段，不输出多余说明或寒暄。",
      },
      { role: "user", content: prompt },
    ],
    0.2
  );

  return summary.trim();
}

async function buildWeekly(selectedArticles = [], weeklyTitle = "产业资讯周刊") {
  const normalized = selectedArticles.map((a, idx) => ({
    index: idx + 1,
    title: a.title || `未命名文章${idx + 1}`,
    url: a.url || "",
    sourceName: a.sourceName || "",
    publishDate: a.publishDate || "",
    section: a.section || "其他",
    candidateType: a.candidateType || "",
    summary: a.summary || "",
    summaryParts: a.summaryParts || {},
    score: a.score ?? "",
    content: (a.content || "").slice(0, 2500),
  }));

  const prompt = `
你是产业资讯周刊成稿编辑。请基于输入文章，按简报规则生成可直接预览的“纯HTML片段”（不要 markdown，不要代码块，不要解释）。

必须遵守：
- 先输出“本期要览”（5-7条），提炼最值得高层先看的关键信号，不能只是标题复述。
- 正文按栏目分组，栏目优先使用：工作部署、产业动态、新一代信息技术产业、高端装备制造产业、新材料产业、生物制造产业、新能源汽车产业、新能源产业、节能环保产业、低空经济产业、商业航天产业、其他。
- 每条资讯采用统一结构：
  1) 标题（简洁，不口号化）
  2) 正文（压缩事实，聚焦主体/动作/时间/数字/产业意义，末尾带来源）
  3) 点评（1-3句，基于事实、克制中肯；风险提示类可省略点评）
- 对公众号来源，来源写法使用“XX公众号”。
- 全文避免营销化、绝对化和情绪化措辞。

HTML结构要求：
- 一个主标题
- 一个“本期要览”区块（ul/li）
- 多个栏目区块（每个栏目含若干条 article）
- 每条 article 中包含：h3（标题）、p（正文）、p（点评，可选）
- 语气专业、稳健、可入版

周刊标题：${weeklyTitle}
文章数据：
${JSON.stringify(normalized, null, 2)}
  `.trim();

  const htmlFragment = await chat(
    [
      { role: "system", content: "你是输出高可读HTML内容的助手。" },
      { role: "user", content: prompt },
    ],
    0.3
  );

  return `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${weeklyTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.75; max-width: 900px; margin: 36px auto; padding: 0 16px; color: #1f2937; }
    h1,h2,h3 { color: #111827; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 14px 0; }
  </style>
</head>
<body>
  <div class="meta">生成时间：${new Date().toLocaleString("zh-CN")}</div>
  ${htmlFragment}
</body>
</html>
  `.trim();
}

module.exports = {
  scoreArticles,
  summarizeArticle,
  buildWeekly,
  analyzeImageWithResponses,
  skillScreenArticle,
};
