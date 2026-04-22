import { createServer } from "node:http";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { createSocketServer } from "./socket.js";

const app = createApp();
const server = createServer(app);

createSocketServer(server);

server.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});
