#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const provider = env.PI_PROVIDER || "local-llama";
const model = env.PI_MODEL || "Qwen3.5-9B-Q4_K_M.gguf";
const baseUrl = env.PI_BASE_URL || "http://host.docker.internal:8001/v1";
const apiKey = env.PI_API_KEY || "local";
const contextWindow = Number.parseInt(env.PI_CONTEXT_WINDOW || "32768", 10);
const maxTokens = Number.parseInt(env.PI_MAX_TOKENS || "4096", 10);

const config = {
  providers: {
    [provider]: {
      baseUrl,
      apiKey,
      api: "openai-completions",
      models: [
        {
          id: model,
          name: model,
          reasoning: false,
          input: ["text"],
          contextWindow,
          maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
      ]
    }
  }
};

const target = path.join(process.env.HOME || "/home/pi", ".pi", "agent", "models.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`[entrypoint] models.json gerado para ${provider}/${model} em ${baseUrl}`);
