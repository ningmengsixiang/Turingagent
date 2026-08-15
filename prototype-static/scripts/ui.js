/* ============================================================
   Turing Agent 原型 · 通用 UI 工具（两页共用）
   DOM 查询 / 转义 / 时间 / toast 反馈
   ============================================================ */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* —— toast：黑底白字，自动消退，最多同时 3 条 —— */
function toast(message, icon = "✓") {
  const stack = $("#toastStack");
  if (!stack) return;
  while (stack.children.length >= 3) stack.firstElementChild.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="t-icon" aria-hidden="true">${esc(icon)}</span><span>${esc(message)}</span>`;
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 320);
  }, 2400);
}

/* —— 文件体积格式化（演示用） —— */
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* —— 系统级通知（FR-DESK-03 模拟）：授权则用 Notification API，拒绝则降级 toast —— */
function notify(title, body) {
  if (!("Notification" in window)) {
    toast(`${title} · ${body}`, "🔔");
    return;
  }
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: "ta-demo" });
    } catch {
      /* ignore */
    }
    return;
  }
  if (Notification.permission === "denied") {
    toast(`${title} · ${body}`, "🔔");
    return;
  }
  Notification.requestPermission().then((p) => {
    if (p === "granted") {
      try {
        new Notification(title, { body, tag: "ta-demo" });
      } catch {
        /* ignore */
      }
    } else {
      toast(`${title} · ${body}`, "🔔");
    }
  });
}
