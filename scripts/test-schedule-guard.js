import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-schedule-guard-"));
const authorizationFile = path.join(directory, "authorization.json");
process.env.SCHEDULE_AUTH_FILE = authorizationFile;
process.env.SCHEDULE_INTENT_GUARD = "true";
process.env.SCHEDULE_CRON_GUARD = "true";
process.env.PI_CRON_POLICY_MODULE = pathToFileURL(path.resolve("src/cron-policy.js")).href;

const { default: installGuard } = await import("../extensions/schedule-intent-guard.ts");
let toolCallHandler = null;
installGuard({
  on(event, handler) {
    if (event === "tool_call") toolCallHandler = handler;
  }
});
assert.equal(typeof toolCallHandler, "function");

const token = "test-token-123";
await fs.writeFile(authorizationFile, JSON.stringify({
  token,
  expiresAt: Date.now() + 60_000,
  allowedActions: ["add", "list"],
  scheduleExpectation: { type: "cron", schedule: "0 30 7 * * *" }
}));

const authorizedContext = {
  sessionManager: {
    buildContextEntries: () => [{ role: "user", content: `Token: ${token}` }]
  }
};
const unauthorizedContext = {
  sessionManager: {
    buildContextEntries: () => [{ role: "user", content: "sem token" }]
  }
};

assert.equal(
  await toolCallHandler({
    toolName: "schedule_prompt",
    input: { action: "add", type: "cron", schedule: "0 30 7 * * *" }
  }, authorizedContext),
  undefined
);
const wrongCron = await toolCallHandler({
  toolName: "schedule_prompt",
  input: { action: "add", type: "cron", schedule: "30 7 * * * *" }
}, authorizedContext);
assert.equal(wrongCron.block, true);
assert.match(wrongCron.reason, /0 30 7 \* \* \*/);
assert.equal(
  (await toolCallHandler({ toolName: "schedule_prompt", input: { action: "add" } }, unauthorizedContext)).block,
  true
);
assert.equal(
  (await toolCallHandler({ toolName: "schedule_prompt", input: { action: "remove" } }, authorizedContext)).block,
  true
);
assert.equal(
  await toolCallHandler({ toolName: "web_search", input: {} }, unauthorizedContext),
  undefined
);

await fs.rm(directory, { recursive: true, force: true });
console.log("[test] Guardião schedule_prompt: autorização e bloqueio aprovados");
