import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password, encoded) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded ?? "")) return false;
  const [salt, hash] = encoded.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}
export const newToken = () => randomBytes(32).toString("base64url");
export const newPassword = () => randomBytes(12).toString("base64url");
