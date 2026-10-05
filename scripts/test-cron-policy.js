import assert from "node:assert/strict";
import { deriveScheduleExpectation, normalizeCronFieldCount, validateScheduleToolInput } from "../src/cron-policy.js";

const cases = [
  ["Agende notícias todos os dias às 07:30", { type: "cron", schedule: "0 30 7 * * *" }],
  ["Pesquise toda quinta-feira às 17:50", { type: "cron", schedule: "0 50 17 * * 4" }],
  ["Execute de segunda a sexta às 9h", { type: "cron", schedule: "0 0 9 * * 1-5" }],
  ["Lembre-me daqui a 20 minutos", { type: "once", schedule: "+20m" }],
  ["Verifique a cada 2 horas", { type: "interval", schedule: "2h" }]
];

for (const [text, expected] of cases) {
  const actual = deriveScheduleExpectation(text);
  assert.equal(actual?.type, expected.type, text);
  assert.equal(actual?.schedule, expected.schedule, text);
}

assert.equal(normalizeCronFieldCount("30 7 * * *"), "0 30 7 * * *");

const expectation = deriveScheduleExpectation("Agende notícias todos os dias às 07:30");
const invalid = validateScheduleToolInput({ action: "add", type: "cron", schedule: "30 7 * * * *" }, expectation);
assert.equal(invalid.ok, false);
assert.equal(invalid.correctedSchedule, "0 30 7 * * *");

const valid = validateScheduleToolInput({ action: "add", type: "cron", schedule: "0 30 7 * * *" }, expectation);
assert.equal(valid.ok, true);

console.log("cron-policy: testes aprovados");
