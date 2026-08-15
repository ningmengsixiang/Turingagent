/* ============================================================
   Turing Agent 原型 · 待办中心与日报（FR-APP-04 / FR-TASK-03）
   待办：跨会话审批卡聚合（批量处理）+ 逾期任务提醒
   日报：Ta-PMO 每日推送（自动 + 手动生成）
   依赖：ApprovalEngine、cards.js、workspace 全局函数
   ============================================================ */
"use strict";

const TODAY_REPORT = "2026-08-13";

/* —— 逾期任务（非完成/非待开始且已过截止） —— */
function overdueTasksList() {
  return tasksData().filter((t) => t.col !== "done" && t.col !== "todo" && t.due && t.due < TODAY_REPORT);
}

/* —— 待办中心 —— */
function renderTodoPanel() {
  const panel = $("#todoPanel");
  if (!panel) return;
  const approvals = pendingApprovals();
  const overdue = overdueTasksList();
  const total = approvals.length + overdue.length;

  const badge = $("#todoCount");
  if (badge) {
    badge.textContent = total;
    badge.style.display = total ? "" : "none";
  }

  panel.innerHTML = `
    <div class="pop-head">待办中心 <button class="pop-action" data-todo="approve-all">全部确认</button></div>
    ${approvals.map((a) => todoApprovalHtml(a)).join("")}
    ${overdue.length ? `<div class="todo-section">逾期任务提醒</div>` + overdue.map(todoOverdueHtml).join("") : ""}
    ${total === 0 ? '<div class="todo-empty">太棒了，没有待办事项</div>' : ""}`;
}

function todoApprovalHtml({ chat, card }) {
  const v = ApprovalEngine.viewOf(card);
  const cur = ApprovalEngine.currentLevel(card);
  return `
    <div class="todo-item" data-chat="${esc(chat.id)}">
      <div class="todo-body">
        <div class="todo-title">${esc(card.title)}</div>
        <div class="todo-meta mono">${card.id} · ${esc(card.need)}${v.levels.length > 1 ? ` · 当前第 ${cur + 1} 级` : ""}</div>
      </div>
      <div class="todo-actions">
        <button class="btn btn-sm btn-approve" data-todo="approve" data-approval="${card.id}">确认</button>
        <button class="btn btn-sm btn-danger" data-todo="reject" data-approval="${card.id}">驳回</button>
      </div>
    </div>`;
}

function todoOverdueHtml(t) {
  return `
    <div class="todo-item overdue">
      <div class="todo-body">
        <div class="todo-title">${esc(t.title)}</div>
        <div class="todo-meta mono">${t.id} · 截止 ${t.due} · ${esc(t.assignee)}</div>
      </div>
      <div class="todo-actions">
        <a class="btn btn-sm btn-outline" href="board.html">查看看板</a>
      </div>
    </div>`;
}

/* —— 日报（数据来自看板任务，真实计算） —— */
function buildReportText() {
  const tasks = tasksData();
  const count = (col) => tasks.filter((t) => t.col === col).length;
  const aiDoing = tasks.filter((t) => t.col === "doing" && t.type === "ai").length;
  const overdue = overdueTasksList();
  const lines = [
    `今日进度摘要（${TODAY_REPORT}）：`,
    `· 已完成 ${count("done")} 项`,
    `· 进行中 ${count("doing")} 项（智能体 ${aiDoing} 项）`,
    `· 阻塞 ${count("blocked")} 项`,
    `· 待审批 ${count("approval")} 项`,
  ];
  if (overdue.length) {
    lines.push(`⚠️ 逾期 ${overdue.length} 项：${overdue.map((t) => t.title).join("、")}，建议跟进。`);
  } else {
    lines.push("· 无逾期任务");
  }
  return lines.join("\n");
}

/* 推送日报：写入 PMO 会话 + 未读 + 系统通知 + 审计 */
function pushReport(manual = false) {
  const chat = chatList().find((c) => c.id === "pmo");
  if (!chat) return;
  chat.messages.push({ type: "agent", who: "Ta-PMO", avatar: "PMO", text: buildReportText(), time: now() });
  chat.last = `Ta-PMO：${manual ? "日报已生成" : "今日进度摘要已生成"}`;
  chat.time = now();
  if (chat.id !== currentChat.id) chat.unread += 1;
  TaStore.setLastReport(TODAY_REPORT);
  TaStore.addAudit({ type: "system", action: "日报推送", target: `项目日报 · 报销系统`, actor: "Ta-PMO" });
  notify("Ta-PMO 项目日报", manual ? "日报已按最新数据生成" : `今日进度：已完成 ${tasksData().filter((t) => t.col === "done").length} 项`);
  if (chat.id === currentChat.id) renderThread(chat);
  if (typeof renderSidebar === "function") renderSidebar(sidebarView || "chats");
}

/* 登录后每天自动推一次（跨会话只推一次） */
function maybeAutoReport() {
  if (TaStore.getLastReport() === TODAY_REPORT) return;
  pushReport(false);
}
