function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const DAY_MAP = new Map([
  ["domingo", "0"],
  ["domingos", "0"],
  ["segunda", "1"],
  ["segunda-feira", "1"],
  ["segundas", "1"],
  ["segundas-feiras", "1"],
  ["terca", "2"],
  ["terca-feira", "2"],
  ["tercas", "2"],
  ["tercas-feiras", "2"],
  ["quarta", "3"],
  ["quarta-feira", "3"],
  ["quartas", "3"],
  ["quartas-feiras", "3"],
  ["quinta", "4"],
  ["quinta-feira", "4"],
  ["quintas", "4"],
  ["quintas-feiras", "4"],
  ["sexta", "5"],
  ["sexta-feira", "5"],
  ["sextas", "5"],
  ["sextas-feiras", "5"],
  ["sabado", "6"],
  ["sabados", "6"]
]);

function parseClock(text) {
  const normalized = normalizeText(text);

  if (/\bmeia[- ]?noite\b/.test(normalized)) return { hour: 0, minute: 0 };
  if (/\bmeio[- ]?dia\b/.test(normalized)) return { hour: 12, minute: 0 };

  const explicit = normalized.match(/\b(?:as\s+)?(\d{1,2})\s*(?::|h)\s*(\d{1,2})?\b/);
  if (explicit) {
    const hour = Number(explicit[1]);
    const minute = explicit[2] === undefined || explicit[2] === "" ? 0 : Number(explicit[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }

  const hourOnly = normalized.match(/\b(?:as|para)\s+(\d{1,2})(?:\s*horas?)?\b/);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }

  return null;
}

function parseRelativeOrInterval(text) {
  const normalized = normalizeText(text);
  const relative = normalized.match(/\bdaqui\s+a\s+(\d+)\s*(segundos?|minutos?|horas?|dias?)\b/);
  if (relative) {
    const units = { segundo: "s", segundos: "s", minuto: "m", minutos: "m", hora: "h", horas: "h", dia: "d", dias: "d" };
    return { type: "once", schedule: `+${relative[1]}${units[relative[2]]}`, description: "horário relativo" };
  }

  const interval = normalized.match(/\ba\s+cada\s+(\d+)\s*(segundos?|minutos?|horas?|dias?)\b/);
  if (interval) {
    const units = { segundo: "s", segundos: "s", minuto: "m", minutos: "m", hora: "h", horas: "h", dia: "d", dias: "d" };
    return { type: "interval", schedule: `${interval[1]}${units[interval[2]]}`, description: "intervalo explícito" };
  }

  return null;
}

function parseDayOfWeek(text) {
  const normalized = normalizeText(text);

  if (/\b(?:segunda\s+a\s+sexta|dias?\s+uteis|de\s+segunda\s+a\s+sexta)\b/.test(normalized)) return "1-5";
  if (/\b(?:fins?\s+de\s+semana|sabados?\s+e\s+domingos?)\b/.test(normalized)) return "0,6";
  if (/\b(?:todo(?:s)?\s+(?:os\s+)?dias?|diariamente|cada\s+dia)\b/.test(normalized)) return "*";

  const found = [];
  for (const [name, value] of DAY_MAP.entries()) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(normalized)) found.push(value);
  }

  const unique = [...new Set(found)].sort((a, b) => Number(a) - Number(b));
  return unique.length ? unique.join(",") : null;
}

export function deriveScheduleExpectation(text) {
  const normalized = normalizeText(text);
  const relativeOrInterval = parseRelativeOrInterval(normalized);
  if (relativeOrInterval) return relativeOrInterval;

  if (/\b(?:amanha|depois\s+de\s+amanha|hoje\s+as)\b/.test(normalized)) {
    return { type: "once", schedule: null, description: "execução única em data futura" };
  }

  const clock = parseClock(normalized);
  const dayOfWeek = parseDayOfWeek(normalized);
  if (clock && dayOfWeek !== null) {
    const schedule = `0 ${clock.minute} ${clock.hour} * * ${dayOfWeek}`;
    return {
      type: "cron",
      schedule,
      description: dayOfWeek === "*"
        ? `todos os dias às ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`
        : `às ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")} nos dias ${dayOfWeek}`
    };
  }

  if (/\b(?:de\s+hora\s+em\s+hora|a\s+cada\s+hora|toda\s+hora)\b/.test(normalized)) {
    return { type: "cron", schedule: "0 0 * * * *", description: "a cada hora" };
  }

  if (/\b(?:diariamente|todo(?:s)?\s+(?:os\s+)?dias?)\b/.test(normalized)) {
    return { type: "cron", schedule: null, description: "recorrência diária sem horário extraível" };
  }

  return null;
}

export function normalizeCronFieldCount(schedule) {
  const raw = String(schedule || "").trim().replace(/\s+/g, " ");
  const fields = raw ? raw.split(" ") : [];
  if (fields.length === 5) return `0 ${raw}`;
  return raw;
}

export function validateScheduleToolInput(input, expectation = null) {
  const action = String(input?.action || "").toLowerCase();
  if (!["add", "update"].includes(action)) return { ok: true };

  const type = String(input?.type || "cron").toLowerCase();
  const schedule = String(input?.schedule || "").trim().replace(/\s+/g, " ");

  if (type === "cron" && schedule) {
    const fields = schedule.split(" ");
    if (fields.length === 5) {
      return {
        ok: false,
        correctedSchedule: normalizeCronFieldCount(schedule),
        reason: `Cron com 5 campos não é aceito. Inclua segundos como primeiro campo. Use: ${normalizeCronFieldCount(schedule)}`
      };
    }
    if (fields.length !== 6) {
      return {
        ok: false,
        reason: `Cron deve ter exatamente 6 campos na ordem segundo minuto hora dia-do-mês mês dia-da-semana; foram recebidos ${fields.length}.`
      };
    }
  }

  if (!expectation) return { ok: true };

  if (expectation.type && type !== expectation.type) {
    return {
      ok: false,
      correctedType: expectation.type,
      correctedSchedule: expectation.schedule || undefined,
      reason: `Tipo de agendamento incompatível com o pedido. Use type='${expectation.type}'${expectation.schedule ? ` e schedule='${expectation.schedule}'` : ""}.`
    };
  }

  if (expectation.schedule && schedule !== expectation.schedule) {
    return {
      ok: false,
      correctedType: expectation.type,
      correctedSchedule: expectation.schedule,
      reason: `Agenda divergente do horário solicitado. Use exatamente schedule='${expectation.schedule}' (ordem: segundo minuto hora dia-do-mês mês dia-da-semana).`
    };
  }

  return { ok: true };
}
