import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeResponseMode } from "./response-mode.js";

export class ScheduleDeliveryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.cache = null;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.cache = parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.cache = {};
    }
    return this.cache;
  }

  async get(jobId) {
    const data = await this.load();
    return normalizeResponseMode(data[String(jobId)]?.mode, "text");
  }

  async set(jobId, mode, metadata = {}) {
    if (!jobId) return;
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.load();
      data[String(jobId)] = {
        mode: normalizeResponseMode(mode, "text"),
        ...metadata,
        updatedAt: new Date().toISOString()
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    });
    await this.writeChain;
  }

  async remove(jobId) {
    if (!jobId) return;
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.load();
      delete data[String(jobId)];
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    });
    await this.writeChain;
  }
}
