function csv(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function csvWithFallback(primary, fallback) {
  const normalizedPrimary = String(primary ?? "").trim();
  return csv(normalizedPrimary || fallback);
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function number(value, fallback) {
  const parsed = Number(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "on"].includes(String(value).toLowerCase());
}

function scheduleMode(value) {
  return String(value || "subagent").toLowerCase() === "inline" ? "inline" : "subagent";
}

const provider = process.env.PI_PROVIDER || "local-llama";
const model = process.env.PI_MODEL || "Qwen3.5-9B-Q4_K_M.gguf";

export const config = {
  agentId: process.env.AGENT_ID || process.env.PI_SESSION_NAME || "agent",
  port: integer(process.env.PORT || process.env.HTTP_PORT, 8080),
  timezone: process.env.TZ || "America/Sao_Paulo",
  logLevel: process.env.LOG_LEVEL || "info",
  pi: {
    provider,
    model,
    baseUrl: process.env.PI_BASE_URL || "http://host.docker.internal:8001/v1",
    thinking: process.env.PI_THINKING || "off",
    sessionName: process.env.PI_SESSION_NAME || process.env.AGENT_ID || "agent",
    sessionDir: "/home/pi/.pi/agent/sessions",
    cwd: "/workspace",
    timeoutMs: integer(process.env.PI_REQUEST_TIMEOUT_MS, 600000),
    startupTimeoutMs: integer(process.env.PI_RPC_STARTUP_TIMEOUT_MS, 60000),
    readyWaitTimeoutMs: integer(process.env.PI_RPC_READY_WAIT_TIMEOUT_MS, 90000),
    probeTimeoutMs: integer(process.env.PI_RPC_PROBE_TIMEOUT_MS, 5000),
    probeIntervalMs: integer(process.env.PI_RPC_PROBE_INTERVAL_MS, 500),
    autoRestart: bool(process.env.PI_RPC_AUTO_RESTART, true),
    restartBaseMs: integer(process.env.PI_RPC_RESTART_BASE_MS, 1000),
    restartMaxMs: integer(process.env.PI_RPC_RESTART_MAX_MS, 30000),
    taskRetries: integer(process.env.PI_RPC_TASK_RETRIES, 2)
  },
  schedule: {
    executionMode: scheduleMode(process.env.SCHEDULE_EXECUTION_MODE),
    model: process.env.PI_SCHEDULE_MODEL || `${provider}/${model}`,
    extensions: String(
      process.env.PI_SCHEDULE_EXTENSIONS ||
      "pi-web-access,pi-subagents,pi-memory"
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    startNotification: bool(process.env.SCHEDULE_START_NOTIFICATION, true),
    delayWarningMs: integer(process.env.SCHEDULE_DELAY_WARNING_MS, 30000),
    outputChars: integer(
      process.env.SCHEDULE_SUBAGENT_OUTPUT_CHARS || process.env.MAX_RESPONSE_CHARS,
      12000
    ),
    intentGuard: bool(process.env.SCHEDULE_INTENT_GUARD, true),
    authorizationFile: process.env.SCHEDULE_AUTH_FILE || "/data/schedule-intent-authorization.json",
    authorizationTtlMs: integer(process.env.SCHEDULE_AUTH_TTL_MS, 900000),
    deliveryFile: process.env.SCHEDULE_DELIVERY_FILE || "/data/schedule-delivery.json"
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedChatIds: csv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    notifyChatIds: csvWithFallback(process.env.TELEGRAM_NOTIFY_CHAT_IDS, process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    chunkSize: integer(process.env.TELEGRAM_CHUNK_SIZE, 3900),
    audioEnabled: bool(process.env.TELEGRAM_AUDIO_ENABLED, true),
    audioShowTranscript: bool(process.env.TELEGRAM_AUDIO_SHOW_TRANSCRIPT, true),
    audioAcceptDocuments: bool(process.env.TELEGRAM_AUDIO_ACCEPT_DOCUMENTS, true),
    audioMaxBytes: integer(process.env.TELEGRAM_AUDIO_MAX_MB, 20) * 1024 * 1024,
    audioMaxDurationSeconds: integer(process.env.TELEGRAM_AUDIO_MAX_DURATION_SECONDS, 600)
  },
  speech: {
    baseUrl: process.env.WHISPER_BASE_URL || "http://whisper:8080",
    inferencePath: process.env.WHISPER_INFERENCE_PATH || "/inference",
    language: process.env.WHISPER_LANGUAGE || "pt",
    timeoutMs: integer(process.env.WHISPER_TIMEOUT_MS, 300000),
    responseFormat: process.env.WHISPER_RESPONSE_FORMAT || "json",
    keepTemporaryFiles: bool(process.env.WHISPER_KEEP_TEMP_FILES, false)
  },
  tts: {
    enabled: bool(process.env.TELEGRAM_TTS_ENABLED ?? process.env.TTS_ENABLED, true),
    baseUrl: process.env.TTS_BASE_URL || "http://piper:5000",
    synthesisPath: process.env.TTS_SYNTHESIS_PATH || "/synthesize",
    voice: process.env.TTS_VOICE || "pt_BR-jeff-medium",
    timeoutMs: integer(process.env.TTS_TIMEOUT_MS, 300000),
    maxChars: integer(process.env.TTS_MAX_CHARS, 5000),
    lengthScale: number(process.env.TTS_LENGTH_SCALE ?? process.env.TTS_SPEED, 1.0),
    noiseScale: number(process.env.TTS_NOISE_SCALE, 0.667),
    noiseWScale: number(process.env.TTS_NOISE_W_SCALE, 0.8),
    opusBitrate: process.env.TTS_OPUS_BITRATE || "32k",
    sendTextWithAudio: bool(process.env.TTS_SEND_TEXT_WITH_AUDIO, true),
    defaultMode: process.env.TTS_DEFAULT_MODE || "text",
    voiceCommandMode: process.env.TTS_VOICE_COMMAND_MODE || "both",
    responseModeFile: process.env.TTS_RESPONSE_MODE_FILE || "/data/response-modes.json",
    keepTemporaryFiles: bool(process.env.TTS_KEEP_TEMP_FILES, false)
  },
  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    allowedUserIds: csv(process.env.DISCORD_ALLOWED_USER_IDS),
    allowedChannelIds: csv(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
    notifyChannelIds: csvWithFallback(process.env.DISCORD_NOTIFY_CHANNEL_IDS, process.env.DISCORD_ALLOWED_CHANNEL_IDS),
    requireMention: bool(process.env.DISCORD_REQUIRE_MENTION, true),
    chunkSize: integer(process.env.DISCORD_CHUNK_SIZE, 1900)
  },
  maxResponseChars: integer(process.env.MAX_RESPONSE_CHARS, 12000),
  apiToken: process.env.API_TOKEN || ""
};
