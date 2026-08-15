/* ============================================================
   Turing Agent 原型 · 登录页交互
   表单登录 / 快速体验（演示登录为张敏）/ 忘记密码 / 企业 SSO（演示）
   登录成功写入 ta.session，跳转工作台
   ============================================================ */
"use strict";

function doLogin(name = "张敏", source = "表单登录") {
  TaStore.setSession({ name, at: now() });
  TaStore.addAudit({ type: "system", action: "登录", target: `${name} · macOS 客户端`, actor: name });
  toast(`欢迎回来，${name}`, "✓");
  setTimeout(() => {
    location.href = "index.html";
  }, 500);
}

/* 已登录直接进入工作台 */
if (TaStore.getSession()) {
  location.replace("index.html");
} else {
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    const pass = $("#loginPass").value;
    if (!email || !pass) {
      toast("请输入企业邮箱与密码", "⚠");
      return;
    }
    doLogin();
  });

  $("#demoBtn").addEventListener("click", () => doLogin("张敏", "快速体验"));

  $("#forgotLink").addEventListener("click", () => toast("演示环境 · 请联系企业管理员重置（演示）", "ℹ"));
  $("#ssoLink").addEventListener("click", () => toast("企业 SSO 集成演示：钉钉 / 企业微信 / OIDC", "ℹ"));

  /* Enter 快捷提交 */
  $("#loginPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#loginForm").requestSubmit();
  });
}
