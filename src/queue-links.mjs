export function queueBase(currentHref, saved, cloud) {
  const current = new URL(currentHref);
  current.hash = "";
  current.search = "";
  current.pathname = current.pathname.replace(/\/index\.html$/, "/");
  if (!current.pathname.endsWith("/")) current.pathname += "/";
  // A hosted queue always uses its own project directory. Saved local LAN
  // addresses or another app on the same GitHub Pages origin cannot override it.
  if (cloud || !saved) return current.href;
  try {
    const url = new URL(saved);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return current.href;
    url.hash = "";
    url.search = "";
    return url.href;
  } catch { return current.href; }
}
