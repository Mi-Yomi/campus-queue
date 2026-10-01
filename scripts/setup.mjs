import { existsSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { networkInterfaces } from "node:os";

if (existsSync(".env")) {
  console.log("Настройки .env уже существуют. Пароль не изменён.");
} else {
  const password = randomBytes(12).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((x) => x.family === "IPv4" && !x.internal)
    .map((x) => x.address);
  const origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    ...addresses.flatMap((ip) => [`http://${ip}:5173`, `http://${ip}:3001`]),
  ];
  writeFileSync(
    ".env",
    `HOST=0.0.0.0\nPORT=3001\nDATABASE_PATH=./data/queue.sqlite\nADMIN_PASSWORD_HASH=${hash}\nALLOWED_ORIGINS=${origins.join(",")}\nVITE_API_URL=\nTRUST_PROXY_HOPS=0\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    ".local-access.txt",
    `Локальная админ-панель: http://localhost:5173/#/admin\nЛогин: admin\nПароль: ${password}\n\nНе публикуйте этот файл. Начальный хеш пароля находится в .env; существующие аккаунты хранятся в SQLite.\n`,
    { mode: 0o600 },
  );
  console.log(
    "Готово. Пароль администратора сохранён в .local-access.txt (не попадает в Git).",
  );
}
