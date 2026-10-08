const key = "campus.visitor.v1";
const cookieName = "ritm.visitor.v1";
const valid = value => typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);

export function readVisitor(storage, cookie = "") {
  const stored = storage.get(key);
  if (valid(stored)) return stored;
  const backup = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return valid(backup) ? backup : null;
}
export function visitorCookie(token, href) {
  if (!valid(token)) throw new Error("Некорректный талон браузера.");
  const url = new URL(".", href);
  return `${cookieName}=${token}; Path=${url.pathname}; Max-Age=31536000; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`;
}
