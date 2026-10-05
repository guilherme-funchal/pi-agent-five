import fs from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";

const scheduleFile = "/workspace/.pi/schedule-prompts.json";

function removeSessionFields(value) {
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) changed = removeSessionFields(item) || changed;
    return changed;
  }
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "session")) {
    delete value.session;
    changed = true;
  }
  for (const child of Object.values(value)) changed = removeSessionFields(child) || changed;
  return changed;
}

export async function makeAllSchedulesShared() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await fs.readFile(scheduleFile, "utf8");
      const json = JSON.parse(raw);
      if (!removeSessionFields(json)) return false;
      const temp = `${scheduleFile}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(scheduleFile), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(json, null, 2) + "\n", { mode: 0o600 });
      await fs.rename(temp, scheduleFile);
      log.info("Tarefas convertidas para escopo compartilhado", { scheduleFile });
      return true;
    } catch (error) {
      if (attempt === 4) {
        log.warn("Não foi possível ajustar o escopo das tarefas", { error: error.message });
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  return false;
}
