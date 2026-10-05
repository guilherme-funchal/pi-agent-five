import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} terminou com código ${code}: ${stderr.trim()}`));
    });
  });
}

function replaceUrls(text) {
  return text.replace(/https?:\/\/\S+/giu, " link disponível na mensagem ");
}

export function cleanTextForSpeech(text) {
  return replaceUrls(String(text || ""))
    .replace(/```[\s\S]*?```/g, " Trecho de código disponível na mensagem de texto. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[>*_~|]/g, " ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export async function synthesizeSpeech({ text, config }) {
  if (!config.tts.enabled) throw new Error("TTS está desabilitado neste agente.");

  const cleaned = cleanTextForSpeech(text);
  const truncated = cleaned.length > config.tts.maxChars;
  const spokenText = cleaned.slice(0, config.tts.maxChars).trim();
  if (!spokenText) throw new Error("Não existe texto utilizável para gerar o áudio.");

  const directory = await mkdtemp(join(tmpdir(), "pi-tts-"));
  const wavPath = join(directory, "resposta.wav");
  const oggPath = join(directory, "resposta.ogg");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.tts.timeoutMs);
    let response;
    try {
      const url = `${config.tts.baseUrl.replace(/\/$/, "")}${config.tts.synthesisPath}`;
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spokenText,
          voice: config.tts.voice,
          length_scale: config.tts.lengthScale,
          noise_scale: config.tts.noiseScale,
          noise_w_scale: config.tts.noiseWScale
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Piper retornou HTTP ${response.status}: ${body.slice(0, 1000)}`);
    }

    const wav = Buffer.from(await response.arrayBuffer());
    if (wav.length < 44) throw new Error("Piper retornou um arquivo WAV vazio ou inválido.");
    await writeFile(wavPath, wav);

    await execute("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", wavPath,
      "-vn", "-ac", "1", "-ar", "48000",
      "-c:a", "libopus", "-b:a", String(config.tts.opusBitrate),
      "-application", "voip",
      oggPath
    ]);

    // Confirma que a conversão realmente produziu conteúdo antes de devolver.
    const ogg = await readFile(oggPath);
    if (ogg.length < 100) throw new Error("FFmpeg não produziu um áudio OGG válido.");

    return {
      filePath: oggPath,
      fileName: "resposta.ogg",
      spokenText,
      truncated,
      cleanup: async () => {
        if (!config.tts.keepTemporaryFiles) {
          await rm(directory, { recursive: true, force: true });
        }
      }
    };
  } catch (error) {
    if (!config.tts.keepTemporaryFiles) {
      await rm(directory, { recursive: true, force: true });
    }
    if (error.name === "AbortError") {
      throw new Error(`Piper excedeu o timeout de ${config.tts.timeoutMs} ms.`);
    }
    throw error;
  }
}
