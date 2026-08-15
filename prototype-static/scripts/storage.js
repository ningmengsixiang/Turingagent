/* ============================================================
   Turing Agent 原型 · 跨页共享状态（localStorage）
   工作台与看板读写同一份状态：审批流 / 任务 / 会话消息 / 项目 / 设置
   键前缀 "ta."，全部 JSON 序列化，无生产数据（纯内存合成演示）
   ============================================================ */
"use strict";

const TaStore = (() => {
  const PREFIX = "ta.";

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* 存储满/隐私模式下降级为仅内存 */
    }
  }

  return {
    /* —— 审批流状态：{ "AP-2026-007": { state, comment, time, approver } } —— */
    getApprovals() {
      return read("approvals", {});
    },
    setApproval(id, record) {
      write("approvals", { ...this.getApprovals(), [id]: record });
    },

    /* —— 任务看板：TASKS 数组（缺省返回 null，由调用方使用种子数据） —— */
    getTasks() {
      return read("tasks", null);
    },
    setTasks(tasks) {
      write("tasks", tasks);
    },

    /* —— 每个会话中用户发送的消息（渲染时合并到种子消息之后） —— */
    getMessages(chatId) {
      return read(`msgs.${chatId}`, []);
    },
    addMessage(chatId, msg) {
      write(`msgs.${chatId}`, [...this.getMessages(chatId), msg]);
    },

    /* —— 用户新建的项目群 —— */
    getProjects() {
      return read("projects", []);
    },
    setProjects(projects) {
      write("projects", projects);
    },

    /* —— 应用设置（通知开关 / 日报时间 / 我的在线状态） —— */
    getSettings() {
      return read("settings", {});
    },
    setSettings(patch) {
      write("settings", { ...this.getSettings(), ...patch });
    },

    /* —— 登录会话：{ name, at } —— */
    getSession() {
      return read("session", null);
    },
    setSession(s) {
      write("session", s);
    },
    clearSession() {
      try {
        localStorage.removeItem(PREFIX + "session");
      } catch {
        /* ignore */
      }
    },

    /* —— 审计日志（追加，最多保留 200 条）：
       { id, type: approval|task|perm|agent|system, action, target, actor, time } —— */
    getAudit() {
      return read("audit", []);
    },
    addAudit(entry) {
      const list = this.getAudit();
      const next = [{ id: `${Date.now()}-${list.length}`, time: now(), ...entry }, ...list].slice(0, 200);
      write("audit", next);
    },

    /* —— 记忆文档人工编辑覆盖：
       { [docIndex]: { versions: [{ v, editor, time, body }] } } —— */
    getDocOverrides() {
      return read("docOverrides", {});
    },
    setDocOverrides(map) {
      write("docOverrides", map);
    },

    /* —— 日报推送日期（YYYY-MM-DD） —— */
    getLastReport() {
      return read("lastReport", "");
    },
    setLastReport(date) {
      write("lastReport", date);
    },

    /* —— 组织成员与智能体配额（org 页） —— */
    getOrgMembers() {
      return read("orgMembers", null);
    },
    setOrgMembers(members) {
      write("orgMembers", members);
    },
    getAgentQuotas() {
      return read("agentQuotas", null);
    },
    setAgentQuotas(quotas) {
      write("agentQuotas", quotas);
    },

    /* —— 重置全部演示数据 —— */
    reset() {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    },
  };
})();
