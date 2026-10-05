#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

if ((process.env.ALLOW_NATIVE_MESSENGER_BRIDGE || "false").toLowerCase() === "true") {
  process.exit(0);
}

const target = path.join(process.env.HOME || "/home/pi", ".pi", "msg-bridge.json");
let config = {};
try {
  config = JSON.parse(fs.readFileSync(target, "utf8"));
} catch {
  config = {};
}
config.autoConnect = false;
config.showWidget = false;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
