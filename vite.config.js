import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/.local-access.txt",
        "**/data/**",
        "**/*.sqlite*",
        "**/server/**",
        "**/scripts/**",
        "**/tests/**",
      ],
    },
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
