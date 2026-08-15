/* ============================================================
   Turing Agent 原型 · 组织与治理页交互
   成员与部门（邀请/角色变更）/ 角色权限矩阵 / 智能体配额熔断 / 审计日志（筛选/导出）
   状态：成员与配额经 ta.orgMembers / ta.agentQuotas 持久化，审计日志与全局共享
   ============================================================ */
"use strict";

/* ---------------- 状态 ---------------- */

let activeDept = "all"; /* all = 全部成员 */
let auditFilter = "all";
let members = TaStore.getOrgMembers() ?? MEMBERS.map((m) => ({ ...m }));
let quotas = TaStore.getAgentQuotas() ?? AGENT_QUOTAS.map((q) => ({ ...q }));

function saveMembers() {
  TaStore.setOrgMembers(members);
}
function saveQuotas() {
  TaStore.setAgentQuotas(quotas);
}

const TYPE_LABEL = { approval: "审批", task: "任务", perm: "权限", agent: "智能体", system: "系统" };

function auditEntries() {
  return [...TaStore.getAudit(), ...AUDIT_SEED];
}

/* ---------------- 渲染 ---------------- */

function renderDeptTree() {
  const depts = [{ name: "全部成员", count: members.length, key: "all" }, ...DEPARTMENTS.map((d) => ({ ...d, key: d.name }))];
  $("#deptTree").innerHTML = depts
    .map(
      (d) => `
      <button class="dept-item ${activeDept === d.key ? "active" : ""}" data-dept="${esc(d.key)}">
        ${esc(d.name)} <span class="n">${d.key === "all" ? d.count : members.filter((m) => m.dept === d.key).length}</span>
      </button>`
    )
    .join("");
}

function renderMembers() {
  const list = activeDept === "all" ? members : members.filter((m) => m.dept === activeDept);
  $("#memberHead").textContent = activeDept === "all" ? "全部成员" : `${activeDept} · ${list.length} 人`;
  $("#memberList").innerHTML = list
    .map(
      (m) => `
      <div class="member-row">
        <span class="avatar"><i class="presence ${m.presence}"></i>${esc(m.name[0])}</span>
        <div class="m-meta">
          <div class="m-name">${esc(m.name)}</div>
          <div class="m-sub">${esc(m.email)} · ${esc(m.dept)}</div>
        </div>
        <select data-role-for="${esc(m.name)}" aria-label="${esc(m.name)} 的角色">
          ${ROLES.map((r) => `<option ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </div>`
    )
    .join("");
}

function renderMatrix() {
  $("#matrixBody").innerHTML = ROLE_MATRIX.map(
    (r) => `
      <tr>
        <td>${r.role}</td>
        <td class="${r.build ? "cell-yes" : "cell-no"}">${r.build ? "✓" : "—"}</td>
        <td class="${r.speak ? "cell-yes" : "cell-no"}">${r.speak ? "✓" : "—"}</td>
        <td class="${r.confirm ? "cell-yes" : "cell-no"}">${r.confirm ? "✓" : "—"}</td>
        <td class="${r.approve === true ? "cell-yes" : r.approve ? "cell-cond" : "cell-no"}">${r.approve === true ? "✓" : r.approve || "—"}</td>
        <td class="${r.code === true ? "cell-yes" : r.code ? "cell-cond" : "cell-no"}">${r.code === true ? "✓" : r.code || "—"}</td>
        <td class="${r.perm !== "—" ? "cell-cond" : "cell-no"}">${r.perm}</td>
      </tr>`
  ).join("");
}

function renderAgents() {
  $("#agentGrid").innerHTML = quotas
    .map((q) => {
      const pct = Math.round((q.used / q.total) * 100);
      const tripped = q.tripped;
      return `
      <div class="agent-card ${tripped ? "tripped" : ""}" data-agent="${esc(q.name)}">
        <div class="a-head">
          <span class="avatar agent" style="width:28px;height:28px;font-size:11px;border-radius:7px">${q.label}</span>
          <div class="a-name">${esc(q.name)}</div>
          <span class="switch" role="switch" aria-checked="${q.enabled}" data-fuse="${esc(q.name)}" aria-label="启用 ${esc(q.name)}"></span>
        </div>
        <div class="a-field">模型
          <select data-model="${esc(q.name)}">
            ${["DeepSeek-V3", "Claude-Opus", "Claude-Sonnet", "GPT-5", "通义千问", "GLM-4"].map((m) => `<option ${q.model === m ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>
        <div class="a-field">
          <span>Token 配额</span>
          <div class="quota">
            <div class="bar"><i style="width:${pct}%"></i></div>
            <span class="q-num">${q.used}/${q.total}k</span>
          </div>
        </div>
        <div class="a-actions">
          <span class="mono" style="font-size:var(--text-xs);color:${tripped ? "var(--danger)" : "var(--ink-faint)"}">${tripped ? "已熔断 · 超额自动停止" : "运行中"}</span>
          <button class="fuse-btn" data-sim="${esc(q.name)}">模拟超额</button>
        </div>
      </div>`;
    })
    .join("");
}

function renderAudit() {
  const list = auditEntries().filter((e) => auditFilter === "all" || e.type === auditFilter);
  $("#auditList").innerHTML = list
    .map(
      (e) => `
      <div class="audit-row">
        <span class="a-time">${esc(e.time)}</span>
        <span class="chip ${e.type === "approval" ? "chip-amber" : e.type === "agent" ? "chip-ai" : e.type === "perm" ? "chip-red" : "chip-neutral"}">${TYPE_LABEL[e.type] || e.type}</span>
        <span class="a-target">${esc(e.action)} · ${esc(e.target)}</span>
        <span class="a-actor">${esc(e.actor)}</span>
      </div>`
    )
    .join("");
}

/* ---------------- 导出 CSV（真实下载） ---------------- */

function exportAuditCsv() {
  const rows = [["时间", "类型", "操作", "对象", "操作人"], ...auditEntries().map((e) => [e.time, TYPE_LABEL[e.type] || e.type, e.action, e.target, e.actor])];
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `审计日志-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  TaStore.addAudit({ type: "perm", action: "审计导出", target: `审计日志 CSV（${rows.length - 1} 条）`, actor: "赵主任" });
  toast(`已导出 ${rows.length - 1} 条审计记录`, "↓");
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  /* 视图 Tab */
  $$(".org-tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".org-tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      $$(".org-view").forEach((v) => (v.hidden = v.dataset.view !== t.dataset.view));
    })
  );

  /* 部门筛选 */
  $("#deptTree").addEventListener("click", (e) => {
    const item = e.target.closest("[data-dept]");
    if (!item) return;
    activeDept = item.dataset.dept;
    renderDeptTree();
    renderMembers();
  });

  /* 角色变更 */
  $("#memberList").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-role-for]");
    if (!sel) return;
    const name = sel.dataset.roleFor;
    members = members.map((m) => (m.name === name ? { ...m, role: sel.value } : m));
    saveMembers();
    TaStore.addAudit({ type: "perm", action: "角色变更", target: `${name} → ${sel.value}`, actor: "赵主任" });
    toast(`${name} 的角色已变更为「${sel.value}」`, "✓");
    renderAudit();
  });

  /* 邀请成员 */
  $("#inviteBtn").addEventListener("click", () => {
    $("#inviteModal").hidden = false;
    $("#inviteName").value = "";
    $("#inviteEmail").value = "";
    setTimeout(() => $("#inviteName").focus(), 50);
  });
  $("#cancelInvite").addEventListener("click", () => ($("#inviteModal").hidden = true));
  $("#submitInvite").addEventListener("click", () => {
    const name = $("#inviteName").value.trim();
    const email = $("#inviteEmail").value.trim();
    if (!name || !email) {
      toast("请填写姓名与企业邮箱", "⚠");
      return;
    }
    members = [...members, { name, dept: $("#inviteDept").value, role: $("#inviteRole").value, presence: "off", email }];
    saveMembers();
    TaStore.addAudit({ type: "perm", action: "成员邀请", target: `邀请 ${name} 加入 ${$("#inviteDept").value}`, actor: "赵主任" });
    $("#inviteModal").hidden = true;
    renderDeptTree();
    renderMembers();
    renderAudit();
    toast(`已向 ${email} 发送邀请`, "✓");
  });

  /* 智能体：模型 / 开关 / 模拟超额 */
  $("#agentGrid").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-model]");
    if (!sel) return;
    const name = sel.dataset.model;
    quotas = quotas.map((q) => (q.name === name ? { ...q, model: sel.value } : q));
    saveQuotas();
    TaStore.addAudit({ type: "agent", action: "模型切换", target: `${name} → ${sel.value}`, actor: "赵主任" });
    toast(`${name} 已切换至 ${sel.value}`);
    renderAudit();
  });
  $("#agentGrid").addEventListener("click", (e) => {
    const sw = e.target.closest("[data-fuse]");
    if (sw) {
      const name = sw.dataset.fuse;
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      quotas = quotas.map((q) => (q.name === name ? { ...q, enabled: next } : q));
      saveQuotas();
      TaStore.addAudit({ type: "agent", action: next ? "启用智能体" : "停用智能体", target: name, actor: "赵主任" });
      toast(`${name} ${next ? "已启用" : "已停用"}`, next ? "✓" : "⏸");
      renderAudit();
      return;
    }
    const sim = e.target.closest("[data-sim]");
    if (sim) {
      const name = sim.dataset.sim;
      const q = quotas.find((x) => x.name === name);
      if (!q) return;
      quotas = quotas.map((x) => (x.name === name ? { ...x, used: x.total, tripped: true } : x));
      saveQuotas();
      TaStore.addAudit({ type: "agent", action: "熔断触发", target: `${name} 单任务预算超限`, actor: "系统" });
      notify("智能体熔断", `${name} Token 配额已超额，已自动熔断并停止新任务。`);
      renderAgents();
      renderAudit();
      toast(`${name} 已触发熔断（演示）`, "⚠");
    }
  });

  /* 审计筛选与导出 */
  $$(".audit-bar .filter-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      auditFilter = chip.dataset.filter;
      $$(".audit-bar .filter-chip").forEach((c) => c.classList.toggle("active", c === chip));
      renderAudit();
    })
  );
  $("#exportAudit").addEventListener("click", exportAuditCsv);

  /* 弹层关闭 */
  $$(".modal-overlay").forEach((m) =>
    m.addEventListener("click", (e) => {
      if (e.target === m) m.hidden = true;
    })
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal-overlay").forEach((m) => (m.hidden = true));
  });
}

/* ---------------- 启动 ---------------- */

if (!TaStore.getSession()) {
  location.replace("login.html");
} else {
  renderDeptTree();
  renderMembers();
  renderMatrix();
  renderAgents();
  renderAudit();
  bindEvents();
}
