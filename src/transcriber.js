import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} terminou com código ${code}: ${stderr.trim() || "sem detalhes"}`));
    });
  });
}

function inputExtension(fileName, mimeType) {
  const suffix = extname(String(fileName || "")).toLowerCase();
  if (suffix && suffix.length <= 8) return suffix;
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("webm")) return ".webm";
  return ".audio";
}

async function downloadTelegramFile({ bot, fileId, maxBytes }) {
  const fileUrl = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar áudio do Telegram: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw new Error(`O áudio ultrapassa o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error(`O áudio ultrapassa o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  return bytes;
}

async function convertToWav(inputPath, outputPath) {
  await execute("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    outputPath
  ]);
}

function parseTranscript(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed.trim();
    return String(
      parsed.text ?? parsed.transcription ?? parsed.result ?? parsed.data?.text ?? ""
    ).trim();
  } catch {
    return value;
  }
}

async function requestWhisper({ wavPath, speech }) {
  const wav = await readFile(wavPath);
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", speech.responseFormat || "json");
  form.append("language", speech.language || "pt");
  form.append("no_timestamps", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), speech.timeoutMs);
  try {
    const url = `${speech.baseUrl.replace(/\/$/, "")}${speech.inferencePath.startsWith("/") ? "" : "/"}${speech.inferencePath}`;
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Whisper retornou HTTP ${response.status}: ${raw.slice(0, 1000)}`);
    }
    const transcript = parseTranscript(raw);
    if (!transcript) throw new Error("O Whisper terminou sem produzir uma transcrição.");
    return transcript;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`A transcrição excedeu ${Math.round(speech.timeoutMs / 1000)} segundos.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeTelegramAudio({
  bot,
  fileId,
  fileName,
  mimeType,
  declaredFileSize,
  config
}) {
  const maxBytes = config.telegram.audioMaxBytes;
  if (declaredFileSize && Number(declaredFileSize) > maxBytes) {
    throw new Error(`O áudio ultrapassa o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }

  const directory = await mkdtemp(join(tmpdir(), `${config.agentId}-telegram-audio-`));
  const inputPath = join(directory, `entrada${inputExtension(fileName, mimeType)}`);
  const wavPath = join(directory, "audio.wav");

  try {
    const input = await downloadTelegramFile({ bot, fileId, maxBytes });
    await writeFile(inputPath, input, { mode: 0o600 });
    await convertToWav(inputPath, wavPath);
    return await requestWhisper({ wavPath, speech: config.speech });
  } finally {
    if (!config.speech.keepTemporaryFiles) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
