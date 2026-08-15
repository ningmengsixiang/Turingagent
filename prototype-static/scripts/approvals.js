/* ============================================================
   Turing Agent 原型 · 多级审批状态机（工作台与看板共用）
   支持：会签（同级别全部审批人确认才推进）、串行级别、驳回、转办
   持久化记录：{ state, level, comment, time, approver, transfers }
   state: pending | approved | rejected | returned
   level: 0 起，表示「前 level 个级别已完成」（pending 时指向当前级别）
   ============================================================ */
"use strict";

const ApprovalEngine = (() => {
  /* 卡片定义 → 渲染视图（应用已存记录：状态/级别推进/转办改名） */
  function viewOf(card) {
    const levels = card.levels || [{ name: "审批", approvers: card.approvers }];
    const rec = TaStore.getApprovals()[card.id];
    if (!rec) {
      return { state: "pending", level: 0, comment: "", levels };
    }
    const transfers = rec.transfers || {};
    const approvers = levels.map((lv, li) => ({
      ...lv,
      approvers: lv.approvers.map((a) => {
        const renamed = transfers[a.who] ? { ...a, who: transfers[a.who], transferred: true } : { ...a };
        if (rec.state === "approved") return { ...renamed, state: "done", time: a.time || rec.time };
        if (rec.state === "rejected") return li === (rec.level ?? 0) ? { ...renamed, state: "rejected" } : renamed;
        if (li < (rec.level ?? 0)) return { ...renamed, state: "done", time: rec.time };
        return renamed;
      }),
    }));
    return { state: rec.state, level: rec.level ?? 0, comment: rec.comment || "", levels: approvers };
  }

  /* 当前待处理级别（-1 = 无待处理） */
  function currentLevel(card) {
    const v = viewOf(card);
    if (v.state !== "pending" || v.level >= v.levels.length) return -1;
    return v.level;
  }

  function save(card, rec) {
    TaStore.setApproval(card.id, { state: "pending", level: 0, comment: "", time: "", approver: "", transfers: {}, ...rec });
  }

  /* 确认当前级别（会签）：本级别全部待审批人置为已确认；推进级别；全部完成 → approved */
  function approve(card, by) {
    const v = viewOf(card);
    const level = Math.max(0, currentLevel(card));
    const nextLevel = level + 1;
    const state = nextLevel >= v.levels.length ? "approved" : "pending";
    save(card, { state, level: nextLevel, comment: v.comment, time: now(), approver: by });
    return { state, level: nextLevel, total: v.levels.length };
  }

  function reject(card, by, comment) {
    const v = viewOf(card);
    save(card, { state: "rejected", level: v.level, comment: comment || "", time: now(), approver: by });
    return { state: "rejected" };
  }

  function returnForEdit(card, by, comment) {
    const v = viewOf(card);
    save(card, { state: "returned", level: v.level, comment: comment || "", time: now(), approver: by });
    return { state: "returned" };
  }

  /* 转办：把指定审批人替换为另一人（留痕） */
  function transfer(card, from, to) {
    const rec = TaStore.getApprovals()[card.id] || {};
    save(card, { ...rec, transfers: { ...(rec.transfers || {}), [from]: to } });
  }

  return { viewOf, currentLevel, approve, reject, returnForEdit, transfer };
})();
