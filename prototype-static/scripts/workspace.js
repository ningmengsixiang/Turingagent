/* ============================================================
   Turing Agent 原型 · 主工作台交互（极简白）
   混合群聊 / 静默策略 / 确认卡片审批 / 面板联动 / 弹层 / 快捷键
   状态跨页共享：TaStore（审批流 / 任务 / 项目 / 设置）
   ============================================================ */
"use strict";

/* ---------------- 图标 ---------------- */

const ICONS = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  quote: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 6H3M21 12H8M17 18H3"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  more: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
};

/* ---------------- 会话注册表 ---------------- */

/* 动态会话：项目群（内置 + 用户新建）与联系人私聊 */
const dynamicChats = new Map();
let currentChat = null;
let pendingQuote = null; /* { who, text } */
let sidebarView = "chats";
let muted = new Set(); /* 被静音的会话（演示会话级设置） */
let userFiles = []; /* 用户发送的文件（并入交付物面板） */
let fileFilter = "all"; /* 交付物筛选：all | img | doc */
let docEditIdx = null; /* 正在编辑的记忆文档下标 */

/* 由消息序列推导会话摘要（侧边栏 row2 用） */
function lastFrom(messages) {
  const lastMsg = [...messages].reverse().find((m) => m.type !== "system");
  if (!lastMsg) return "";
  const who = lastMsg.type === "self" ? "我" : lastMsg.who;
  return `${who}：${lastMsg.text.replace(/\n/g, " ")}`;
}

function dmChatFor(contact) {
  const id = `dm-${contact.name}`;
  if (dynamicChats.has(id)) return dynamicChats.get(id);
  const chat = {
    id,
    title: contact.name,
    kind: "dm",
    avatar: { label: contact.label, agent: false },
    sub: contact.role,
    last: lastFrom(contact.dm),
    time: "刚刚",
    unread: 0,
    badgeCls: "",
    presence: contact.presence,
    responder: {
      label: contact.name,
      avatar: contact.label,
      agent: false,
      reply: contact.reply || "收到。",
    },
    stack: [{ label: contact.label, agent: false }],
    messages: contact.dm,
  };
  dynamicChats.set(id, chat);
  return chat;
}

function projectChatFor(name) {
  if (dynamicChats.has(name)) return dynamicChats.get(name);
  const seed = PROJECT_CHATS[name];
  const messages = seed ? seed.messages : [
    { type: "system", text: "项目群创建 · 智能体团队已接入" },
    { type: "agent", who: "Ta-PM", avatar: "PM", text: "大家好，我是 Ta-PM。请描述项目目标，我会发起需求澄清。", time: "刚刚" },
  ];
  const chat = {
    id: `proj-${name}`,
    title: name,
    kind: "group",
    avatar: { label: name[0], agent: false },
    sub: seed ? seed.sub : "项目群 · 智能体团队已接入",
    last: lastFrom(messages),
    time: "昨天",
    unread: 0,
    badgeCls: "",
    responder: seed ? seed.responder : { label: "Ta-PM", avatar: "PM", reply: "收到，已记录。" },
    stack: seed ? seed.stack : [{ label: "PM", agent: true }],
    messages,
  };
  dynamicChats.set(name, chat);
  return chat;
}

/* 消息侧会话列表 = 内置群聊 + 私聊 + 用户新建项目群 */
function chatList() {
  const dm = [...dynamicChats.values()].filter((c) => c.kind === "dm");
  const custom = TaStore.getProjects().map((p) => projectChatFor(p.name));
  return [...dm, ...CHATS, ...custom];
}

/* ---------------- 工具 ---------------- */

function avatarHtml(a, extraCls = "") {
  return `<span class="avatar ${a.agent ? "agent" : ""} ${a.cls || ""} ${extraCls}">${a.label}</span>`;
}

function scrollToBottom() {
  const sc = $("#threadScroll");
  requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight));
}

/* ---------------- 侧边栏渲染 ---------------- */

function renderSidebar(view) {
  sidebarView = view;
  const list = $("#sidebarList");
  $$(".sidebar-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === view)));

  if (view === "chats") {
    const q = $("#globalSearch").value.trim().toLowerCase();
    const chats = q
      ? chatList().filter((c) => c.title.toLowerCase().includes(q) || (c.last || "").toLowerCase().includes(q))
      : chatList();
    list.innerHTML = chats.length
      ? chats.map(chatItemHtml).join("")
      : `<div class="sidebar-section-label">未找到「${esc(q)}」相关会话</div>`;
    return;
  }
  if (view === "projects") {
    const projects = [...PROJECTS, ...TaStore.getProjects().map((p) => ({ name: p.name, status: "进行中", chip: "chip-green", chat: p.name }))];
    list.innerHTML =
      projects
        .map(
          (p) => `
      <button class="sidebar-item ${p.name === "报销系统" && currentChat && currentChat.id === "reimburse" ? "active" : ""}" data-project="${esc(p.name)}">
        <span class="avatar">${esc(p.name[0])}</span>
        <span class="meta"><span class="row1">${esc(p.name)}</span><span class="row2">${esc(p.status)}</span></span>
        <span class="status-tag chip ${p.chip}">${esc(p.status)}</span>
      </button>`
        )
        .join("") +
      `<button class="sidebar-item new-btn" data-action="new-project">
        <span class="avatar" style="background:var(--accent);color:var(--on-accent)">＋</span>
        <span class="meta"><span class="row1">新建项目群</span></span>
      </button>`;
    return;
  }
  if (view === "contacts") {
    list.innerHTML =
      `<div class="sidebar-section-label">成员</div>` +
      CONTACTS.map(
        (c) => `
      <button class="sidebar-item" data-contact="${esc(c.name)}">
        <span class="avatar"><i class="presence ${c.presence}"></i>${c.label}</span>
        <span class="meta"><span class="row1">${esc(c.name)}</span><span class="row2">${esc(c.role)}</span></span>
      </button>`
      ).join("");
    return;
  }
  if (view === "agents") {
    list.innerHTML = AGENTS.map(
      (g) =>
        `<div class="sidebar-section-label">${g.section}</div>` +
        g.items
          .map(
            (a) => `
        <button class="sidebar-item agent-row" data-agent="${esc(a.name)}">
          <span class="avatar agent">${a.label}</span>
          <span class="meta"><span class="row1">${esc(a.name)}</span><span class="row2">${esc(a.role)}</span></span>
          <span class="status-tag mono" style="font-size:10px;color:var(--ink-3)">● 在线</span>
        </button>`
          )
          .join("")
    ).join("");
  }
}

function chatItemHtml(c) {
  const badge =
    c.unread > 0
      ? `<span class="badge ${c.badgeCls}">${c.unread}</span>`
      : c.kind === "agent"
        ? `<span class="chip chip-ai">AI</span>`
        : "";
  const icon = muted.has(c.id) ? '<span style="font-size:10px;color:var(--ink-faint)">🔕</span>' : "";
  return `
    <button class="sidebar-item ${c.id === currentChat.id ? "active" : ""} ${c.kind === "agent" ? "agent-row" : ""}" data-chat="${esc(c.id)}">
      ${avatarHtml(c.avatar)}
      <span class="meta">
        <span class="row1"><span class="truncate">${esc(c.title)}</span>${badge}</span>
        <span class="row2 truncate">${icon}${esc(c.last)}</span>
      </span>
      <span class="time">${c.time}</span>
    </button>`;
}

/* ---------------- 消息渲染 ---------------- */

function renderThread(chat) {
  currentChat = chat;
  chat.unread = 0;

  const mutedIcon = muted.has(chat.id)
    ? `<span class="quiet-badge">🔕 已静音</span>`
    : chat.silent
      ? `<span class="quiet-badge">智能体静默中</span>`
      : "";
  $("#threadHeader").innerHTML = `
    <div class="thread-title">
      <h1>${esc(chat.title)}</h1>
      <div class="sub">
        <span class="member-stack">
          ${chat.stack.map((a) => avatarHtml(a)).join("")}
        </span>
        ${esc(chat.sub)}
      </div>
    </div>
    ${mutedIcon}
    <div style="position:relative">
      <button class="icon-btn" data-head="search" aria-label="搜索群内消息" title="搜索群内消息（Ctrl+F）">${ICONS.search}</button>
      <button class="icon-btn" data-head="more" aria-label="更多操作" title="更多">${ICONS.more}</button>
      <div class="popover" id="threadMenu" hidden>
        <button class="pop-item" data-menu="search">搜索群内消息 <kbd>Ctrl F</kbd></button>
        <button class="pop-item" data-menu="approvals">查看审批流</button>
        ${chat.id === "pmo" ? '<button class="pop-item" data-menu="report">生成今日日报</button>' : ""}
        <button class="pop-item" data-menu="mute">${muted.has(chat.id) ? "取消静音通知" : "静音通知"}</button>
        <button class="pop-item" data-menu="read">标记全部已读</button>
      </div>
    </div>`;

  /* 卡片状态由 ApprovalEngine 在 cardHtml 中推导（同一状态的两个渲染） */
  const scroll = $("#threadScroll");
  scroll.innerHTML = chat.messages.map((m) => messageHtml(m)).join("");

  /* 正在输入指示器（静默群/无响应者时不显示） */
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.id = "typing";
  typing.innerHTML = `<span class="label">${chat.responder ? `${esc(chat.responder.label)} 正在输入` : ""}</span><span class="dots"><i></i><i></i><i></i></span>`;
  scroll.appendChild(typing);

  $("#composerInput").placeholder = `发消息给 ${chat.title}…（Ctrl+Enter 发送）`;
  $("#composerAgentChip").textContent = chat.silent ? "智能体静默" : chat.responder ? `${chat.responder.label} 在线` : "仅群成员";
  clearQuote();
  scrollToBottom();
}

function messageHtml(m) {
  if (m.type === "system") return `<div class="msg system"><div class="sys">${esc(m.text)}</div></div>`;
  if (m.type === "self")
    return `
    <div class="msg self">
      <span class="avatar">${SELF.label}</span>
      <div class="body">
        <div class="who">张敏 <span class="time">${m.time}</span></div>
        ${m.quote ? `<div class="quote-block"><div class="q-who">引用 ${esc(m.quote.who)}</div>${esc(m.quote.text)}</div>` : ""}
        ${m.img ? `<div class="bubble bubble-img"><img class="msg-img" src="${m.img}" alt="图片消息" /></div>` : `<div class="bubble">${esc(m.text)}</div>`}
        ${m.attach ? attachHtml(m.attach) : ""}
      </div>
    </div>`;
  if (m.type === "human")
    return `
    <div class="msg human">
      ${avatarHtml(m.avatar)}
      <div class="body">
        <div class="who">${esc(m.who)} <span class="role">${esc(m.role)}</span> <span class="time">${m.time}</span></div>
        <div class="bubble">${esc(m.text)}</div>
      </div>
      <div class="actions" aria-label="消息操作">
        <button class="icon-btn" data-action="copy" title="复制">${ICONS.copy}</button>
        <button class="icon-btn" data-action="quote" title="引用">${ICONS.quote}</button>
      </div>
    </div>`;
  if (m.type === "agent" || m.type === "card") {
    return `
    <div class="msg agent">
      <span class="avatar agent">${m.avatar}</span>
      <div class="body">
        <div class="who">${esc(m.who)} <span class="ai-mark">AI</span> <span class="time">${m.time}</span></div>
        ${m.text ? `<div class="bubble">${esc(m.text).replace(/\n/g, "<br>")}</div>` : ""}
        ${m.card ? cardHtml(m.card) : ""}
      </div>
      <div class="actions" aria-label="消息操作">
        <button class="icon-btn" data-action="copy" title="复制">${ICONS.copy}</button>
        <button class="icon-btn" data-action="quote" title="引用">${ICONS.quote}</button>
      </div>
    </div>`;
  }
  return "";
}

function attachHtml(a) {
  return `
    <div class="attach">
      <span class="file-icon">${ICONS.file}</span>
      <div><div class="file-name">${esc(a.name)}</div><div class="file-meta">${esc(a.size)}</div></div>
    </div>`;
}

/* ---------------- 确认卡片（渲染与决策在 cards.js，此处仅保留联动函数） ---------------- */

function syncPanelDesign(state) {
  const chipEl = $("#designChip");
  const barEl = $("#designBar");
  const wrap = $("#designBarWrap");
  if (state === "approved") {
    chipEl.className = "chip chip-green";
    chipEl.textContent = "已完成";
    barEl.style.width = "100%";
    wrap.className = "bar bar-green";
  } else if (state === "rejected") {
    chipEl.className = "chip chip-red";
    chipEl.textContent = "已驳回";
    wrap.className = "bar bar-red";
  } else {
    chipEl.className = "chip chip-amber";
    chipEl.textContent = "已退回";
    wrap.className = "bar bar-amber";
  }
}

function syncBoardApproval(approvalId, state, comment) {
  const tasks = TaStore.getTasks() ?? SEED_TASKS;
  const next = tasks.map((t) =>
    t.approvalId === approvalId
      ? {
          ...t,
          col: state === "approved" ? "done" : "todo",
          doneAt: state === "approved" ? "今天" : undefined,
          blockedReason: state === "rejected" ? `审批驳回：${comment || "未填写原因"}` : undefined,
        }
      : t
  );
  TaStore.setTasks(next);
}

function appendSystemMessage(text) {
  const typing = $("#typing");
  const div = document.createElement("div");
  div.className = "msg system";
  div.innerHTML = `<div class="sys">${esc(text)}</div>`;
  typing.before(div);
  scrollToBottom();
}

/* ---------------- 输入框与智能体响应 ---------------- */

function sendComposer() {
  const input = $("#composerInput");
  const text = input.value.trim();
  if (!text && !pendingQuote) return;
  input.value = "";
  input.style.height = "auto";

  /* @分配任务（FR-TASK-01）：@执行者 负责XX → 看板联动 */
  const assigned = parseAssignment(text);
  if (assigned) {
    createTaskFromAssignment(assigned);
    clearQuote();
    return;
  }

  const div = document.createElement("div");
  div.className = "msg self";
  div.innerHTML = `
    <span class="avatar">${SELF.label}</span>
    <div class="body">
      <div class="who">张敏 <span class="time">${now()}</span></div>
      ${pendingQuote ? `<div class="quote-block"><div class="q-who">引用 ${esc(pendingQuote.who)}</div>${esc(pendingQuote.text)}</div>` : ""}
      <div class="bubble">${esc(text || "（引用消息）")}</div>
    </div>`;
  $("#typing").before(div);
  clearQuote();
  currentChat.last = `我：${text || "（引用消息）"}`;
  currentChat.time = now();
  renderSidebar(sidebarView);
  scrollToBottom();

  /* 静默策略：智能体不插话 */
  if (currentChat.silent) {
    setTimeout(() => {
      appendSystemMessage("智能体保持静默（闲聊未触发响应规则）");
    }, 700);
    return;
  }
  if (!currentChat.responder) return;

  const r = currentChat.responder;
  const typing = $("#typing");
  typing.classList.add("on");
  scrollToBottom();
  setTimeout(() => {
    typing.classList.remove("on");
    const reply = document.createElement("div");
    reply.className = `msg ${r.agent === false ? "human" : "agent"}`;
    reply.innerHTML = `
      <span class="avatar ${r.agent === false ? "" : "agent"}">${r.avatar}</span>
      <div class="body">
        <div class="who">${esc(r.label)} ${r.agent === false ? `<span class="role">${esc(currentChat.sub)}</span>` : '<span class="ai-mark">AI</span>'} <span class="time">${now()}</span></div>
        <div class="bubble">${esc(r.reply)}</div>
      </div>`;
    typing.before(reply);
    scrollToBottom();
    /* 页面失焦时发系统通知（FR-DESK-03） */
    if (!document.hasFocus()) notify(`${r.label} 回复了你`, r.reply.slice(0, 60));
  }, 1100);
}

/* 解析「@执行者 负责/做/完成 任务名」 */
function parseAssignment(text) {
  if (!text) return null;
  const m = text.match(/@(Ta-[A-Za-z\/]+|[一-龥]{2,3})\s*(?:负责|做|完成)\s*([\s\S]+)/);
  if (!m) return null;
  const key = ASSIGNEE_ALIAS[m[1]];
  if (!key) return null;
  return { alias: m[1], assignee: key, title: m[2].trim() };
}

/* 创建任务并联动看板 + Ta-PMO 回报 */
function createTaskFromAssignment({ alias, assignee, title }) {
  const tasks = tasksData();
  const task = {
    id: `T-${String(tasks.length + 101)}`,
    title,
    type: assignee.includes("AI") ? "ai" : "human",
    assignee,
    prio: "P1",
    col: "todo",
    due: "",
    mine: assignee === "张敏 · 财务",
  };
  TaStore.setTasks([...tasks, task]);
  TaStore.addAudit({ type: "task", action: "任务分配", target: `任务「${title}」→ ${assignee}（群内 @分配）`, actor: SELF.who });

  const div = document.createElement("div");
  div.className = "msg self";
  div.innerHTML = `
    <span class="avatar">${SELF.label}</span>
    <div class="body">
      <div class="who">张敏 <span class="time">${now()}</span></div>
      <div class="bubble">@${esc(alias)} 负责 ${esc(title)}</div>
    </div>`;
  $("#typing").before(div);
  currentChat.last = `我：@${alias} 负责 ${title}`;
  currentChat.time = now();
  appendSystemMessage(`已创建任务「${title}」并分配给 ${assignee}`);
  const pm = document.createElement("div");
  pm.className = "msg agent";
  pm.innerHTML = `
    <span class="avatar agent">PMO</span>
    <div class="body">
      <div class="who">Ta-PMO <span class="ai-mark">AI</span> <span class="time">${now()}</span></div>
      <div class="bubble">已更新任务看板：「${esc(title)}」【${esc(assignee)} 待开始】。点击右侧面板可查看。</div>
    </div>`;
  $("#typing").before(pm);
  renderMiniBoard();
  if (typeof renderTodoPanel === "function") renderTodoPanel();
  renderSidebar(sidebarView);
  scrollToBottom();
  toast(`任务「${title}」已分配`, "✓");
}

/* 发送文件/图片（拖拽、选择、粘贴共用） */
function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  list.forEach((f) => {
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const div = document.createElement("div");
        div.className = "msg self";
        div.innerHTML = `
          <span class="avatar">${SELF.label}</span>
          <div class="body">
            <div class="who">张敏 <span class="time">${now()}</span></div>
            <div class="bubble bubble-img"><img class="msg-img" src="${reader.result}" alt="${esc(f.name)}" /><div class="img-name">${esc(f.name)}</div></div>
          </div>`;
        $("#typing").before(div);
        scrollToBottom();
      };
      reader.readAsDataURL(f);
      userFiles.push({ name: f.name, size: fmtSize(f.size), by: "张敏", time: now(), kind: "img" });
    } else {
      const div = document.createElement("div");
      div.className = "msg self";
      div.innerHTML = `
        <span class="avatar">${SELF.label}</span>
        <div class="body">
          <div class="who">张敏 <span class="time">${now()}</span></div>
          ${attachHtml({ name: f.name, size: fmtSize(f.size) })}
        </div>`;
      $("#typing").before(div);
      userFiles.push({ name: f.name, size: fmtSize(f.size), by: "张敏", time: now(), kind: "doc" });
    }
  });
  scrollToBottom();
  currentChat.last = `我：[${list.length} 个文件]`;
  currentChat.time = now();
  renderSidebar(sidebarView);
  renderFiles();
  toast(list.length > 1 ? `已发送 ${list.length} 个文件` : `已发送 ${list[0].name}`, "📎");
}

function setQuote(who, text) {
  pendingQuote = { who, text };
  const tools = $(".composer-tools");
  let bar = $("#quoteBar");
  if (!bar) {
    bar = document.createElement("button");
    bar.id = "quoteBar";
    bar.className = "chip chip-black";
    tools.prepend(bar);
  }
  bar.innerHTML = `引用 ${esc(who)} ✕`;
  bar.title = "点击取消引用";
}

function clearQuote() {
  pendingQuote = null;
  const bar = $("#quoteBar");
  if (bar) bar.remove();
}

/* —— 语音输入：录音 2.5 秒后自动转为文字 —— */
let micTimer = null;
function toggleMic(btn) {
  if (btn.classList.contains("recording")) {
    clearTimeout(micTimer);
    btn.classList.remove("recording");
    btn.title = "语音输入";
    const div = document.createElement("div");
    div.className = "msg self";
    div.innerHTML = `
      <span class="avatar">${SELF.label}</span>
      <div class="body">
        <div class="who">张敏 <span class="time">${now()}</span></div>
        <div class="bubble">🎤 语音转文字：发票拍照上传，走企业微信的入口可以吧？</div>
      </div>`;
    $("#typing").before(div);
    scrollToBottom();
    toast("语音已转为文字");
  } else {
    btn.classList.add("recording");
    btn.title = "录音中，再次点击结束";
    micTimer = setTimeout(() => toggleMic(btn), 2500);
  }
}

/* ---------------- 右侧面板 ---------------- */

function tasksData() {
  return TaStore.getTasks() ?? SEED_TASKS;
}

function renderMiniBoard() {
  const tasks = tasksData();
  const cols = [
    { id: "todo", label: "待开始" },
    { id: "doing", label: "进行中" },
    { id: "approval", label: "待审批" },
  ];
  $("#miniBoard").innerHTML = cols
    .map((col) => {
      const items = tasks.filter((t) => t.col === col.id);
      return `
      <div class="mini-col">
        <div class="col-head">${col.label} <span class="n">${items.length}</span></div>
        ${items
          .slice(0, 4)
          .map((t) => {
            const av = ASSIGNEE_AV[t.assignee];
            return `
          <button class="mini-card" data-task="${t.id}" title="点击前往完整看板">
            <div class="t">${esc(t.title)}</div>
            <div class="f"><span class="tag ${t.type === "ai" ? "ai" : "human"}">${av ? av.label : "?"}</span><span class="prio p${t.prio[1]}"></span></div>
          </button>`;
          })
          .join("")}
      </div>`;
    })
    .join("");
}

function renderMemory() {
  $("#memoryView").innerHTML = DOCS.map(
    (d, i) => `
    <button class="doc-item" data-doc="${i}">
      <span class="icon">${ICONS.doc}</span>
      <div class="meta"><div class="name">${esc(d.name)}</div><div class="sub">${esc(d.version)}</div></div>
      <span class="chip ${d.chip}">${esc(d.chipText)}</span>
    </button>`
  ).join("");
}

function renderFiles() {
  const all = [...userFiles, ...FILES];
  const filtered = fileFilter === "all" ? all : all.filter((f) => f.kind === fileFilter);
  const chip = (id, label) => `<button class="files-chip ${fileFilter === id ? "active" : ""}" data-filefilter="${id}">${label}</button>`;
  $("#filesView").innerHTML = `
    <div class="files-filter" role="group" aria-label="交付物筛选">
      ${chip("all", "全部")}${chip("img", "图片")}${chip("doc", "文档")}
      <span class="files-count mono">${filtered.length} 项</span>
    </div>
    ${filtered
      .map(
        (f) => `
    <div class="file-item">
      <span class="icon">${f.kind === "img" ? ICONS.file : ICONS.doc}</span>
      <div class="meta"><div class="name">${esc(f.name)}</div><div class="sub">${esc(f.size)} · ${esc(f.by)} · ${esc(f.time)}</div></div>
      <button class="icon-btn" data-file="${esc(f.name)}" aria-label="下载 ${esc(f.name)}" title="下载">${ICONS.download}</button>
    </div>`
      )
      .join("")}`;
}

/* —— 记忆文档：人工编辑 + 版本历史（FR-MEM-02） —— */
function docView(index) {
  const base = DOCS[index];
  const ov = TaStore.getDocOverrides()[index];
  const baseV = parseInt(base.version.match(/v(\d+)/)?.[1] || "1", 10);
  const versions = ov
    ? [{ v: baseV, editor: "智能体", time: base.version.replace(/^v\d+ · /, ""), body: base.body }, ...ov.versions]
    : [{ v: baseV, editor: "智能体", time: base.version.replace(/^v\d+ · /, ""), body: base.body }];
  const latest = versions[versions.length - 1];
  return { base, versions, latest, override: Boolean(ov) };
}

function renderMemory() {
  $("#memoryView").innerHTML = DOCS.map((d, i) => {
    const { latest, override } = docView(i);
    return `
    <button class="doc-item" data-doc="${i}">
      <span class="icon">${ICONS.doc}</span>
      <div class="meta"><div class="name">${esc(d.name)}</div><div class="sub">v${latest.v} · ${override ? `张敏 编辑 · ${latest.time}` : esc(d.version)}</div></div>
      <span class="chip ${override ? "chip-amber" : d.chip}">${override ? "已编辑" : esc(d.chipText)}</span>
    </button>`;
  }).join("");
}

function openDoc(index) {
  const { latest, versions, base } = docView(index);
  docEditIdx = index;
  $("#docTitle").textContent = base.name;
  $("#docMeta").textContent = `v${latest.v} · ${latest.editor} · ${latest.time} · 由智能体团队维护`;
  $("#docBody").textContent = latest.body;
  $("#docBody").hidden = false;
  $("#docEditArea").hidden = true;
  $("#docEditActions").hidden = true;
  $("#editDoc").textContent = "编辑";
  $("#docVersions").innerHTML = `
    <div class="doc-versions-head">版本历史</div>
    ${versions
      .slice()
      .reverse()
      .map(
        (v) => `
      <div class="doc-version"><span class="v-tag mono">v${v.v}</span><span class="v-meta">${esc(v.editor)} · ${esc(v.time)}</span></div>`
      )
      .join("")}`;
  $("#docModal").hidden = false;
}

function startDocEdit() {
  const { latest } = docView(docEditIdx);
  $("#docBody").hidden = true;
  $("#docEditArea").value = latest.body;
  $("#docEditArea").hidden = false;
  $("#docEditActions").hidden = false;
  $("#editDoc").textContent = "取消编辑";
  $("#editDoc").dataset.editing = "1";
}

function cancelDocEdit() {
  $("#docBody").hidden = false;
  $("#docEditArea").hidden = true;
  $("#docEditActions").hidden = true;
  $("#editDoc").textContent = "编辑";
  delete $("#editDoc").dataset.editing;
}

function saveDocEdit() {
  const { base, versions } = docView(docEditIdx);
  const body = $("#docEditArea").value.trim();
  if (!body) {
    toast("内容不能为空", "⚠");
    return;
  }
  const nextV = versions[versions.length - 1].v + 1;
  const overrides = TaStore.getDocOverrides();
  const ov = overrides[docEditIdx] || { versions: [] };
  const next = {
    ...overrides,
    [docEditIdx]: { versions: [...ov.versions, { v: nextV, editor: "张敏", time: now(), body }] },
  };
  TaStore.setDocOverrides(next);
  TaStore.addAudit({ type: "system", action: "文档编辑", target: `记忆文档《${base.name}》保存 v${nextV}`, actor: SELF.who });
  toast(`已保存 v${nextV}（留痕可审计）`, "✓");
  cancelDocEdit();
  openDoc(docEditIdx);
  renderMemory();
}

/* ---------------- 弹层 ---------------- */

function closePopovers() {
  $$("#topbar .popover, #threadHeader .popover").forEach((p) => (p.hidden = true));
  closePickers();
}

function closePickers() {
  $("#emojiPicker").hidden = true;
  $("#mentionPicker").hidden = true;
}

function closeModals() {
  $$(".modal-overlay").forEach((m) => (m.hidden = true));
}

/* 项目切换菜单 */
function renderProjectMenu() {
  const projects = [...PROJECTS, ...TaStore.getProjects().map((p) => ({ name: p.name, chat: p.name }))];
  $("#projectMenuList").innerHTML = projects
    .map(
      (p) => `
      <button class="pop-item ${p.name === $("#currentProject").textContent ? "active" : ""}" data-project="${esc(p.name)}">
        ${esc(p.name)} ${p.name === $("#currentProject").textContent ? '<span class="check">✓</span>' : ""}
      </button>`
    )
    .join("");
}

/* 表情选择器 */
const EMOJIS = ["😀", "😂", "😊", "😉", "😍", "🤔", "👍", "👏", "🙏", "🤝", "🎉", "✅", "❌", "⚠️", "💡", "📎", "📊", "📝", "🗓️", "⏰", "🚀", "🏠", "☕", "❤️"];
function renderEmojiPicker() {
  $("#emojiGrid").innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("");
}

/* @提及选择器 */
function renderMentionPicker() {
  const agents = AGENTS.flatMap((g) => g.items);
  const contacts = CONTACTS;
  $("#mentionList").innerHTML = [
    `<div class="p-head" style="padding-top:6px">智能体</div>`,
    ...agents.map(
      (a) => `
      <button class="mention-item" data-mention="${esc(a.name)}">
        <span class="avatar agent" style="width:22px;height:22px;font-size:10px;border-radius:6px">${a.label}</span>
        <span><span class="m-name">${esc(a.name)}</span> <span class="m-role">${esc(a.role)}</span></span>
      </button>`
    ),
    `<div class="p-head">成员</div>`,
    ...contacts.map(
      (c) => `
      <button class="mention-item" data-mention="${esc(c.name)}">
        <span class="avatar" style="width:22px;height:22px;font-size:10px">${c.label}</span>
        <span><span class="m-name">${esc(c.name)}</span> <span class="m-role">${esc(c.role)}</span></span>
      </button>`
    ),
  ].join("");
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  /* —— 侧边栏 Tab —— */
  $$(".sidebar-tab").forEach((t) => t.addEventListener("click", () => renderSidebar(t.dataset.view)));

  /* —— 侧边栏点击 —— */
  $("#sidebarList").addEventListener("click", (e) => {
    const chatBtn = e.target.closest("[data-chat]");
    if (chatBtn) {
      const chat = chatList().find((c) => c.id === chatBtn.dataset.chat);
      if (chat) renderThread(chat);
      renderSidebar(sidebarView);
      return;
    }
    const contactBtn = e.target.closest("[data-contact]");
    if (contactBtn) {
      const contact = CONTACTS.find((c) => c.name === contactBtn.dataset.contact);
      if (contact) {
        renderThread(dmChatFor(contact));
        renderSidebar("chats");
      }
      return;
    }
    const projectBtn = e.target.closest("[data-project]");
    if (projectBtn) {
      renderThread(projectChatFor(projectBtn.dataset.project));
      renderSidebar("chats");
      return;
    }
    const agentBtn = e.target.closest("[data-agent]");
    if (agentBtn) {
      const input = $("#composerInput");
      input.value += `${agentBtn.dataset.agent} `;
      input.focus();
      renderSidebar("chats");
      toast(`已 @${agentBtn.dataset.agent}，发送后触发响应`);
      return;
    }
    if (e.target.closest('[data-action="new-project"]')) {
      openNewProject();
    }
  });

  /* —— 消息流：审批卡片 / 复制 / 引用 / 预览 —— */
  $("#threadScroll").addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      const cardEl = actionBtn.closest(".card");
      if (cardEl) {
        if (actionBtn.dataset.action === "approve") decideCard(cardEl, "approve");
        if (actionBtn.dataset.action === "reject") {
          const box = $(".card-comment-box", cardEl);
          if (box) {
            box.classList.add("open");
            box.querySelector("textarea").focus();
          }
        }
        if (actionBtn.dataset.action === "comment") {
          const box = $(".card-comment-box", cardEl);
          if (box) box.classList.add("open");
        }
        if (actionBtn.dataset.action === "submit-reject" || actionBtn.dataset.action === "submit-comment") {
          const box = $(".card-comment-box.open textarea", cardEl);
          decideCard(cardEl, actionBtn.dataset.action === "submit-reject" ? "reject" : "returned", box ? box.value.trim() : "");
        }
        if (actionBtn.dataset.action === "cancel-comment") {
          $(".card-comment-box", cardEl).classList.remove("open");
        }
        if (actionBtn.dataset.action === "transfer") {
          const from = actionBtn.dataset.from;
          const wrap = document.createElement("span");
          wrap.className = "transfer-candidates";
          wrap.innerHTML =
            TRANSFER_CANDIDATES.filter((c) => c !== from)
              .map((c) => `<button class="btn btn-sm btn-outline" data-action="transfer-to" data-from="${esc(from)}" data-to="${esc(c)}">${esc(c)}</button>`)
              .join("") + `<button class="btn btn-sm btn-ghost" data-action="transfer-cancel">取消</button>`;
          actionBtn.replaceWith(wrap);
          return;
        }
        if (actionBtn.dataset.action === "transfer-to") {
          const def = cardDefById(cardEl.dataset.approval);
          if (def) transferApprover(def, actionBtn.dataset.from, actionBtn.dataset.to);
          return;
        }
        if (actionBtn.dataset.action === "transfer-cancel") {
          renderThread(currentChat);
          return;
        }
        return;
      }
      if (actionBtn.dataset.action === "copy") {
        const bubble = $(".bubble", actionBtn.closest(".msg"));
        if (bubble) {
          /* file:// 下 clipboard 可能被拒，toast 先行反馈，写入尽力而为 */
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(bubble.innerText).catch(() => {});
          }
          toast("已复制到剪贴板", "⧉");
        }
        return;
      }
      if (actionBtn.dataset.action === "quote") {
        const msg = actionBtn.closest(".msg");
        const whoEl = $(".who", msg);
        const bubble = $(".bubble", msg);
        if (whoEl && bubble) {
          const who = whoEl.childNodes[0].textContent.trim();
          setQuote(who, bubble.innerText.slice(0, 80));
          toast(`已引用 ${who} 的消息，可直接发送`);
        }
        return;
      }
    }
    if (e.target.closest("[data-preview]")) {
      toast("预览原型（演示）", "🖼");
    }
  });

  /* —— 会话头部菜单 —— */
  $("#threadHeader").addEventListener("click", (e) => {
    const headBtn = e.target.closest("[data-head]");
    if (headBtn) {
      const menu = $("#threadMenu");
      if (headBtn.dataset.head === "search") {
        $("#globalSearch").focus();
        return;
      }
      menu.hidden = !menu.hidden;
      return;
    }
    const menuItem = e.target.closest("[data-menu]");
    if (menuItem) {
      $("#threadMenu").hidden = true;
      const action = menuItem.dataset.menu;
      if (action === "search") $("#globalSearch").focus();
      if (action === "approvals") {
        $$(".panel-tab").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.view === "board")));
        $$(".panel-view").forEach((v) => (v.hidden = v.dataset.view !== "board"));
        $("#appBody").classList.add("panel-open");
        toast("已打开审批流视图");
      }
      if (action === "report") {
        pushReport(true);
        toast("日报已生成并推送", "📊");
      }
      if (action === "mute") {
        if (muted.has(currentChat.id)) muted.delete(currentChat.id);
        else muted.add(currentChat.id);
        renderThread(currentChat);
        toast(muted.has(currentChat.id) ? "已静音该会话通知" : "已取消静音", "🔕");
      }
      if (action === "read") {
        chatList().forEach((c) => (c.unread = 0));
        renderSidebar("chats");
        toast("全部会话已标记已读");
      }
    }
  });

  /* —— 右侧面板 Tab —— */
  $$(".panel-tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".panel-tab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      $$(".panel-view").forEach((v) => (v.hidden = v.dataset.view !== t.dataset.view));
    })
  );

  /* —— 面板内容点击：记忆文档 / 交付物筛选与下载 / 迷你看板 —— */
  $("#memoryView").addEventListener("click", (e) => {
    const doc = e.target.closest("[data-doc]");
    if (doc) openDoc(Number(doc.dataset.doc));
  });
  $("#filesView").addEventListener("click", (e) => {
    const chipBtn = e.target.closest("[data-filefilter]");
    if (chipBtn) {
      fileFilter = chipBtn.dataset.filefilter;
      renderFiles();
      return;
    }
    const f = e.target.closest("[data-file]");
    if (f) toast(`正在下载 ${f.dataset.file}（演示）`, "↓");
  });
  $("#miniBoard").addEventListener("click", (e) => {
    if (e.target.closest("[data-task]")) location.href = "board.html";
  });

  /* —— 待办中心（FR-APP-04） —— */
  $("#todoBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    renderTodoPanel();
    const p = $("#todoPanel");
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $("#notifPanel").hidden = true;
      $("#projectMenu").hidden = true;
      $("#meMenu").hidden = true;
    }
  });
  $("#todoPanel").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-todo]");
    if (btn) {
      if (btn.dataset.todo === "approve-all") {
        pendingApprovals().forEach((a) => applyApprovalById(a.card.id, "approve"));
        $("#todoPanel").hidden = true;
        return;
      }
      if (btn.dataset.todo === "approve" || btn.dataset.todo === "reject") {
        applyApprovalById(btn.dataset.approval, btn.dataset.todo);
        return;
      }
    }
    const item = e.target.closest("[data-chat]");
    if (item && !e.target.closest("[data-todo]") && !e.target.closest("a")) {
      const chat = chatList().find((c) => c.id === item.dataset.chat);
      if (chat) {
        renderThread(chat);
        $("#todoPanel").hidden = true;
      }
    }
  });

  /* —— 通知中心 —— */
  $("#notifBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const p = $("#notifPanel");
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $("#projectMenu").hidden = true;
      $("#meMenu").hidden = true;
    }
  });
  $("#markRead").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#notifDot").style.display = "none";
    $("#notifPanel").hidden = true;
    toast("全部通知已读");
  });
  $("#notifPanel").addEventListener("click", (e) => {
    const item = e.target.closest("[data-chat]");
    if (item && !e.target.closest("#markRead")) {
      const chat = chatList().find((c) => c.id === item.dataset.chat);
      if (chat) renderThread(chat);
      $("#notifPanel").hidden = true;
    }
  });

  /* —— 项目切换 —— */
  $("#projectSwitcher").addEventListener("click", (e) => {
    e.stopPropagation();
    renderProjectMenu();
    const p = $("#projectMenu");
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $("#notifPanel").hidden = true;
      $("#meMenu").hidden = true;
    }
  });
  $("#projectMenu").addEventListener("click", (e) => {
    const item = e.target.closest("[data-project]");
    if (item) {
      $("#currentProject").textContent = item.dataset.project;
      $("#projectMenu").hidden = true;
      const chat = chatList().find((c) => c.id === item.dataset.project) || projectChatFor(item.dataset.project);
      renderThread(chat);
      renderSidebar("chats");
      return;
    }
    if (e.target.closest('[data-action="new-project"]')) {
      $("#projectMenu").hidden = true;
      openNewProject();
    }
  });

  /* —— 个人菜单（在线状态 / 退出） —— */
  $("#meBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("#meMenu");
    m.hidden = !m.hidden;
    if (!m.hidden) {
      $("#notifPanel").hidden = true;
      $("#projectMenu").hidden = true;
    }
  });
  $("#meMenu").addEventListener("click", (e) => {
    const opt = e.target.closest("[data-presence]");
    if (opt) {
      $$(".presence-opt", e.currentTarget).forEach((o) => o.classList.toggle("active", o === opt));
      $("#mePresence").className = `presence ${opt.dataset.presence === "on" ? "" : opt.dataset.presence}`;
      TaStore.setSettings({ presence: opt.dataset.presence });
      toast(`在线状态已切换为「${opt.textContent.trim()}」`);
      return;
    }
    if (e.target.closest('[data-action="logout"]')) {
      $("#meMenu").hidden = true;
      TaStore.addAudit({ type: "system", action: "退出登录", target: "张敏 · macOS 客户端", actor: SELF.who });
      TaStore.clearSession();
      location.href = "login.html";
    }
    if (e.target.closest('[data-action="org"]')) {
      $("#meMenu").hidden = true;
      location.href = "org.html";
    }
  });

  /* —— 设置弹窗 —— */
  $("#settingsBtn").addEventListener("click", () => {
    closePopovers();
    $("#settingsModal").hidden = false;
  });
  $("#closeSettings").addEventListener("click", () => {
    $("#settingsModal").hidden = true;
    toast("设置已保存");
  });
  $$("#settingsModal .switch").forEach((sw) =>
    sw.addEventListener("click", () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      TaStore.setSettings({ [sw.dataset.setting]: next });
    })
  );
  $("#notifyTime").addEventListener("change", (e) => {
    TaStore.setSettings({ notifyTime: e.target.value });
  });
  $("#resetDemo").addEventListener("click", () => {
    const session = TaStore.getSession();
    TaStore.reset();
    if (session) TaStore.setSession(session);
    location.reload();
  });

  /* —— 新建项目群 —— */
  $("#cancelProject").addEventListener("click", () => ($("#newProjectModal").hidden = true));
  $("#submitProject").addEventListener("click", () => {
    const name = $("#projectName").value.trim();
    if (!name) {
      toast("请输入项目名称", "⚠");
      return;
    }
    const team = $("#projectTeam").value;
    TaStore.setProjects([...TaStore.getProjects(), { name, team, time: now() }]);
    const chat = projectChatFor(name);
    if (team !== "none") {
      chat.messages = [
        { type: "system", text: `项目群创建 · 智能体团队已接入（${team === "full" ? "全量" : "精简"}团队）` },
        { type: "agent", who: "Ta-PM", avatar: "PM", text: `大家好，我是 Ta-PM。${name} 已创建，请描述项目目标，我会发起需求澄清。`, time: "刚刚" },
      ];
    } else {
      chat.messages = [
        { type: "system", text: "项目群创建 · 暂未接入智能体，可随时在设置中启用" },
      ];
      chat.responder = null;
    }
    dynamicChats.set(name, chat);
    $("#newProjectModal").hidden = true;
    $("#projectName").value = "";
    renderSidebar("chats");
    renderThread(chat);
    toast(`项目群「${name}」已创建${team === "none" ? "" : "，智能体团队已接入"}`);
  });
  function openNewProject() {
    closePopovers();
    $("#newProjectModal").hidden = false;
    setTimeout(() => $("#projectName").focus(), 50);
  }

  /* —— 文档弹窗（预览 / 编辑 / 版本历史） —— */
  $("#closeDoc").addEventListener("click", () => ($("#docModal").hidden = true));
  $("#downloadDoc").addEventListener("click", () => {
    toast(`正在下载 ${$("#docTitle").textContent}（演示）`, "↓");
  });
  $("#editDoc").addEventListener("click", () => {
    if ($("#editDoc").dataset.editing) cancelDocEdit();
    else startDocEdit();
  });
  $("#saveDocEdit").addEventListener("click", saveDocEdit);
  $("#cancelDocEdit").addEventListener("click", cancelDocEdit);

  /* —— 表情选择器 —— */
  renderEmojiPicker();
  $("#emojiBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const p = $("#emojiPicker");
    p.hidden = !p.hidden;
    $("#mentionPicker").hidden = true;
  });
  $("#emojiGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-emoji]");
    if (!btn) return;
    const input = $("#composerInput");
    const s = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, s) + btn.dataset.emoji + input.value.slice(input.selectionEnd ?? s);
    input.focus();
    $("#emojiPicker").hidden = true;
  });

  /* —— @提及选择器 —— */
  renderMentionPicker();
  function toggleMentionPicker() {
    const p = $("#mentionPicker");
    p.hidden = !p.hidden;
    $("#emojiPicker").hidden = true;
  }
  $("#mentionList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-mention]");
    if (!item) return;
    const input = $("#composerInput");
    input.value += `${item.dataset.mention} `;
    input.focus();
    $("#mentionPicker").hidden = true;
  });

  /* —— 发送 / 语音 / 文件 —— */
  $("#sendBtn").addEventListener("click", sendComposer);
  $("#micBtn").addEventListener("click", (e) => toggleMic(e.currentTarget));
  $("#fileBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    handleFiles(files);
  });

  /* —— 拖拽文件/图片到输入区与消息流（FR-DESK-02） —— */
  ["dragenter", "dragover"].forEach((ev) =>
    $(".composer").addEventListener(ev, (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      $(".composer").classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    $(".composer").addEventListener(ev, (e) => {
      e.preventDefault();
      $(".composer").classList.remove("drag-over");
    })
  );
  $(".composer").addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  /* 粘贴图片/文件 */
  document.addEventListener("paste", (e) => {
    if (!e.clipboardData || !e.clipboardData.files.length) return;
    if (document.activeElement === $("#composerInput") || document.activeElement === document.body) {
      handleFiles(e.clipboardData.files);
    }
  });

  const input = $("#composerInput");
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  /* —— 引用条取消 —— */
  $(".composer-tools").addEventListener("click", (e) => {
    if (e.target.closest("#quoteBar")) clearQuote();
  });

  /* —— 全局搜索 —— */
  $("#globalSearch").addEventListener("input", () => renderSidebar("chats"));

  /* —— 窄屏面板开关 —— */
  $("#panelToggle").addEventListener("click", () => {
    $("#appBody").classList.toggle("panel-open");
  });

  /* —— 点击外部 / Esc / 快捷键 —— */
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".popover") && !e.target.closest("#threadHeader") && !e.target.closest(".picker") && !e.target.closest("#emojiBtn")) {
      closePopovers();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#settingsModal").hidden || !$("#newProjectModal").hidden || !$("#docModal").hidden) {
        closeModals();
        return;
      }
      closePopovers();
      $("#globalSearch").value = "";
      renderSidebar(sidebarView);
      return;
    }
    /* Ctrl+Enter 发送 */
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendComposer();
      return;
    }
    /* Ctrl+Shift+A @提及选择器 */
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
      e.preventDefault();
      toggleMentionPicker();
      return;
    }
    /* Ctrl+N 新建项目群 */
    if ((e.ctrlKey || e.metaKey) && (e.key === "N" || e.key === "n")) {
      e.preventDefault();
      openNewProject();
      return;
    }
    /* Ctrl+F 全局搜索 */
    if ((e.ctrlKey || e.metaKey) && (e.key === "F" || e.key === "f")) {
      e.preventDefault();
      $("#globalSearch").focus();
    }
  });
}

/* ---------------- 启动 ---------------- */

function boot() {
  /* 登录门禁 */
  if (!TaStore.getSession()) {
    location.replace("login.html");
    return;
  }

  /* 恢复个人在线状态 */
  const presence = TaStore.getSettings().presence;
  if (presence && presence !== "on") {
    $("#mePresence").className = `presence ${presence}`;
    $$(".presence-opt").forEach((o) => o.classList.toggle("active", o.dataset.presence === presence));
  }
  /* 恢复设置开关 */
  const settings = TaStore.getSettings();
  $$("#settingsModal .switch").forEach((sw) => {
    if (settings[sw.dataset.setting] === false) sw.setAttribute("aria-checked", "false");
  });
  if (settings.notifyTime) $("#notifyTime").value = settings.notifyTime;

  /* 恢复设计评审里程碑（审批可能已在看板页完成） */
  const approvals = TaStore.getApprovals();
  if (approvals["AP-2026-007"]) syncPanelDesign(approvals["AP-2026-007"].state);

  /* 恢复用户新建的项目群 */
  TaStore.getProjects().forEach((p) => projectChatFor(p.name));

  currentChat = CHATS[0];
  renderSidebar("chats");
  renderThread(currentChat);
  renderMiniBoard();
  renderMemory();
  renderFiles();
  bindEvents();

  /* 待办中心 / 日报自动推送 / 逾期提醒 */
  renderTodoPanel();
  maybeAutoReport();
  const overdue = overdueTasksList();
  if (overdue.length) {
    notify("逾期任务提醒", `${overdue.length} 个任务已逾期：${overdue.map((t) => t.title).join("、")}，建议跟进。`);
  }
}

boot();
