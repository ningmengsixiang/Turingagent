/* ============================================================
   Turing Agent 原型 · 任务看板交互（极简白）
   筛选 / 新建任务 / 任务详情 / 状态流转 / 拖拽 / 审批（与工作台同步）
   状态跨页共享：TaStore.tasks / TaStore.approvals
   ============================================================ */
"use strict";

/* ---------------- 状态 ---------------- */

const TODAY = "2026-08-13";
let tasks = (TaStore.getTasks() ?? SEED_TASKS).map((t) => ({ ...t }));
let activeFilter = "all";
let detailId = null; /* 当前详情弹窗对应的任务 id */
let dragId = null;
let deleteArmed = false;

const APPROVAL_META = {
  "AP-2026-007": "审批人：陈总 ✓ · 李工 ⏳",
  "AP-2026-009": "审批人：陈总 ✓ · 李工 ⏳",
  "AP-2026-010": "两级串行 · 第 1 级：李工 ⏳",
};

/* ---------------- 工具 ---------------- */

function save() {
  TaStore.setTasks(tasks);
}

function isOverdue(t) {
  return t.col !== "done" && t.col !== "todo" && t.due && t.due < TODAY;
}

function matchFilter(t) {
  if (activeFilter === "mine") return t.mine === true;
  if (activeFilter === "ai") return t.type === "ai";
  if (activeFilter === "approval") return t.col === "approval";
  if (activeFilter === "overdue") return isOverdue(t);
  return true;
}

function avOf(t) {
  return ASSIGNEE_AV[t.assignee] || { label: "?", agent: false };
}

/* ---------------- 渲染 ---------------- */

function cardHtml(t) {
  const av = avOf(t);
  const overdueTag = isOverdue(t) ? '<span class="tag overdue">逾期</span>' : "";
  const prioTag = t.prio === "P0" ? '<span class="tag overdue">P0</span>' : `<span class="tag human">${t.prio}</span>`;
  const avatarHtml = `<span class="avatar ${av.agent ? "agent" : ""}" style="width:18px;height:18px;font-size:9px;${av.agent ? "border-radius:5px" : ""}">${av.label}</span>`;
  const meta =
    t.col === "approval" && t.approvalId
      ? `${APPROVAL_META[t.approvalId] || "待审批"}`
      : `${esc(t.assignee)} · 截止 ${t.due || "待定"}`;
  const progress =
    t.col === "doing"
      ? `<div class="t-progress"><div class="bar"><i style="width:${t.progress ?? 0}%"></i></div><span class="pct">${t.progress ?? 0}%</span></div>`
      : "";
  const blocked = t.blockedReason ? `<div class="blocked-reason">${esc(t.blockedReason)}</div>` : "";
  return `
    <div class="task-card ${t.col === "blocked" ? "blocked" : ""}" data-id="${t.id}" draggable="true">
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-tags">
        <span class="tag ${t.type === "ai" ? "ai" : "human"}">${t.type === "ai" ? "AI" : "人"}</span>
        ${overdueTag}${prioTag}
      </div>
      <div class="t-meta">${avatarHtml} ${meta}</div>
      ${progress}${blocked}
    </div>`;
}

function renderBoard() {
  BOARD_COLS.forEach((col) => {
    const colEl = $(`.board-col[data-col="${col.id}"]`);
    const items = tasks.filter((t) => t.col === col.id && matchFilter(t));
    $(".col-cards", colEl).innerHTML = items.map(cardHtml).join("");
    $(".col-head .n", colEl).textContent = String(tasks.filter((t) => t.col === col.id).length);
    $(".empty-col", colEl).classList.toggle("show", items.length === 0);
  });
  renderStats();
}

function renderStats() {
  const count = (col) => tasks.filter((t) => t.col === col).length;
  const done = count("done");
  const aiDone = tasks.filter((t) => t.col === "done" && t.type === "ai").length;
  const pct = done ? Math.round((aiDone / done) * 100) : 0;
  $("#statDone").textContent = done;
  $("#statDoing").textContent = count("doing");
  $("#statBlocked").textContent = count("blocked");
  $("#statApproval").textContent = count("approval");
  $("#statAiPct").textContent = `${pct}%`;
  $("#statAiBar").style.width = `${pct}%`;
}

/* ---------------- 筛选 ---------------- */

function applyFilter(filter) {
  activeFilter = filter;
  $$(".filter-chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === filter));
  renderBoard();
}

/* ---------------- 新建任务 ---------------- */

function openNewTask() {
  $("#taskModal").hidden = false;
  $("#taskTitle").value = "";
  setTimeout(() => $("#taskTitle").focus(), 50);
}

function submitNewTask() {
  const title = $("#taskTitle").value.trim();
  if (!title) {
    toast("请输入任务名称", "⚠");
    return;
  }
  const assignee = $("#taskAssignee").value;
  const prio = $("#taskPrio").value;
  const due = $("#taskDue").value;
  const task = {
    id: `T-${String(tasks.length + 101)}`,
    title,
    type: assignee.includes("AI") ? "ai" : "human",
    assignee,
    prio,
    col: "todo",
    due,
    mine: assignee === "张敏 · 财务",
  };
  tasks = [...tasks, task];
  save();
  TaStore.addAudit({ type: "task", action: "任务创建", target: `任务「${title}」→ ${assignee}`, actor: SELF.who });
  $("#taskModal").hidden = true;
  applyFilter(activeFilter);
  toast(`任务「${title}」已创建并分配给 ${assignee}`);
}

/* ---------------- 任务详情 ---------------- */

function openDetail(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  detailId = id;
  deleteArmed = false;
  $("#deleteTask").textContent = "删除任务";

  $("#detailTitle").textContent = t.title;
  $("#detailId").textContent = `${t.id} · ${t.approvalId ? `审批流 ${t.approvalId}` : t.type === "ai" ? "智能体任务" : "人类任务"}`;
  $("#detailAssignee").value = t.assignee;
  $("#detailPrio").value = t.prio;
  $("#detailDue").value = t.due || "";
  $("#detailBlocked").value = t.blockedReason || "";
  $("#detailBlockedWrap").hidden = t.col !== "blocked";
  $("#detailApprove").hidden = !t.approvalId || t.col !== "approval";
  syncStatusButtons(t.col);
  $("#taskDetailModal").hidden = false;
}

function syncStatusButtons(col) {
  $$("#detailStatusGrid .status-btn").forEach((b) => b.classList.toggle("active", b.dataset.status === col));
}

/* 状态快速流转（点击即生效） */
function moveTask(id, col) {
  const prev = tasks.find((t) => t.id === id);
  tasks = tasks.map((t) =>
    t.id === id
      ? { ...t, col, doneAt: col === "done" ? "今天" : undefined, progress: col === "done" ? 100 : t.progress }
      : t
  );
  save();
  const label = BOARD_COLS.find((c) => c.id === col).label;
  if (prev && prev.col !== col) {
    TaStore.addAudit({ type: "task", action: "状态变更", target: `任务「${prev.title}」${prev.col} → ${col}`, actor: SELF.who });
  }
  renderBoard();
  syncStatusButtons(col);
  const current = tasks.find((t) => t.id === id);
  $("#detailBlockedWrap").hidden = col !== "blocked";
  $("#detailApprove").hidden = !(current && current.approvalId) || col !== "approval";
  toast(`已移动到「${label}」`);
}

function saveDetail() {
  const t = tasks.find((x) => x.id === detailId);
  if (!t) return;
  const assignee = $("#detailAssignee").value;
  const prio = $("#detailPrio").value;
  const due = $("#detailDue").value;
  const blockedReason = $("#detailBlocked").value.trim();
  tasks = tasks.map((x) =>
    x.id === detailId
      ? {
          ...x,
          assignee,
          type: assignee.includes("AI") ? "ai" : "human",
          prio,
          due,
          blockedReason: x.col === "blocked" ? blockedReason : undefined,
        }
      : x
  );
  save();
  TaStore.addAudit({ type: "task", action: "任务编辑", target: `任务「${t.title}」执行者/优先级/截止更新`, actor: SELF.who });
  $("#taskDetailModal").hidden = true;
  renderBoard();
  toast("任务详情已保存");
}

function deleteTask() {
  const t = tasks.find((x) => x.id === detailId);
  if (!t) return;
  if (!deleteArmed) {
    deleteArmed = true;
    $("#deleteTask").textContent = "确认删除？再点一次";
    setTimeout(() => {
      deleteArmed = false;
      $("#deleteTask").textContent = "删除任务";
    }, 2500);
    return;
  }
  tasks = tasks.filter((x) => x.id !== detailId);
  save();
  TaStore.addAudit({ type: "task", action: "任务删除", target: `任务「${t.title}」`, actor: SELF.who });
  $("#taskDetailModal").hidden = true;
  renderBoard();
  toast(`任务「${t.title}」已删除`, "✕");
}

/* ---------------- 审批（看板侧，与工作台共享 ApprovalEngine 状态机） ---------------- */

function decideFromBoard(action) {
  const t = tasks.find((x) => x.id === detailId);
  if (!t || !t.approvalId) return;
  const def = {
    id: t.approvalId,
    title: t.title,
    levels:
      t.approvalId === "AP-2026-010"
        ? [
            { name: "第 1 级 · 技术审批", approvers: [{ who: "李工", role: "技术负责人 · 研发", state: "pending", time: "" }] },
            { name: "第 2 级 · 业务审批", approvers: [{ who: "陈总", role: "业务负责人 · 财务", state: "pending", time: "" }] },
          ]
        : [{ name: "审批", approvers: [{ who: "李工", role: "技术负责人 · 研发", state: "pending", time: "" }] }],
  };
  const res = action === "approve" ? ApprovalEngine.approve(def, SELF.who) : ApprovalEngine.reject(def, SELF.who, "");
  TaStore.addAudit({
    type: "approval",
    action: action === "approve" ? "审批通过" : "审批驳回",
    target: `审批流 ${t.approvalId} · ${t.title}`,
    actor: SELF.who,
  });
  tasks = tasks.map((x) =>
    x.id === detailId
      ? {
          ...x,
          col: res.state === "approved" ? "done" : res.state === "rejected" ? "todo" : x.col,
          doneAt: res.state === "approved" ? "今天" : undefined,
          blockedReason: res.state === "rejected" ? "审批驳回（在看板中操作）" : undefined,
        }
      : x
  );
  save();
  $("#taskDetailModal").hidden = true;
  renderBoard();
  toast(
    action === "approve"
      ? res.state === "approved"
        ? `审批流 ${t.approvalId} 已通过，任务完成`
        : `审批流 ${t.approvalId} 第 ${res.level}/${res.total} 级通过`
      : `审批流 ${t.approvalId} 已驳回`,
    action === "approve" ? "✓" : "✕"
  );
}

/* ---------------- 拖拽 ---------------- */

function bindDrag() {
  $("#board").addEventListener("dragstart", (e) => {
    const card = e.target.closest(".task-card");
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  $$(".board-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      if (!dragId) return;
      const t = tasks.find((x) => x.id === dragId);
      dragId = null;
      if (t && t.col !== col.dataset.col) {
        moveTask(t.id, col.dataset.col);
      }
    });
  });
  $("#board").addEventListener("dragend", () => {
    dragId = null;
    $$(".task-card.dragging").forEach((c) => c.classList.remove("dragging"));
    $$(".board-col").forEach((c) => c.classList.remove("drag-over"));
  });
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  $$(".filter-chip").forEach((chip) => chip.addEventListener("click", () => applyFilter(chip.dataset.filter)));

  $("#newTaskBtn").addEventListener("click", openNewTask);
  $("#cancelTask").addEventListener("click", () => ($("#taskModal").hidden = true));
  $("#submitTask").addEventListener("click", submitNewTask);

  $("#board").addEventListener("click", (e) => {
    const card = e.target.closest(".task-card");
    if (card) openDetail(card.dataset.id);
  });

  $$("#detailStatusGrid .status-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (detailId) moveTask(detailId, b.dataset.status);
    })
  );
  $("#saveDetail").addEventListener("click", saveDetail);
  $("#closeDetail").addEventListener("click", () => ($("#taskDetailModal").hidden = true));
  $("#deleteTask").addEventListener("click", deleteTask);
  $("#detailApproveBtn").addEventListener("click", () => decideFromBoard("approve"));
  $("#detailRejectBtn").addEventListener("click", () => decideFromBoard("reject"));

  /* 弹层关闭：遮罩点击 / Esc */
  $$(".modal-overlay").forEach((m) =>
    m.addEventListener("click", (e) => {
      if (e.target === m) m.hidden = true;
    })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal-overlay").forEach((m) => (m.hidden = true));
  });

  bindDrag();
}

/* ---------------- 启动 ---------------- */

if (!TaStore.getSession()) {
  location.replace("login.html");
} else {
  renderBoard();
  bindEvents();
}
