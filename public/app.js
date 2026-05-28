const api = {
  async getState() {
    return request("/api/state");
  },
  async createDoctor(payload) {
    return request("/api/doctors", { method: "POST", body: payload });
  },
  async createAsset(payload) {
    return request("/api/assets", { method: "POST", body: payload });
  },
  async generate(payload) {
    return request("/api/generate", { method: "POST", body: payload });
  },
  async createManualPost(payload) {
    return request("/api/manual-post", { method: "POST", body: payload });
  },
  async schedule(payload) {
    return request("/api/schedule", { method: "POST", body: payload });
  },
  async publish(id) {
    return request(`/api/posts/${id}/publish`, { method: "POST", body: {} });
  },
  async updatePost(id, payload) {
    return request(`/api/posts/${id}`, { method: "PUT", body: payload });
  }
};

let state = {
  doctors: [],
  assets: [],
  posts: [],
  settings: {},
  runtime: {}
};

let selectedDoctorId = localStorage.getItem("selectedDoctorId") || "";
let selectedDate = today();
let latestPostId = "";

const viewTitles = {
  today: "今日发布",
  generate: "生成文案",
  assets: "素材库",
  doctors: "医生人设",
  schedule: "排期日历"
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindForms();
  document.getElementById("refreshBtn").addEventListener("click", load);
  document.getElementById("assetSearch").addEventListener("input", renderAssets);
  load();
});

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function load() {
  state = await api.getState();
  if (!selectedDoctorId || !state.doctors.some(doctor => doctor.id === selectedDoctorId)) {
    selectedDoctorId = state.doctors[0]?.id || "";
  }
  localStorage.setItem("selectedDoctorId", selectedDoctorId);
  renderAll();
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(`view-${button.dataset.view}`).classList.add("active");
      document.getElementById("viewTitle").textContent = viewTitles[button.dataset.view];
    });
  });
}

function bindForms() {
  document.getElementById("globalDoctor").addEventListener("change", event => {
    selectedDoctorId = event.target.value;
    localStorage.setItem("selectedDoctorId", selectedDoctorId);
    syncDoctorSelectors();
    renderAll();
  });

  ["generateDoctor", "assetDoctor", "scheduleDoctor"].forEach(id => {
    document.getElementById(id).addEventListener("change", event => {
      selectedDoctorId = event.target.value;
      localStorage.setItem("selectedDoctorId", selectedDoctorId);
      syncDoctorSelectors();
      renderAll();
    });
  });

  document.getElementById("doctorForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    await api.createDoctor(payload);
    form.reset();
    toast("医生人设已保存");
    await load();
  });

  document.getElementById("assetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!file || !file.size) return toast("请先选择素材文件");
    if (file.size > 90 * 1024 * 1024) return toast("当前 MVP 单个素材建议小于 90MB");

    const dataUrl = await fileToDataUrl(file);
    await api.createAsset({
      name: data.get("name") || file.name,
      doctorId: data.get("doctorId"),
      category: data.get("category"),
      project: data.get("project"),
      notes: data.get("notes"),
      mime: file.type,
      dataUrl
    });
    form.reset();
    toast("素材已保存");
    await load();
  });

  document.getElementById("generateForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const assetIds = [...document.querySelectorAll("#assetPicker input:checked")].map(input => input.value);
    const post = await api.generate({
      doctorId: data.get("doctorId"),
      goal: data.get("goal"),
      customerStage: data.get("customerStage"),
      tone: data.get("tone"),
      scheduledDate: data.get("scheduledDate"),
      timeSlot: data.get("timeSlot"),
      assetIds
    });
    latestPostId = post.id;
    selectedDate = post.scheduledDate;
    toast("已生成并加入排期");
    await load();
  });

  document.getElementById("copyPromptBtn").addEventListener("click", () => {
    const payload = getGeneratePayload();
    const prompt = buildChatGPTPrompt(payload);
    if (!prompt) return;
    copyText(prompt);
  });

  document.getElementById("saveManualBtn").addEventListener("click", async () => {
    const payload = getGeneratePayload();
    if (!payload) return;
    const copy = document.getElementById("manualCopy").value.trim();
    if (!copy) return toast("请先粘贴 ChatGPT 生成的文案");
    const post = await api.createManualPost({ ...payload, copy });
    latestPostId = post.id;
    selectedDate = post.scheduledDate;
    document.getElementById("manualCopy").value = "";
    toast("手动文案已加入排期");
    await load();
  });

  document.getElementById("scheduleForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await api.schedule(data);
    toast(`已生成 ${result.created.length} 条排期`);
    await load();
  });
}

function getGeneratePayload() {
  const form = document.getElementById("generateForm");
  const data = new FormData(form);
  const assetIds = [...document.querySelectorAll("#assetPicker input:checked")].map(input => input.value);
  if (!assetIds.length) {
    toast("请至少选择一个素材");
    return null;
  }
  return {
    doctorId: data.get("doctorId"),
    goal: data.get("goal"),
    customerStage: data.get("customerStage"),
    tone: data.get("tone"),
    scheduledDate: data.get("scheduledDate"),
    timeSlot: data.get("timeSlot"),
    assetIds
  };
}

function buildChatGPTPrompt(payload) {
  if (!payload) return "";
  const doctor = getDoctor(payload.doctorId);
  const assets = payload.assetIds.map(getAsset).filter(Boolean);
  if (!doctor || !assets.length) {
    toast("请先选择医生和素材");
    return "";
  }

  return [
    "请帮我生成一条医生微信朋友圈文案，只输出正文，不要解释。",
    "",
    "医生信息：",
    `- 姓名：${doctor.name}`,
    `- 科室：${doctor.department}`,
    `- 城市：${doctor.city}`,
    `- 擅长项目：${doctor.projects || "未填写"}`,
    `- 人设：${doctor.persona || "专业、耐心、可信"}`,
    `- 说话风格：${payload.tone || doctor.style || "专业亲和"}`,
    `- 人设标签：${(doctor.tags || []).join("、") || "专业可信"}`,
    `- 禁用表达：${doctor.banned || "保证效果、根治、永久、绝对、百分百、无风险"}`,
    "",
    "发布任务：",
    `- 发布目的：${payload.goal}`,
    `- 客户阶段：${payload.customerStage}`,
    "",
    "素材信息：",
    ...assets.map((asset, index) => [
      `${index + 1}. ${asset.name}`,
      `   类型：${asset.category || asset.type}`,
      `   项目：${asset.project || "未标注"}`,
      `   说明：${asset.notes || "运营未填写素材说明，请根据医生人设生成通用朋友圈文案。"}`
    ].join("\n")),
    "",
    "文案要求：",
    "- 必须使用第一人称医生个人口吻，可以用“我”，不要用“我们”。",
    "- 第一行必须是朋友圈标题感强的短句，12-28 个字，适合在朋友圈列表里一眼看到。",
    "- 文案可以有医美审美感和轻微营销感，但不能像硬广、公众号或小红书笔记。",
    "- 不要出现：欢迎咨询、后台、私信爆了、逆袭、变美秘籍、闭眼冲、无脑选、效果保证。",
    "- 如果素材是人脸/皮肤照片，优先写面部轮廓、面中高光、泪沟、胶原、皮肤质感、基础条件、面诊判断等专业观察。",
    "- 结构建议：金句标题 + 1-2 句专业拆解 + 1 句克制提醒/轻引导。",
    "- 总字数 60-130 字，适合手机朋友圈阅读。",
    "- 可以使用 0-2 个符号或 emoji，比如 ✨、🌹、❗、#工作日常，但不要堆砌。",
    "- 不承诺疗效，不用绝对化表达，不说所有人都适合。",
    "- 如果是案例或反馈素材，不要编造具体效果、数字、时间、客户身份。",
    "",
    "参考风格，学习表达方式，不要照抄：",
    "以敬畏之心，打好每一针",
    "决定面部立体度的底层关键，不在鼻子，而在于颌面",
    "岁月不扰，胶原在线",
    "美，是精准到 0.01ml 的克制与野心",
    "面中高光点出来，温婉柔和，自然协调，这就是做对项目的意义",
    "",
    "避免生成这种风格：今天门诊，上午接诊了几位复查的老朋友。看着大家皮肤状态在往好的方向走，心里挺踏实的。经常有刚加我的朋友，一上来就问某个热门项目好不好。其实，皮肤管理没有标准答案。"
  ].join("\n");
}

function renderAll() {
  syncDoctorSelectors();
  renderDateTabs();
  renderToday();
  renderAIStatus();
  renderAssetPicker();
  renderLatestGenerated();
  renderAssets();
  renderDoctors();
  renderCalendar();
  const dateInput = document.getElementById("scheduledDate");
  if (!dateInput.value) dateInput.value = selectedDate;
}

function renderAIStatus() {
  const box = document.getElementById("aiStatus");
  if (!box) return;
  const runtime = state.runtime || {};
  if (runtime.aiEnabled) {
    box.className = "ai-status active";
    box.innerHTML = `<strong>${escapeHtml(runtime.aiProvider)} 已启用</strong><span>当前模型：${escapeHtml(runtime.aiModel)}</span>`;
    return;
  }
  box.className = "ai-status fallback";
  box.innerHTML = `<strong>当前为本地备用生成</strong><span>在 Render 环境变量中配置 OPENAI_API_KEY 后，会自动切换到 OpenAI。</span>`;
}

function syncDoctorSelectors() {
  const selectors = ["globalDoctor", "generateDoctor", "assetDoctor", "scheduleDoctor"];
  selectors.forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = state.doctors.map(doctor => (
      `<option value="${escapeAttr(doctor.id)}">${escapeHtml(doctor.name)} · ${escapeHtml(doctor.department)}</option>`
    )).join("");
    select.value = selectedDoctorId;
  });
}

function renderDateTabs() {
  const wrap = document.getElementById("dateTabs");
  wrap.innerHTML = "";
  for (let index = 0; index < 7; index += 1) {
    const value = dateOffset(index);
    const button = document.createElement("button");
    button.className = `date-tab ${value === selectedDate ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `${index === 0 ? "今天" : weekday(value)}<br><small>${value.slice(5)}</small>`;
    button.addEventListener("click", () => {
      selectedDate = value;
      renderDateTabs();
      renderToday();
    });
    wrap.appendChild(button);
  }
}

function renderToday() {
  const posts = state.posts
    .filter(post => post.doctorId === selectedDoctorId && post.scheduledDate === selectedDate)
    .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  const done = posts.filter(post => post.status === "已发布").length;

  document.getElementById("todayCount").textContent = posts.length;
  document.getElementById("doneCount").textContent = done;
  document.getElementById("pendingCount").textContent = posts.length - done;

  const wrap = document.getElementById("todayTasks");
  if (!posts.length) {
    wrap.innerHTML = `<div class="empty">这一天还没有任务。运营可以到“生成文案”或“排期日历”创建内容。</div>`;
    return;
  }
  wrap.innerHTML = posts.map(post => taskCard(post)).join("");
  bindPostButtons(wrap);
}

function taskCard(post) {
  const doctor = getDoctor(post.doctorId);
  const assets = post.assetIds.map(getAsset).filter(Boolean);
  const asset = assets[0];
  const warnings = post.warnings?.length ? post.warnings : getWarnings(post.copy, doctor);
  return `
    <article class="task-card" data-post-id="${escapeAttr(post.id)}">
      <div class="media-preview">${mediaHtml(asset)}</div>
      <div class="task-body">
        <div class="task-meta">
          <span class="chip strong">${escapeHtml(post.timeSlot)}</span>
          <span class="chip">${escapeHtml(doctor?.name || "未绑定医生")}</span>
          <span class="chip">${escapeHtml(post.goal)}</span>
          <span class="chip">${escapeHtml(post.customerStage)}</span>
          <span class="chip ${post.aiProvider === "openai" ? "strong" : ""}">${escapeHtml(aiLabel(post))}</span>
          <span class="chip ${post.status === "已发布" ? "strong" : ""}">${escapeHtml(post.status)}</span>
        </div>
        ${warnings.length ? `<div class="chip-row">${warnings.map(word => `<span class="chip warn">合规提示：${escapeHtml(word)}</span>`).join("")}</div>` : ""}
        ${post.aiError ? `<div class="chip-row"><span class="chip warn">AI 提示：${escapeHtml(post.aiError)}</span></div>` : ""}
        <div class="copy-box">${escapeHtml(post.copy)}</div>
        <div class="mobile-publish-tip">手机发布：先点“复制文案”，再点“保存素材”，打开微信朋友圈粘贴发布。</div>
        <div class="asset-meta">
          ${assets.map(item => `<span class="chip">${escapeHtml(item.name)}</span>`).join("")}
        </div>
        <div class="task-actions">
          <button class="primary-button" data-action="copy">复制朋友圈文案</button>
          <button class="ghost-button" data-action="download">保存素材到手机</button>
          <button class="quiet-button" data-action="edit">编辑文案</button>
          ${post.status === "已发布" ? "" : `<button class="danger-button" data-action="publish">标记已发布</button>`}
        </div>
      </div>
    </article>
  `;
}

function aiLabel(post) {
  if (post.aiProvider && !["local", "local-fallback", "chatgpt-manual"].includes(post.aiProvider)) return post.aiModel || post.aiProvider;
  if (post.aiProvider === "chatgpt-manual") return "ChatGPT 手动";
  if (post.aiProvider === "local-fallback") return "本地备用";
  return "本地生成";
}

function bindPostButtons(scope) {
  scope.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", async event => {
      const card = event.target.closest("[data-post-id]");
      const post = state.posts.find(item => item.id === card.dataset.postId);
      if (!post) return;
      const action = event.target.dataset.action;
      if (action === "copy") return copyText(post.copy);
      if (action === "download") return downloadAssets(post);
      if (action === "publish") {
        await api.publish(post.id);
        toast("已标记发布完成");
        await load();
      }
      if (action === "edit") {
        await editPost(post);
      }
    });
  });
}

async function editPost(post) {
  const next = window.prompt("编辑朋友圈文案", post.copy);
  if (next === null) return;
  await api.updatePost(post.id, { copy: next });
  toast("文案已更新");
  await load();
}

function renderAssetPicker() {
  const wrap = document.getElementById("assetPicker");
  const assets = state.assets.filter(asset => !selectedDoctorId || asset.doctorId === selectedDoctorId || !asset.doctorId);
  if (!assets.length) {
    wrap.innerHTML = `<div class="empty">暂无可选素材。</div>`;
    return;
  }
  wrap.innerHTML = assets.map(asset => `
    <label class="pick-item">
      <input type="checkbox" value="${escapeAttr(asset.id)}" />
      <span>
        ${escapeHtml(asset.name)}
        <small>${escapeHtml(asset.category)} · ${escapeHtml(asset.project || "未标注项目")}</small>
      </span>
    </label>
  `).join("");
}

function renderLatestGenerated() {
  const wrap = document.getElementById("latestGenerated");
  const post = state.posts.find(item => item.id === latestPostId) || state.posts[0];
  if (!post) {
    wrap.className = "generated-empty";
    wrap.textContent = "还没有生成新内容。";
    return;
  }
  wrap.className = "";
  wrap.innerHTML = taskCard(post);
  bindPostButtons(wrap);
}

function renderAssets() {
  const query = document.getElementById("assetSearch").value.trim().toLowerCase();
  const assets = state.assets.filter(asset => {
    const text = [asset.name, asset.category, asset.project, asset.notes].join(" ").toLowerCase();
    return !query || text.includes(query);
  });
  const wrap = document.getElementById("assetGrid");
  if (!assets.length) {
    wrap.innerHTML = `<div class="empty">没有匹配的素材。</div>`;
    return;
  }
  wrap.innerHTML = assets.map(asset => {
    const doctor = getDoctor(asset.doctorId);
    return `
      <article class="asset-card">
        <div class="asset-thumb">${mediaHtml(asset)}</div>
        <div class="asset-info">
          <h4>${escapeHtml(asset.name)}</h4>
          <div class="chip-row">
            <span class="chip strong">${escapeHtml(asset.category)}</span>
            <span class="chip">${escapeHtml(doctor?.name || "通用素材")}</span>
          </div>
          <p>${escapeHtml(asset.notes || "暂无说明")}</p>
          <div class="card-actions">
            <a class="ghost-button" href="${escapeAttr(asset.url)}" download="${escapeAttr(asset.name)}">下载</a>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderDoctors() {
  const wrap = document.getElementById("doctorList");
  wrap.innerHTML = state.doctors.map(doctor => `
    <article class="doctor-card">
      <div>
        <h4>${escapeHtml(doctor.name)} · ${escapeHtml(doctor.department)}</h4>
        <p>${escapeHtml(doctor.city)} · ${escapeHtml(doctor.projects || "未填写项目")}</p>
      </div>
      <p>${escapeHtml(doctor.persona || "暂无人设描述")}</p>
      <div class="chip-row">
        <span class="chip strong">${escapeHtml(doctor.style)}</span>
        ${(doctor.tags || []).map(tag => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}
      </div>
      ${doctor.banned ? `<p>禁用表达：${escapeHtml(doctor.banned)}</p>` : ""}
    </article>
  `).join("");
}

function renderCalendar() {
  const wrap = document.getElementById("calendar");
  const days = Array.from({ length: 14 }, (_, index) => dateOffset(index));
  wrap.innerHTML = days.map(day => {
    const posts = state.posts
      .filter(post => post.doctorId === selectedDoctorId && post.scheduledDate === day)
      .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
    return `
      <section class="calendar-day">
        <h4>${day} · ${weekday(day)}</h4>
        ${posts.length ? posts.map(post => {
          const asset = post.assetIds.map(getAsset).filter(Boolean)[0];
          return `
            <div class="calendar-post">
              <strong>${escapeHtml(post.timeSlot)} ${escapeHtml(post.goal)} · ${escapeHtml(post.status)}</strong>
              <span class="chip">${escapeHtml(asset?.category || "无素材")}</span>
              <p>${escapeHtml(post.copy)}</p>
            </div>
          `;
        }).join("") : `<div class="empty">暂无排期</div>`}
      </section>
    `;
  }).join("");
}

function mediaHtml(asset) {
  if (!asset) return `<span class="chip">无素材</span>`;
  if (asset.type === "video") {
    return `<video src="${escapeAttr(asset.url)}" muted controls playsinline></video>`;
  }
  return `<img src="${escapeAttr(asset.url)}" alt="${escapeAttr(asset.name)}" />`;
}

function getDoctor(id) {
  return state.doctors.find(doctor => doctor.id === id);
}

function getAsset(id) {
  return state.assets.find(asset => asset.id === id);
}

function getWarnings(copy, doctor) {
  const words = new Set([...(state.settings.complianceWords || [])]);
  String(doctor?.banned || "")
    .split(/[、,，\s]+/)
    .filter(Boolean)
    .forEach(word => words.add(word));
  return [...words].filter(word => copy.includes(word));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  toast("文案已复制");
}

function downloadAssets(post) {
  const assets = post.assetIds.map(getAsset).filter(Boolean);
  if (!assets.length) return toast("这条任务没有素材");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  if (isMobile && assets.length === 1) {
    window.open(assets[0].url, "_blank", "noopener");
    toast("已打开素材，长按可保存到手机");
    return;
  }
  assets.forEach((asset, index) => {
    window.setTimeout(() => {
      const link = document.createElement("a");
      link.href = asset.url;
      link.download = asset.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, index * 220);
  });
  toast(isMobile ? "已打开下载；如未保存，可长按素材" : "已开始下载素材");
}

function toast(message) {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => box.classList.remove("show"), 2200);
}

function today() {
  return formatLocalDate(new Date());
}

function dateOffset(offset) {
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

function weekday(value) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${value}T00:00:00`).getDay()];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
