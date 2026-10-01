import { createApp } from "./app.mjs";
const { app, store } = createApp();
const port = Number(process.env.PORT) || 3001;
const server = app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`Queue API: http://localhost:${port}`),
);
const shutdown = () =>
  server.close(() => {
    store.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
