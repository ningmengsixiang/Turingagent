/* ============================================================
   Turing Agent 原型 · 确认卡片渲染与审批决策（多级/会签/转办）
   依赖：ApprovalEngine（状态机）、TaStore、workspace 全局渲染函数
   ============================================================ */
"use strict";

/* 按审批流 ID 找到卡片定义（跨全部会话） */
function cardDefById(id) {
  for (const chat of chatList()) {
    const m = chat.messages.find((x) => x.type === "card" && x.card && x.card.id === id);
    if (m) return m.card;
  }
  return null;
}

/* 找到承载该审批卡的会话 */
function chatWithCard(id) {
  for (const chat of chatList()) {
    if (chat.messages.some((x) => x.type === "card" && x.card && x.card.id === id)) return chat;
  }
  return null;
}

/* 渲染确认卡片（状态由 ApprovalEngine 推导：级别推进/转办改名均生效） */
function cardHtml(c) {
  const v = ApprovalEngine.viewOf(c);
  const stateLabel = { pending: "待审批", approved: "已通过", rejected: "已驳回", returned: "已退回修改" };
  const stateChip = { pending: "chip-amber", approved: "chip-green", rejected: "chip-red", returned: "chip-amber" };
  const cur = ApprovalEngine.currentLevel(c);
  const multi = v.levels.length > 1;
  const chipText = v.state === "pending" && multi ? `第 ${Math.min(cur + 1, v.levels.length)}/${v.levels.length} 级审批中` : stateLabel[v.state];

  const levelsHtml = v.levels
    .map((lv, li) => {
      const lvState =
        v.state === "approved" ? "done"
        : li < v.level ? "done"
        : v.state === "rejected" && li === v.level ? "rejected"
        : li === cur ? "active"
        : "todo";
      const rows = lv.approvers
        .map((a) => {
          const cls = a.state === "done" ? "done" : a.state === "rejected" ? "rejected" : "pending";
          const result =
            a.state === "done"
              ? `<span class="result">✓ 已确认 <span class="t">${a.time}</span></span>`
              : a.state === "rejected"
                ? `<span class="result">✕ 已驳回</span>`
                : `<span class="result">⏳ 待确认</span>`;
          const transferBtn =
            v.state === "pending" && li === cur && a.state === "pending"
              ? `<button class="transfer-btn" data-action="transfer" data-from="${esc(a.who)}" title="转办给其他审批人">⇄ 转办</button>`
              : "";
          const transferred = a.transferred ? '<span class="transferred">（转办）</span>' : "";
          return `<li class="${cls}"><span class="level-dot ${lvState}"></span><span class="who">${esc(a.who)}${transferred}</span><span class="role">${esc(a.role)}</span>${result}${transferBtn}</li>`;
        })
        .join("");
      const lvChip =
        lvState === "done" ? '<span class="lv-chip done">✓ 已完成</span>'
        : lvState === "active" ? '<span class="lv-chip active">审批中</span>'
        : lvState === "rejected" ? '<span class="lv-chip rejected">已驳回</span>'
        : '<span class="lv-chip">待开始</span>';
      return `
        <div class="card-level ${lvState}">
          <div class="lv-head"><span class="lv-name">${esc(lv.name)}</span>${lvChip}</div>
          <ul class="approver-list">${rows}</ul>
        </div>`;
    })
    .join("");

  const preview = c.preview
    ? `<div class="card-preview" data-preview="1"><span class="thumb">${esc(c.preview.slice(0, 2))}</span><div><div style="font-weight:600">${esc(c.preview)}</div><div class="mono" style="font-size:var(--text-xs);color:var(--ink-faint)">由 Ta-UI/UX 提交 · 点击预览</div></div></div>`
    : "";
  const commentNote = v.comment ? ` · ${esc(v.comment)}` : "";
  const actions =
    v.state === "pending" && cur >= 0
      ? `<div class="card-actions">
          <button class="btn btn-sm btn-approve" data-action="approve">✓ 确认</button>
          <button class="btn btn-sm btn-danger" data-action="reject">✕ 驳回</button>
          <button class="btn btn-sm btn-outline" data-action="comment">修改意见</button>
          <span class="mono" style="margin-left:auto;font-size:var(--text-xs);color:var(--ink-faint)">${multi ? `确认后推进到第 ${Math.min(cur + 2, v.levels.length)} 级` : "会签：全部审批人确认后通过"}</span>
        </div>
        <div class="card-comment-box">
          <textarea placeholder="输入驳回原因或修改意见…" aria-label="审批意见"></textarea>
          <div class="row">
            <button class="btn btn-sm btn-ghost" data-action="cancel-comment">取消</button>
            <button class="btn btn-sm btn-danger" data-action="submit-reject">提交驳回</button>
            <button class="btn btn-sm btn-solid" data-action="submit-comment">提交意见</button>
          </div>
        </div>`
      : `<div class="card-actions"><span class="mono" style="font-size:var(--text-xs);color:var(--ink-faint)">${stateLabel[v.state]}${commentNote} · 审批记录已留痕，可在审计日志中查看</span></div>`;
  return `
    <div class="card ${v.state}" data-approval="${c.id}" data-state="${v.state}">
      <div class="card-head">
        <span class="card-icon">${ICONS.check}</span>
        <div>
          <div class="card-title">${esc(c.title)}</div>
          <div class="card-meta">审批流 ${c.id} · ${esc(c.need)}</div>
        </div>
        <span class="chip ${stateChip[v.state]}">${chipText}</span>
      </div>
      <div class="card-body">${esc(c.body)}${preview}</div>
      ${levelsHtml}
      ${actions}
    </div>`;
}

/* 审批决策核心：状态机 + 系统消息 + 审计 + 面板/看板联动 + 全量重渲染
   （卡片按钮与待办中心共用此入口） */
function applyApprovalById(approvalId, action, comment) {
  const def = cardDefById(approvalId);
  if (!def) return;

  const actionLabel = { approve: "审批通过", reject: "审批驳回", returned: "退回修改" }[action];
  let res;
  if (action === "approve") res = ApprovalEngine.approve(def, SELF.who);
  if (action === "reject") res = ApprovalEngine.reject(def, SELF.who, comment);
  if (action === "returned") res = ApprovalEngine.returnForEdit(def, SELF.who, comment);

  TaStore.addAudit({ type: "approval", action: actionLabel, target: `审批流 ${approvalId} · ${def.title}`, actor: SELF.who });

  /* 系统消息（写入会话数据，重渲染后仍在） */
  const chat = chatWithCard(approvalId);
  if (action === "approve") {
    const done = res.state === "approved";
    const text = `审批流 ${approvalId}：${done ? "全部级别确认通过，进入下一阶段" : `第 ${res.level}/${res.total} 级通过，进入第 ${res.level + 1} 级审批`}`;
    if (chat) {
      chat.messages.push({ type: "system", text });
      chat.last = text;
      chat.time = now();
    }
    toast(done ? "已确认，审批全部通过" : `第 ${res.level} 级通过，进入下一级`, "✓");
  } else {
    const text = `审批流 ${approvalId}：${action === "reject" ? "已被驳回" : "已退回修改"}`;
    if (chat) {
      chat.messages.push({ type: "system", text });
      chat.last = text;
      chat.time = now();
    }
    toast(actionLabel, action === "reject" ? "✕" : "↩");
  }

  /* 面板联动：设计评审里程碑（最终态才同步） */
  if (approvalId === "AP-2026-007" && res.state !== "pending") syncPanelDesign(res.state);

  /* 看板任务联动 */
  syncBoardApproval(approvalId, res.state, comment);

  /* 全量重渲染（多级卡片/待办中心/迷你看板） */
  renderThread(currentChat);
  renderMiniBoard();
  if (typeof renderTodoPanel === "function") renderTodoPanel();
}

function decideCard(cardEl, action, comment) {
  applyApprovalById(cardEl.dataset.approval, action, comment);
}

/* 转办：把待审批人替换为另一人 */
function transferApprover(cardDef, from, to) {
  ApprovalEngine.transfer(cardDef, from, to);
  TaStore.addAudit({ type: "approval", action: "转办", target: `审批流 ${cardDef.id} · ${from} → ${to}`, actor: SELF.who });
  toast(`已转办给 ${to}`, "⇄");
  renderThread(currentChat);
  if (typeof renderTodoPanel === "function") renderTodoPanel();
}

/* 转办候选（不含转出人） */
const TRANSFER_CANDIDATES = ["陈总", "李工", "王芳", "小王", "张敏"];

/* 待办中心取数：所有未决审批卡（跨会话） */
function pendingApprovals() {
  return chatList()
    .flatMap((chat) =>
      chat.messages
        .filter((m) => m.type === "card" && ApprovalEngine.currentLevel(m.card) >= 0)
        .map((m) => ({ chat, card: m.card }))
    );
}
