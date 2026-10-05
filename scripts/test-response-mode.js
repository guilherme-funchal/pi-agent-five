import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResponseModeStore,
  detectScheduledAudioRequest,
  parseResponseModeRequest
} from "../src/response-mode.js";
import { ScheduleDeliveryStore } from "../src/schedule-delivery-store.js";

const config = {
  tts: {
    defaultMode: "text",
    voiceCommandMode: "both",
    sendTextWithAudio: true
  }
};

let parsed = parseResponseModeRequest("/voz Explique o Pi Agent", "text", config);
assert.equal(parsed.kind, "request");
assert.equal(parsed.mode, "both");
assert.equal(parsed.cleanedText, "Explique o Pi Agent");

parsed = parseResponseModeRequest("Pesquise notícias e responda em áudio", "text", config);
assert.equal(parsed.mode, "both");
assert.equal(parsed.cleanedText, "Pesquise notícias");

parsed = parseResponseModeRequest("/modo_voz audio", "text", config);
assert.equal(parsed.kind, "set");
assert.equal(parsed.mode, "voice");

parsed = parseResponseModeRequest("/texto Liste as tarefas", "both", config);
assert.equal(parsed.mode, "text");
assert.equal(parsed.cleanedText, "Liste as tarefas");

assert.equal(
  detectScheduledAudioRequest(
    "Agende para amanhã e envie o resultado em áudio",
    "text",
    config
  ),
  "both"
);
assert.equal(
  detectScheduledAudioRequest("Agende para amanhã e envie um resumo", "text", config),
  "text"
);

const directory = await mkdtemp(join(tmpdir(), "pi-response-mode-test-"));
try {
  const responseStore = new ResponseModeStore(join(directory, "responses.json"), "text");
  assert.equal(await responseStore.get("telegram", "123"), "text");
  await responseStore.set("telegram", "123", "both");
  assert.equal(await responseStore.get("telegram", "123"), "both");

  const scheduleStore = new ScheduleDeliveryStore(join(directory, "schedules.json"));
  assert.equal(await scheduleStore.get("job-1"), "text");
  await scheduleStore.set("job-1", "voice", { name: "teste" });
  assert.equal(await scheduleStore.get("job-1"), "voice");
  await scheduleStore.remove("job-1");
  assert.equal(await scheduleStore.get("job-1"), "text");
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("Testes de modo de resposta: OK");
