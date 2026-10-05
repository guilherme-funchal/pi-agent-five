import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VALID_MODES = new Set(["text", "voice", "both"]);

export function normalizeResponseMode(value, fallback = "text") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["off", "false", "0", "texto", "text"].includes(normalized)) return "text";
  if (["voice", "audio", "áudio", "voz", "only", "somente"].includes(normalized)) return "voice";
  if (["on", "true", "1", "both", "ambos", "texto+audio", "texto+áudio"].includes(normalized)) return "both";
  return VALID_MODES.has(normalized) ? normalized : fallback;
}

export function describeResponseMode(mode) {
  const normalized = normalizeResponseMode(mode, "text");
  if (normalized === "voice") return "somente áudio";
  if (normalized === "both") return "texto e áudio";
  return "somente texto";
}

export function voiceOneShotMode(config) {
  return normalizeResponseMode(
    config.tts.voiceCommandMode,
    config.tts.sendTextWithAudio ? "both" : "voice"
  );
}

function removeNaturalVoiceDirective(text) {
  const patterns = [
    /(?:,|\s)+(?:e\s+)?(?:responda|responder|retorne|retornar|envie|enviar|fale|falar)(?:\s+(?:a\s+resposta|o\s+resultado|o\s+resumo))?\s+(?:em|por|como)\s+(?:áudio|audio|voz)(?:\.|!|\?)?\s*$/iu,
    /(?:,|\s)+(?:com\s+)?resposta\s+(?:em|por)\s+(?:áudio|audio|voz)(?:\.|!|\?)?\s*$/iu,
    /(?:,|\s)+em\s+formato\s+de\s+(?:áudio|audio|voz)(?:\.|!|\?)?\s*$/iu
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { cleanedText: text.replace(pattern, "").trim(), explicit: true };
    }
  }
  return { cleanedText: text, explicit: false };
}

export function parseResponseModeRequest(text, currentMode, config) {
  const original = String(text || "").trim();
  const lower = original.toLowerCase();

  if (/^\/(?:modo_voz|modovoz)(?:@\w+)?(?:\s|$)/iu.test(original)) {
    const value = original.replace(/^\/(?:modo_voz|modovoz)(?:@\w+)?\s*/iu, "").trim();
    if (!value || ["status", "estado"].includes(value.toLowerCase())) {
      return { kind: "status", cleanedText: "", mode: currentMode, persist: false, explicit: true };
    }
    const mode = normalizeResponseMode(value, "");
    if (!mode) {
      return { kind: "invalid", cleanedText: "", mode: currentMode, persist: false, explicit: true };
    }
    return { kind: "set", cleanedText: "", mode, persist: true, explicit: true };
  }

  if (/^\/tts(?:@\w+)?(?:\s|$)/iu.test(original)) {
    return { kind: "tts_status", cleanedText: "", mode: currentMode, persist: false, explicit: true };
  }

  if (/^\/voz(?:@\w+)?(?:\s|$)/iu.test(original)) {
    const cleanedText = original.replace(/^\/voz(?:@\w+)?\s*/iu, "").trim();
    return {
      kind: cleanedText ? "request" : "usage",
      cleanedText,
      mode: voiceOneShotMode(config),
      persist: false,
      explicit: true
    };
  }

  if (/^\/texto(?:@\w+)?(?:\s|$)/iu.test(original)) {
    const cleanedText = original.replace(/^\/texto(?:@\w+)?\s*/iu, "").trim();
    return {
      kind: cleanedText ? "request" : "usage_text",
      cleanedText,
      mode: "text",
      persist: false,
      explicit: true
    };
  }

  const natural = removeNaturalVoiceDirective(original);
  if (natural.explicit) {
    return {
      kind: natural.cleanedText ? "request" : "usage",
      cleanedText: natural.cleanedText,
      mode: voiceOneShotMode(config),
      persist: false,
      explicit: true
    };
  }

  return {
    kind: "request",
    cleanedText: original,
    mode: normalizeResponseMode(currentMode, config.tts.defaultMode),
    persist: false,
    explicit: false
  };
}

export function detectScheduledAudioRequest(text, fallbackMode, config) {
  const value = String(text || "");
  const explicit = [
    /(?:resultado|resposta|resumo|alerta|notificação|notificacao).{0,50}(?:em|por|como)\s+(?:áudio|audio|voz)/iu,
    /(?:envie|enviar|mande|mandar|notifique|notificar).{0,70}(?:áudio|audio|voz)/iu,
    /(?:tarefa|agendamento).{0,70}(?:áudio|audio|voz)/iu
  ].some((pattern) => pattern.test(value));
  if (explicit) return voiceOneShotMode(config);
  return normalizeResponseMode(fallbackMode, "text");
}

export class ResponseModeStore {
  constructor(filePath, defaultMode = "text") {
    this.filePath = filePath;
    this.defaultMode = normalizeResponseMode(defaultMode, "text");
    this.cache = null;
    this.writeChain = Promise.resolve();
  }

  key(platform, targetId) {
    return `${String(platform || "unknown")}:${String(targetId || "unknown")}`;
  }

  async load() {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.cache = parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.cache = {};
    }
    return this.cache;
  }

  async get(platform, targetId) {
    const data = await this.load();
    return normalizeResponseMode(data[this.key(platform, targetId)]?.mode, this.defaultMode);
  }

  async set(platform, targetId, mode) {
    const normalized = normalizeResponseMode(mode, this.defaultMode);
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.load();
      data[this.key(platform, targetId)] = {
        mode: normalized,
        updatedAt: new Date().toISOString()
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    });
    await this.writeChain;
    return normalized;
  }
}
