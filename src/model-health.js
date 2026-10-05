import { log } from "./logger.js";

function modelsUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, "")}/models`;
}

function serverRoot(baseUrl) {
  return String(baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSlots(baseUrl, timeoutMs) {
  const url = `${serverRoot(baseUrl)}/slots`;
  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    if (!response.ok) {
      log.warn("Endpoint de slots do modelo não disponível", { url, status: response.status });
      return null;
    }
    const slots = await response.json();
    if (!Array.isArray(slots)) return null;
    const idle = slots.filter((slot) => slot?.is_processing === false).length;
    const processing = slots.filter((slot) => slot?.is_processing === true).length;
    log.info("Slots do llama.cpp detectados", {
      url,
      total: slots.length,
      idle,
      processing
    });
    return { total: slots.length, idle, processing };
  } catch (error) {
    log.warn("Não foi possível consultar /slots", {
      url,
      error: error.name === "AbortError" ? `Timeout após ${timeoutMs} ms` : error.message
    });
    return null;
  }
}

export async function checkModelEndpoint(baseUrl, timeoutMs = 10000) {
  const url = modelsUrl(baseUrl);
  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const slots = await checkSlots(baseUrl, Math.min(timeoutMs, 5000));
    log.info("Endpoint do modelo acessível", { url, slots: slots?.total || null });
    return { ok: true, url, slots };
  } catch (error) {
    const message = error.name === "AbortError"
      ? `Timeout após ${timeoutMs} ms`
      : error.message;
    log.error("Endpoint do modelo indisponível", {
      url,
      error: message,
      hint: "Dentro do Docker, use host.docker.internal em vez de 127.0.0.1/localhost para acessar o host."
    });
    return { ok: false, url, error: message, slots: null };
  }
}
