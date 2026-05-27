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

function generateCopy({ doctor, assets, goal, customerStage, tone }) {
  const category = assets[0]?.category || "门诊日常";
  const project = assets[0]?.project || doctor.projects.split(/[、,，]/)[0] || doctor.department;
  const notes = assets.map(asset => asset.notes).filter(Boolean).join("；");
  const tag = doctor.tags?.[0] || "专业";
  const projectLine = project.includes("、") ? project.split("、")[0] : project;

  const openings = {
    建立信任: `今天想聊一个很多朋友都会忽略的小细节：${projectLine}之前，先判断自己到底适不适合。`,
    激活咨询: `最近后台问${projectLine}的朋友明显多了，很多问题其实看一眼基础情况就能先判断方向。`,
    项目种草: `${projectLine}不是跟风做项目，真正重要的是找到和自己状态匹配的方案。`,
    专业科普: `关于${projectLine}，我更建议大家先理解原理，再决定要不要做。`,
    案例转化: `今天复盘一个很典型的咨询场景：想改善，但不知道第一步该怎么选。`,
    节日关怀: `忙的时候也别忘了照顾好自己，尤其是已经有${projectLine}困扰的朋友。`
  };

  const middleByCategory = {
    门诊日常: `门诊里我常提醒大家，方案不是越满越好，而是越适合越好。${notes || `每个人的基础条件、预算和恢复节奏都不一样，需要先把优先级排清楚。`}`,
    专业科普: `${notes || `如果基础判断不清楚，很容易把护理、治疗和日常习惯混在一起。`} 先明确原因，再谈方案，后面的选择会稳很多。`,
    案例反馈: `${notes || `客户反馈里最值得看的不是单次变化，而是整个过程有没有被持续观察和调整。`} 好结果通常来自清晰判断和稳定配合。`,
    医生日常: `${notes || `日常工作里，真正花时间的往往不是操作本身，而是前期沟通和风险确认。`} 这些细节会直接影响体验和结果预期。`,
    项目介绍: `${projectLine}适合什么人、不适合什么人，都需要放在同一个方案里讲清楚。只讲优点，反而不够负责。`
  };

  const endings = {
    刚添加微信: `如果你刚加我，还不确定怎么开始，可以先发一张近期照片和你最想改善的问题，我帮你做个初步判断。`,
    已咨询未到店: `之前聊过但还没确定的朋友，可以把最近状态再发我一下，我们重新看一遍优先级。`,
    老客户维护: `已经做过管理的朋友，最近如果状态有变化，也记得及时反馈，方案需要跟着状态调整。`,
    高意向客户: `如果你近期就想安排，可以直接把时间和顾虑发我，我帮你把面诊前需要确认的点列清楚。`
  };

  const toneLine = tone === "理性可信"
    ? `我一直觉得，${doctor.department}方案最需要的是长期判断和细节管理。`
    : tone === "生活感"
      ? `不用把这件事想得太复杂，先把自己的状态看清楚就已经完成了一半。`
      : `${doctor.name}的习惯是先把问题讲明白，再给建议。`;

  return [
    openings[goal] || openings["建立信任"],
    "",
    middleByCategory[category] || middleByCategory["门诊日常"],
    "",
    `${toneLine} 每个人情况不同，建议都要回到个人基础上。`,
    "",
    endings[customerStage] || endings["刚添加微信"]
  ].join("\n");
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
    return sendJson(res, 200, db);
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

    const copy = generateCopy({
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
      copy,
      status: "待发布",
      warnings: getComplianceWarnings(copy, db, doctor),
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
      const copy = generateCopy({ doctor, assets: [asset], goal, customerStage, tone: doctor.style });
      const post = {
        id: makeId("post"),
        doctorId: doctor.id,
        assetIds: [asset.id],
        goal,
        customerStage,
        tone: doctor.style,
        scheduledDate: nextDate(i),
        timeSlot: times[i % times.length],
        copy,
        status: "待发布",
        warnings: getComplianceWarnings(copy, db, doctor),
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
