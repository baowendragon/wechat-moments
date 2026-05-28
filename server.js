const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SEED_DB_PATH = path.join(DEFAULT_DATA_DIR, "db.json");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm"
};

function ensureStorage() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    if (DB_PATH !== SEED_DB_PATH && fs.existsSync(SEED_DB_PATH)) {
      fs.copyFileSync(SEED_DB_PATH, DB_PATH);
    } else {
      fs.writeFileSync(DB_PATH, JSON.stringify({ doctors: [], assets: [], posts: [], settings: {} }, null, 2));
    }
  }
}

function readDb() {
  ensureStorage();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100 * 1024 * 1024) {
        reject(new Error("请求体过大，请压缩视频或先上传较小素材。"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("请求 JSON 格式不正确。"));
      }
    });
    req.on("error", reject);
  });
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function pickExtension(mime, fileName = "") {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) return fromName;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "video/quicktime") return ".mov";
  if (mime === "video/webm") return ".webm";
  return ".bin";
}

function getDoctor(db, id) {
  return db.doctors.find(doctor => doctor.id === id);
}

function getAsset(db, id) {
  return db.assets.find(asset => asset.id === id);
}

function getComplianceWarnings(copy, db, doctor) {
  const words = new Set([...(db.settings.complianceWords || [])]);
  cleanText(doctor?.banned)
    .split(/[、,，\s]+/)
    .filter(Boolean)
    .forEach(word => words.add(word));
  return [...words].filter(word => copy.includes(word));
}

function getRuntimeInfo() {
  return {
    aiEnabled: Boolean(OPENAI_API_KEY),
    aiProvider: OPENAI_API_KEY ? "openai" : "local",
    aiModel: OPENAI_API_KEY ? OPENAI_MODEL : "local-template"
  };
}

function firstProject(projects = "") {
  return cleanText(projects).split(/[、,，]/).filter(Boolean)[0] || "";
}

function shortAssetNote(notes = "") {
  const cleaned = cleanText(notes)
    .replace(/适合表达/g, "")
    .replace(/画面/g, "")
    .replace(/素材/g, "")
    .replace(/[。；;]+$/g, "");
  if (!cleaned) return "";
  return cleaned.length > 34 ? `${cleaned.slice(0, 34)}...` : cleaned;
}

function generateCopy({ doctor, assets, goal, customerStage, tone }) {
  const category = assets[0]?.category || "门诊日常";
  const project = assets[0]?.project || firstProject(doctor.projects) || doctor.department;
  const projectLine = project.includes("、") ? project.split("、")[0] : project;
  const notes = shortAssetNote(assets.map(asset => asset.notes).filter(Boolean).join("；"));
  const doctorName = doctor.name || "医生";

  const hookByCategory = {
    门诊日常: [
      "今天门诊又是从沟通开始的一天。",
      "门诊里最常被问到的，其实不是项目本身。",
      "今天面诊时又聊到一个很真实的问题。"
    ],
    专业科普: [
      `关于${projectLine}，很多人一开始都会想复杂。`,
      `最近问${projectLine}的人不少，简单说几句。`,
      `一个关于${projectLine}的小提醒。`
    ],
    案例反馈: [
      "今天收到一个反馈，挺有代表性。",
      "复盘一个最近很典型的情况。",
      "有些变化不是突然发生的，是一步一步调整出来的。"
    ],
    项目介绍: [
      `${projectLine}不是越早做越好，也不是别人适合你就适合。`,
      `聊${projectLine}之前，我更在意的是适不适合。`,
      `很多人问项目，我通常会先问基础情况。`
    ],
    医生生活: [
      "今天的小日常。",
      "忙里偷一点时间记录一下。",
      "工作之外，也想把状态调整好。"
    ],
    客户反馈: [
      "收到反馈的时候，还是会觉得挺开心。",
      "好的反馈背后，通常是前期判断做对了。",
      "今天这个反馈，想分享给正在犹豫的朋友。"
    ]
  };

  const bodyByGoal = {
    建立信任: [
      `我一直觉得，${doctor.department}不是上来就推荐项目，而是先把情况看清楚。`,
      "基础、诉求、预算、恢复节奏都不一样，答案也不会完全一样。"
    ],
    激活咨询: [
      `如果你最近也在纠结${projectLine}，先别急着自己判断。`,
      "把现在的情况说清楚，很多方向其实就能先排出来。"
    ],
    项目种草: [
      `${projectLine}真正有价值的地方，不是“做了就变好”，而是和你的基础匹配。`,
      "适合的人会觉得省心，不适合的人硬做反而容易失望。"
    ],
    专业科普: [
      `判断${projectLine}，我一般先看原因，再看方案。`,
      "很多问题表面看差不多，背后的处理方式可能完全不同。"
    ],
    案例转化: [
      "客户最开始也会犹豫，这是很正常的。",
      "真正做决定之前，把顾虑问清楚，比冲动安排更重要。"
    ],
    节日关怀: [
      "最近大家都挺忙的，但身体和状态还是要顾一下。",
      `已经有${projectLine}困扰的朋友，别一直拖到很严重才处理。`
    ]
  };

  const endings = {
    刚添加微信: `刚加微信的朋友，如果不知道怎么问，可以直接发照片和你最想改善的一点，我先帮你看个大方向。`,
    已咨询未到店: `之前聊过还没定的朋友，也可以把最近状态再发我一下，我们重新看一遍。`,
    老客户维护: `做过管理的朋友，近期状态有变化记得和我说，方案也要跟着状态调整。`,
    高意向客户: `近期想安排的朋友，可以直接把时间和顾虑发我，我帮你把面诊前要确认的点列清楚。`
  };

  const toneLine = tone === "理性可信"
    ? "慢一点判断，通常会更稳。"
    : tone === "生活感"
      ? "不用把这件事想得太重，先弄清楚自己的状态。"
      : `${doctorName}还是那句话：先判断，再选择。`;

  const categoryHooks = hookByCategory[category] || hookByCategory["门诊日常"];
  const hook = categoryHooks[Math.floor(Math.random() * categoryHooks.length)];
  const body = bodyByGoal[goal] || bodyByGoal["建立信任"];
  const noteLine = notes ? `${notes}。` : "";

  return [
    hook,
    "",
    noteLine || body[0],
    noteLine ? body[0] : body[1],
    "",
    toneLine,
    "",
    endings[customerStage] || endings["刚添加微信"]
  ].filter(Boolean).join("\n");
}

function buildOpenAIPrompt({ doctor, assets, goal, customerStage, tone }) {
  return [
    "请为医生微信朋友圈生成一条可直接发布的中文文案。",
    "",
    "医生信息：",
    `- 姓名：${doctor.name}`,
    `- 科室：${doctor.department}`,
    `- 城市：${doctor.city}`,
    `- 擅长项目：${doctor.projects || "未填写"}`,
    `- 人设：${doctor.persona || "专业、耐心、可信"}`,
    `- 说话风格：${tone || doctor.style || "专业亲和"}`,
    `- 人设标签：${(doctor.tags || []).join("、") || "专业可信"}`,
    `- 禁用表达：${doctor.banned || "保证效果、根治、永久、绝对、百分百、无风险"}`,
    "",
    "发布任务：",
    `- 发布目的：${goal}`,
    `- 客户阶段：${customerStage}`,
    "",
    "素材信息：",
    ...assets.map((asset, index) => [
      `${index + 1}. ${asset.name}`,
      `   类型：${asset.category || asset.type}`,
      `   项目：${asset.project || "未标注"}`,
      `   说明：${asset.notes || "运营未填写素材说明，请根据医生人设生成通用朋友圈文案。"}`
    ].join("\n")),
    "",
    "输出要求：",
    "- 只输出朋友圈文案正文，不要标题、编号、解释、引号或 Markdown。",
    "- 像医生本人发朋友圈，不像广告，不像机构宣传稿，不要出现“后台”“私信爆了”等网感营销话术。",
    "- 口吻自然、有一点日常感，短句为主，4-7 个短段落，总字数 90-180 字。",
    "- 可以温和引导咨询，但不要强促销，不要制造焦虑。",
    "- 医疗表达必须克制：不能承诺疗效，不能使用绝对化词，不能说所有人都适合。",
    "- 多用“先判断基础”“结合个人情况”“面诊后确认”“大方向”这类稳妥表达。",
    "- 如果是案例或反馈素材，不要编造具体效果、数字、时间、客户身份。"
  ].join("\n");
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text.trim();
      if (typeof content.text === "string" && content.text.trim()) return content.text.trim();
    }
  }
  return "";
}

async function generateOpenAICopy(input) {
  if (!OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "你是一个医生 IP 私域朋友圈内容运营专家。",
        "你擅长把医生专业度、人设温度和轻咨询转化结合起来。",
        "你的文案必须合规、克制、自然，避免医疗疗效承诺和夸大营销。"
      ].join("\n"),
      input: buildOpenAIPrompt(input),
      max_output_tokens: 500,
      store: false
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `OpenAI 请求失败：${response.status}`;
    throw new Error(message);
  }

  const text = extractOpenAIText(data);
  if (!text) throw new Error("OpenAI 没有返回可用文案。");
  return text.replace(/^["“]|["”]$/g, "").trim();
}

async function generateBestCopy(input) {
  if (!OPENAI_API_KEY) {
    return {
      copy: generateCopy(input),
      aiProvider: "local",
      aiModel: "local-template",
      aiError: null
    };
  }

  try {
    return {
      copy: await generateOpenAICopy(input),
      aiProvider: "openai",
      aiModel: OPENAI_MODEL,
      aiError: null
    };
  } catch (error) {
    return {
      copy: generateCopy(input),
      aiProvider: "local-fallback",
      aiModel: "local-template",
      aiError: error.message || "OpenAI 生成失败，已使用本地备用生成。"
    };
  }
}

function nextDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function handleApi(req, res, pathname) {
  const db = readDb();

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, { ...db, runtime: getRuntimeInfo() });
  }

  if (req.method === "POST" && pathname === "/api/doctors") {
    const body = await readBody(req);
    const doctor = {
      id: makeId("doc"),
      name: cleanText(body.name) || "未命名医生",
      department: cleanText(body.department) || "未填写科室",
      city: cleanText(body.city) || "未填写城市",
      projects: cleanText(body.projects),
      persona: cleanText(body.persona),
      style: cleanText(body.style) || "专业亲和",
      tags: cleanText(body.tags).split(/[、,，\s]+/).filter(Boolean),
      banned: cleanText(body.banned)
    };
    db.doctors.unshift(doctor);
    writeDb(db);
    return sendJson(res, 201, doctor);
  }

  if (req.method === "POST" && pathname === "/api/assets") {
    const body = await readBody(req);
    const id = makeId("asset");
    let url = cleanText(body.url);
    let mime = cleanText(body.mime) || "application/octet-stream";
    let type = mime.startsWith("video/") ? "video" : "image";

    if (body.dataUrl) {
      const match = String(body.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return sendJson(res, 400, { error: "素材文件格式不正确。" });
      mime = match[1];
      type = mime.startsWith("video/") ? "video" : "image";
      const ext = pickExtension(mime, body.name);
      const fileName = `${id}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fileName), Buffer.from(match[2], "base64"));
      url = `/uploads/${fileName}`;
    }

    const asset = {
      id,
      name: cleanText(body.name) || "未命名素材",
      type,
      mime,
      url,
      category: cleanText(body.category) || "门诊日常",
      project: cleanText(body.project),
      doctorId: cleanText(body.doctorId),
      notes: cleanText(body.notes),
      createdAt: new Date().toISOString()
    };
    db.assets.unshift(asset);
    writeDb(db);
    return sendJson(res, 201, asset);
  }

  if (req.method === "POST" && pathname === "/api/generate") {
    const body = await readBody(req);
    const doctor = getDoctor(db, body.doctorId);
    if (!doctor) return sendJson(res, 400, { error: "请先选择医生。" });
    const assets = (body.assetIds || []).map(id => getAsset(db, id)).filter(Boolean);
    if (!assets.length) return sendJson(res, 400, { error: "请至少选择一个素材。" });

    const generation = await generateBestCopy({
      doctor,
      assets,
      goal: cleanText(body.goal) || "建立信任",
      customerStage: cleanText(body.customerStage) || "刚添加微信",
      tone: cleanText(body.tone) || doctor.style
    });

    const post = {
      id: makeId("post"),
      doctorId: doctor.id,
      assetIds: assets.map(asset => asset.id),
      goal: cleanText(body.goal) || "建立信任",
      customerStage: cleanText(body.customerStage) || "刚添加微信",
      tone: cleanText(body.tone) || doctor.style,
      scheduledDate: cleanText(body.scheduledDate) || nextDate(0),
      timeSlot: cleanText(body.timeSlot) || "09:30",
      copy: generation.copy,
      status: "待发布",
      warnings: getComplianceWarnings(generation.copy, db, doctor),
      aiProvider: generation.aiProvider,
      aiModel: generation.aiModel,
      aiError: generation.aiError,
      createdAt: new Date().toISOString(),
      publishedAt: null
    };
    db.posts.unshift(post);
    writeDb(db);
    return sendJson(res, 201, post);
  }

  if (req.method === "POST" && pathname === "/api/schedule") {
    const body = await readBody(req);
    const doctor = getDoctor(db, body.doctorId);
    if (!doctor) return sendJson(res, 400, { error: "请先选择医生。" });
    const days = Math.max(1, Math.min(14, Number(body.days || 7)));
    const assets = db.assets.filter(asset => !body.doctorId || asset.doctorId === doctor.id || !asset.doctorId);
    if (!assets.length) return sendJson(res, 400, { error: "这个医生还没有可用素材。" });

    const goals = ["建立信任", "专业科普", "案例转化", "激活咨询", "项目种草"];
    const stages = ["刚添加微信", "已咨询未到店", "老客户维护", "高意向客户"];
    const times = ["09:30", "12:20", "20:30"];
    const created = [];

    for (let i = 0; i < days; i += 1) {
      const asset = assets[i % assets.length];
      const goal = goals[i % goals.length];
      const customerStage = stages[i % stages.length];
      const generation = await generateBestCopy({ doctor, assets: [asset], goal, customerStage, tone: doctor.style });
      const post = {
        id: makeId("post"),
        doctorId: doctor.id,
        assetIds: [asset.id],
        goal,
        customerStage,
        tone: doctor.style,
        scheduledDate: nextDate(i),
        timeSlot: times[i % times.length],
        copy: generation.copy,
        status: "待发布",
        warnings: getComplianceWarnings(generation.copy, db, doctor),
        aiProvider: generation.aiProvider,
        aiModel: generation.aiModel,
        aiError: generation.aiError,
        createdAt: new Date().toISOString(),
        publishedAt: null
      };
      db.posts.push(post);
      created.push(post);
    }
    writeDb(db);
    return sendJson(res, 201, { created });
  }

  const publishMatch = pathname.match(/^\/api\/posts\/([^/]+)\/publish$/);
  if (req.method === "POST" && publishMatch) {
    const post = db.posts.find(item => item.id === publishMatch[1]);
    if (!post) return sendJson(res, 404, { error: "没有找到这条朋友圈。" });
    post.status = "已发布";
    post.publishedAt = new Date().toISOString();
    writeDb(db);
    return sendJson(res, 200, post);
  }

  const postMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (req.method === "PUT" && postMatch) {
    const body = await readBody(req);
    const post = db.posts.find(item => item.id === postMatch[1]);
    if (!post) return sendJson(res, 404, { error: "没有找到这条朋友圈。" });
    ["copy", "scheduledDate", "timeSlot", "goal", "customerStage", "tone", "status"].forEach(key => {
      if (body[key] !== undefined) post[key] = body[key];
    });
    const doctor = getDoctor(db, post.doctorId);
    post.warnings = getComplianceWarnings(post.copy || "", db, doctor);
    writeDb(db);
    return sendJson(res, 200, post);
  }

  return sendJson(res, 404, { error: "接口不存在。" });
}

function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname.startsWith("/uploads/")) {
    filePath = path.join(UPLOAD_DIR, pathname.replace("/uploads/", ""));
  } else {
    const safePath = pathname === "/" ? "/index.html" : pathname;
    filePath = path.join(PUBLIC_DIR, safePath);
  }

  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(UPLOAD_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

ensureStorage();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误。" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`朋友圈运营工作台已启动: http://${HOST}:${PORT}`);
});
