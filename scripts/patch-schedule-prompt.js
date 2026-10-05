import fs from "node:fs";

const candidates = [
  "/home/pi/.pi/agent/npm/node_modules/pi-schedule-prompt/src/scheduler.ts",
  "/opt/pi-seed/.pi/agent/npm/node_modules/pi-schedule-prompt/src/scheduler.ts"
];

const requested = Number.parseInt(
  process.env.SCHEDULE_SUBAGENT_OUTPUT_CHARS || process.env.MAX_RESPONSE_CHARS || "12000",
  10
);
const outputChars = Number.isFinite(requested)
  ? Math.max(500, Math.min(requested, 50000))
  : 12000;

for (const filename of candidates) {
  if (!fs.existsSync(filename)) continue;
  const before = fs.readFileSync(filename, "utf8");
  const after = before.replace(
    /const\s+SUBAGENT_OUTPUT_SNIPPET_LENGTH\s*=\s*\d+\s*;/,
    `const SUBAGENT_OUTPUT_SNIPPET_LENGTH = ${outputChars};`
  );
  if (after !== before) {
    fs.writeFileSync(filename, after);
    console.log(`[entrypoint] pi-schedule-prompt: limite do resultado do subagente ajustado para ${outputChars} caracteres`);
  } else {
    console.log(`[entrypoint] pi-schedule-prompt: limite do subagente já ajustado ou estrutura não reconhecida em ${filename}`);
  }
  break;
}
