/**
 * 前端演示登录（固定账号）。与 login.html 共用。
 */
(function (global) {
  const STORAGE = "weekly_auth";
  const DISPLAY = "weekly_user_display";
  const VALID_USER = "ZLXK";
  const VALID_PASS = "123456";
  const DEFAULT_NAME = "中绿讯科";

  global.WEEKLY_AUTH = {
    STORAGE,
    DISPLAY,
    DEFAULT_NAME,
    /** 清除前端演示账号相关缓存（登录态 + 是否已刷新过数据的本地标记） */
    clearAppCache() {
      sessionStorage.removeItem(STORAGE);
      sessionStorage.removeItem(DISPLAY);
      try {
        global.localStorage?.removeItem("weekly_article_sync_v1");
      } catch {
        /* ignore */
      }
    },
    isLoggedIn() {
      return sessionStorage.getItem(STORAGE) === "1";
    },
    validate(username, password) {
      return String(username || "").trim() === VALID_USER && String(password || "") === VALID_PASS;
    },
    login(displayName) {
      sessionStorage.setItem(STORAGE, "1");
      sessionStorage.setItem(DISPLAY, displayName || DEFAULT_NAME);
    },
    logout() {
      this.clearAppCache();
      global.location.href = "login.html";
    },
    getDisplayName() {
      return sessionStorage.getItem(DISPLAY) || DEFAULT_NAME;
    },
    redirectIfNotLoggedIn() {
      if (!this.isLoggedIn()) {
        global.location.replace("login.html");
        return false;
      }
      return true;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
