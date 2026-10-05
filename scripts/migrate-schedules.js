import fs from "node:fs";
import path from "node:path";

const filename = process.env.PI_SCHEDULE_FILE || "/workspace/.pi/schedule-prompts.json";
if (!fs.existsSync(filename)) {
  console.log("[entrypoint] Nenhuma tarefa existente para migrar");
  process.exit(0);
}

const mode = String(process.env.SCHEDULE_EXECUTION_MODE || "subagent").toLowerCase() === "inline"
  ? "inline"
  : "subagent";
const provider = process.env.PI_PROVIDER || "local-llama";
const model = process.env.PI_MODEL || "Qwen3.5-9B-Q4_K_M.gguf";
const scheduleModel = process.env.PI_SCHEDULE_MODEL || `${provider}/${model}`;
const extensions = String(
  process.env.PI_SCHEDULE_EXTENSIONS ||
  "pi-web-access,pi-subagents,pi-memory"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const store = JSON.parse(fs.readFileSync(filename, "utf8"));
const jobs = Array.isArray(store.jobs) ? store.jobs : [];
let changed = 0;
for (const job of jobs) {
  let jobChanged = false;
  if (Object.hasOwn(job, "session")) {
    delete job.session;
    jobChanged = true;
  }
  if (mode === "subagent") {
    if (job.model !== scheduleModel) {
      job.model = scheduleModel;
      jobChanged = true;
    }
    if (job.notify !== false) {
      job.notify = false;
      jobChanged = true;
    }
    if (JSON.stringify(job.extensions || []) !== JSON.stringify(extensions)) {
      job.extensions = extensions;
      jobChanged = true;
    }
  } else {
    for (const field of ["model", "notify", "extensions", "skills"]) {
      if (Object.hasOwn(job, field)) {
        delete job[field];
        jobChanged = true;
      }
    }
  }
  if (jobChanged) changed += 1;
}

if (changed > 0) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filename);
}
console.log(`[entrypoint] Tarefas migradas: ${changed}/${jobs.length}; mode=${mode}; model=${mode === "subagent" ? scheduleModel : "inline"}`);
