import crypto from "node:crypto";
import { deriveScheduleExpectation } from "./cron-policy.js";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripCommand(text, command) {
  return String(text || "").replace(new RegExp(`^\\s*/${command}\\b\\s*`, "i"), "").trim();
}

const ADD_COMMAND = /^\s*\/(?:agendar|agenda|lembrete|remind|schedule)\b/i;
const NOW_COMMAND = /^\s*\/(?:agora|executar-agora|now)\b/i;

const EXPLICIT_ADD = [
  /\b(?:agende|agendar|agenda|programe|programar|calendarize|calendarizar)\b/,
  /\b(?:crie|criar|cadastre|cadastrar|configure|configurar)\s+(?:uma?\s+)?(?:nova?\s+)?(?:tarefa|rotina|lembrete|agendamento)(?:\s+agendad[ao])?\b/,
  /\b(?:lembre|lembra|recorde)(?:-me|\s+me)?\b/,
  /\b(?:me\s+)?(?:avise|notifique|alerte)(?:-me)?\b/,
  /\b(?:deixe|mantenha)\s+(?:isso|esta|essa|a\s+tarefa)?\s*agendad[ao]\b/,
  /\bmarque\s+(?:isso\s+)?para\b/
];

const MANAGE_PATTERNS = {
  remove: /\b(?:remova|remover|apague|apagar|exclua|excluir|cancele|cancelar)\b.*\b(?:tarefa|agendamento|lembrete|rotina)\b|\b(?:tarefa|agendamento|lembrete|rotina)\b.*\b(?:remova|remover|apague|apagar|exclua|excluir|cancele|cancelar)\b/,
  disable: /\b(?:desative|desativar|pause|pausar|suspenda|suspender)\b.*\b(?:tarefa|agendamento|lembrete|rotina)\b|\b(?:tarefa|agendamento|lembrete|rotina)\b.*\b(?:desative|desativar|pause|pausar|suspenda|suspender)\b/,
  enable: /\b(?:ative|ativar|reative|reativar|retome|retomar)\b.*\b(?:tarefa|agendamento|lembrete|rotina)\b|\b(?:tarefa|agendamento|lembrete|rotina)\b.*\b(?:ative|ativar|reative|reativar|retome|retomar)\b/,
  update: /\b(?:altere|alterar|atualize|atualizar|mude|mudar|edite|editar)\b.*\b(?:tarefa|agendamento|lembrete|rotina)\b|\b(?:tarefa|agendamento|lembrete|rotina)\b.*\b(?:altere|alterar|atualize|atualizar|mude|mudar|edite|editar)\b/,
  cleanup: /\b(?:limpe|limpar)\b.*\b(?:tarefas|agendamentos|lembretes)\b/,
  list: /\b(?:liste|listar|mostre|mostrar|consulte|consultar|ver|quais|status)\b.*\b(?:tarefas|agendamentos|lembretes|rotinas)\b|\b(?:tarefas|agendamentos|lembretes|rotinas)\b.*\b(?:existem|ativas|agendadas|cadastradas)\b/
};

const ACTION_VERB = /\b(?:pesquise|pesquisar|busque|buscar|procure|procurar|verifique|verificar|consulte|consultar|analise|analisar|resuma|resumir|gere|gerar|envie|enviar|execute|executar|rode|rodar|faca|fazer|prepare|preparar|acompanhe|acompanhar|monitore|monitorar)\b/;
const RECURRENCE = /\b(?:a\s+cada\s+\d+\s*(?:segundos?|minutos?|horas?|dias?|semanas?)|todo(?:s)?\s+(?:os\s+)?dias?|toda(?:s)?\s+(?:as\s+)?semanas?|todo(?:s)?\s+(?:os\s+)?meses?|diariamente|semanalmente|mensalmente|de\s+hora\s+em\s+hora|aos?\s+(?:domingos?|segundas?(?:-feiras?)?|tercas?(?:-feiras?)?|quartas?(?:-feiras?)?|quintas?(?:-feiras?)?|sextas?(?:-feiras?)?|sabados?))\b/;
const FUTURE_TIME = /\b(?:amanha|depois\s+de\s+amanha|daqui\s+a\s+\d+\s*(?:segundos?|minutos?|horas?|dias?|semanas?)|em\s+\d+\s*(?:segundos?|minutos?|horas?|dias?|semanas?)|para\s+(?:hoje|amanha)?\s*(?:as\s+)?\d{1,2}(?::\d{2}|h(?:\d{2})?)?|as\s+\d{1,2}(?::\d{2}|h(?:\d{2})?))\b/;

function manageIntent(normalized) {
  const actions = ["list"];
  if (MANAGE_PATTERNS.remove.test(normalized)) actions.push("remove");
  else if (MANAGE_PATTERNS.disable.test(normalized)) actions.push("disable");
  else if (MANAGE_PATTERNS.enable.test(normalized)) actions.push("enable");
  else if (MANAGE_PATTERNS.update.test(normalized)) actions.push("update");
  else if (MANAGE_PATTERNS.cleanup.test(normalized)) actions.push("cleanup");
  else if (!MANAGE_PATTERNS.list.test(normalized)) return null;
  return [...new Set(actions)];
}

export function classifyScheduleIntent(input, options = {}) {
  const originalText = String(input || "").trim();
  const normalized = normalize(originalText);

  if (options.forceList || normalized === "/tarefas") {
    return {
      mode: "manage",
      allowedActions: ["list"],
      cleanedText: originalText,
      reason: "comando explícito de listagem"
    };
  }

  if (NOW_COMMAND.test(originalText)) {
    return {
      mode: "none",
      allowedActions: [],
      cleanedText: stripCommand(originalText, "(?:agora|executar-agora|now)"),
      reason: "execução imediata forçada por comando"
    };
  }

  if (ADD_COMMAND.test(originalText)) {
    return {
      mode: "add",
      allowedActions: ["add", "list"],
      cleanedText: originalText.replace(ADD_COMMAND, "").trim(),
      reason: "comando explícito de agendamento"
    };
  }

  const managementActions = manageIntent(normalized);
  if (managementActions) {
    return {
      mode: "manage",
      allowedActions: managementActions,
      cleanedText: originalText,
      reason: "gestão explícita de tarefas agendadas"
    };
  }

  if (EXPLICIT_ADD.some((pattern) => pattern.test(normalized))) {
    return {
      mode: "add",
      allowedActions: ["add", "list"],
      cleanedText: originalText,
      reason: "verbo explícito de agendamento ou lembrete"
    };
  }

  // Uma ação combinada com recorrência ou horário futuro também representa
  // solicitação explícita de execução futura, mesmo sem a palavra "agendar".
  if (ACTION_VERB.test(normalized) && (RECURRENCE.test(normalized) || FUTURE_TIME.test(normalized))) {
    return {
      mode: "add",
      allowedActions: ["add", "list"],
      cleanedText: originalText,
      reason: "ação solicitada para horário futuro ou recorrência explícita"
    };
  }

  return {
    mode: "none",
    allowedActions: [],
    cleanedText: originalText,
    reason: "nenhuma solicitação explícita de agendamento"
  };
}

export function createScheduleAuthorization(intent, ttlMs, originalText = "") {
  const now = Date.now();
  const scheduleExpectation = intent.mode === "add" || intent.allowedActions?.includes("update")
    ? deriveScheduleExpectation(originalText || intent.cleanedText || "")
    : null;

  return {
    version: 2,
    token: crypto.randomUUID(),
    mode: intent.mode,
    allowedActions: [...intent.allowedActions],
    reason: intent.reason,
    originalText: String(originalText || intent.cleanedText || "").slice(0, 4000),
    scheduleExpectation,
    issuedAt: now,
    expiresAt: now + Math.max(10_000, Number(ttlMs) || 900_000)
  };
}

export function buildScheduleDirective(intent, authorization) {
  const header = [
    "[CONTROLE DE AGENDAMENTO DO GATEWAY]",
    `Token: ${authorization.token}`,
    `Modo: ${intent.mode}`,
    `Ações schedule_prompt permitidas: ${intent.allowedActions.length ? intent.allowedActions.join(", ") : "nenhuma"}`
  ];

  if (intent.mode === "add") {
    header.push(
      "O usuário solicitou explicitamente uma execução futura ou recorrente.",
      "Use schedule_prompt action=add somente para o agendamento pedido nesta mensagem.",
      "Não transforme pesquisas, análises ou subtarefas adicionais em novos agendamentos."
    );
    if (authorization.scheduleExpectation) {
      header.push(`Tipo esperado: ${authorization.scheduleExpectation.type}.`);
      if (authorization.scheduleExpectation.schedule) {
        header.push(`Agenda obrigatória: ${authorization.scheduleExpectation.schedule}.`);
        header.push("Para cron, a ordem é: segundo minuto hora dia-do-mês mês dia-da-semana.");
      }
    }
  } else if (intent.mode === "manage") {
    header.push(
      "O usuário solicitou gestão de agendamentos existentes.",
      "Use somente as ações schedule_prompt listadas como permitidas; não crie uma nova tarefa."
    );
  } else {
    header.push(
      "O usuário NÃO solicitou criação nem gestão de tarefa agendada.",
      "É proibido chamar schedule_prompt nesta execução.",
      "Execute a pesquisa, análise, consulta ou outra solicitação imediatamente e devolva o resultado agora.",
      "Palavras como pesquisar, buscar, analisar, verificar, notícias, hoje ou tarefa não autorizam agendamento por si só."
    );
  }

  return `${header.join("\n")}\n[/CONTROLE DE AGENDAMENTO DO GATEWAY]`;
}
