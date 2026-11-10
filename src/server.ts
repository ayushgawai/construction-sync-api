import { createServer } from "node:http";
import { createApp } from "./app.js";
const { app, hub, watcher } = createApp();
const server = createServer(app);
hub.attach(server);
watcher.start(Number(process.env.POLL_MS || 30_000));
server.listen(Number(process.env.PORT || 4000), () => console.log(`construction-sync-api on :${process.env.PORT || 4000}`));
