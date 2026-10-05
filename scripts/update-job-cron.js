import fs from "node:fs";
import path from "node:path";
import { normalizeCronFieldCount } from "../src/cron-policy.js";

const [filenameArg, jobId, scheduleArg] = process.argv.slice(2);
if (!filenameArg || !jobId || !scheduleArg) {
  console.error("Uso: node scripts/update-job-cron.js <schedule-prompts.json> <jobId> '<cron>'");
  process.exit(2);
}

const filename = path.resolve(filenameArg);
const schedule = normalizeCronFieldCount(scheduleArg);
const fields = schedule.split(/\s+/);
if (fields.length !== 6) {
  console.error(`Cron inválido: esperado 6 campos, recebido ${fields.length}.`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(filename, "utf8"));
const job = Array.isArray(data.jobs) ? data.jobs.find((item) => item.id === jobId) : null;
if (!job) {
  console.error(`Job não encontrado: ${jobId}`);
  process.exit(1);
}

const backup = `${filename}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(filename, backup);
job.schedule = schedule;
delete job.nextRun;
fs.writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
console.log(`Job ${jobId} atualizado para ${schedule}`);
console.log(`Backup: ${backup}`);
