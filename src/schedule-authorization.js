import fs from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";

export class ScheduleAuthorizationStore {
  constructor(filename, enabled = true) {
    this.filename = filename;
    this.enabled = enabled;
  }

  async write(authorization) {
    if (!this.enabled) return;
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temp = `${this.filename}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(authorization, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.filename);
    log.info("Autorização de agendamento preparada", {
      mode: authorization.mode,
      allowedActions: authorization.allowedActions,
      expiresAt: authorization.expiresAt
    });
  }

  async clear(expectedToken = null) {
    if (!this.enabled) return;
    if (expectedToken) {
      try {
        const current = JSON.parse(await fs.readFile(this.filename, "utf8"));
        if (current.token !== expectedToken) return;
      } catch (error) {
        if (error.code === "ENOENT") return;
      }
    }
    await fs.rm(this.filename, { force: true });
  }
}
