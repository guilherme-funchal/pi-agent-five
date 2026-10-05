export function splitText(text, size) {
  const value = String(text || "").trim();
  if (!value) return ["(sem conteúdo)"];
  if (value.length <= size) return [value];

  const chunks = [];
  let rest = value;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < Math.floor(size * 0.5)) cut = rest.lastIndexOf(" ", size);
    if (cut < Math.floor(size * 0.5)) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function extractText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function extractAssistantError(message) {
  if (!message || message.role !== "assistant") return "";
  if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
    return message.errorMessage.trim();
  }
  if (message.stopReason === "error") {
    return `O provedor encerrou a resposta com stopReason=error (${message.provider || "provedor desconhecido"}/${message.model || "modelo desconhecido"})`;
  }
  return "";
}

export function extractToolResultText(result) {
  if (!result) return "";
  const content = result.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

export function redactSecrets(text) {
  return String(text || "")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[TOKEN_TELEGRAM_OCULTO]")
    .replace(/\b(?:xox[baprs]-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}\b/g, "[SEGREDO_OCULTO]");
}

export function escapeTelegramHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(text) {
  let value = escapeTelegramHtml(text);

  // Conversão deliberadamente conservadora para evitar erros de entidades
  // do Telegram com Markdown arbitrário produzido pelo modelo.
  value = value.replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, (_match, code) => `<pre>${code.trim()}</pre>`);
  value = value.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  value = value.replace(/^#{1,6}\s+(.+)$/gm, (_match, title) => `<b>${title.replace(/\*\*/g, "")}</b>`);
  value = value.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  value = value.replace(/^\s*[-*]\s+/gm, "• ");

  return value;
}

const WEEKDAYS_PT = {
  "0": "domingo",
  "1": "segunda-feira",
  "2": "terça-feira",
  "3": "quarta-feira",
  "4": "quinta-feira",
  "5": "sexta-feira",
  "6": "sábado",
  "7": "domingo"
};

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function describeWeekdayField(field) {
  if (!field || field === "*") return "todos os dias";

  const names = [];
  for (const part of String(field).split(",")) {
    if (/^\d$/.test(part) && WEEKDAYS_PT[part]) {
      names.push(WEEKDAYS_PT[part]);
      continue;
    }
    const range = part.match(/^(\d)-(\d)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start <= end) {
        for (let day = start; day <= end; day += 1) {
          const name = WEEKDAYS_PT[String(day)];
          if (name) names.push(name);
        }
        continue;
      }
    }
    return `dias da semana ${field}`;
  }

  const unique = [...new Set(names)];
  if (unique.length === 1) return `toda ${unique[0]}`;
  if (unique.length > 1) return unique.join(", ");
  return `dias da semana ${field}`;
}

export function describeSchedule(args = {}) {
  const type = String(args.type || "cron").toLowerCase();
  const schedule = String(args.schedule || "").trim();

  if (!schedule) return "agenda não informada";
  if (type === "once") return `execução única (${schedule})`;
  if (type === "interval") return `a cada ${schedule}`;
  if (type !== "cron") return `${type}: ${schedule}`;

  const fields = schedule.split(/\s+/);
  if (fields.length !== 6) return `cron ${schedule}`;

  const [, minute, hour, dayOfMonth, month, weekday] = fields;
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute) && dayOfMonth === "*" && month === "*") {
    const time = `${twoDigits(hour)}:${twoDigits(minute)}`;
    if (weekday === "*") return `todos os dias, às ${time}`;
    return `${describeWeekdayField(weekday)}, às ${time}`;
  }

  return `cron ${schedule}`;
}

export function extractScheduleId(resultText) {
  const value = String(resultText || "");
  const patterns = [
    /\b(?:id|task\s*id|schedule\s*id)\s*[:=]\s*["']?([A-Za-z0-9_-]{4,})/i,
    /\b([A-Za-z0-9_-]{8,})\b/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return "";
}

