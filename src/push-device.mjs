export function pushDevice({ userAgent = "", platform = "", maxTouchPoints = 0, standalone = false } = {}) {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return { ios, android: /Android/i.test(userAgent), needsInstall: ios && !standalone, standalone };
}
export function appDirectory(href) {
  const url = new URL(".", href);
  url.search = ""; url.hash = "";
  return url;
}
export function applicationServerKey(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
export function normalizedTransferCode(value) { return value.toUpperCase().replace(/[\s-]/g, ""); }
