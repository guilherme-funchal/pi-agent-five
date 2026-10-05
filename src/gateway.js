import {
  describeSchedule,
  extractAssistantError,
  extractScheduleId,
  extractText,
  extractToolResultText,
  redactSecrets
} from "./utils.js";
import { makeAllSchedulesShared } from "./schedule-store.js";
import { log } from "./logger.js";
import {
  buildScheduleDirective,
  classifyScheduleIntent,
  createScheduleAuthorization
} from "./schedule-intent.js";
import { ScheduleAuthorizationStore } from "./schedule-authorization.js";
import {
  ResponseModeStore,
  describeResponseMode,
  detectScheduledAudioRequest,
  parseResponseModeRequest
} from "./response-mode.js";
import { ScheduleDeliveryStore } from "./schedule-delivery-store.js";

const HELP = `Comandos disponíveis:\n/help ou /ajuda - mostra esta ajuda\n/status - estado do agente e agendamentos\n/tarefas - lista tarefas agendadas\n/parar - interrompe a execução atual\n/nova - inicia uma nova sessão\n/agendar <pedido> - força um agendamento explícito\n/agora <pedido> - força execução imediata\n/audio - estado da transcrição de voz\n/voz <pedido> - responde uma solicitação em áudio\n/texto <pedido> - responde uma solicitação somente em texto\n/modo_voz on|off|audio|both - define o modo padrão do chat\n/tts - estado da síntese de voz\n\nVocê pode enviar texto, mensagem de voz ou arquivo de áudio.\n\nExemplos:\n“Agende para amanhã às 9h uma verificação das notícias de segurança e envie o resultado em áudio.”\n“/voz Explique como funciona a memória do Pi Agent.”`;

function lastUnique(items) {
  const values = items.map((item) => String(item || "").trim()).filter(Boolean);
  return [...new Set(values)].at(-1) || "";
}

function formatDateTime(timestamp, timezone) {
  if (!timestamp) return "não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(timestamp));
}

function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function isRpcAvailabilityError(error) {
  return new Set([
    "PI_RPC_UNAVAILABLE",
    "PI_RPC_READY_TIMEOUT",
    "PI_RPC_EXITED",
    "PI_RPC_STOPPING"
  ]).has(error?.code);
}

function customMessageDetails(message) {
  if (!message || typeof message !== "object") return null;
  const customType = message.customType || message.custom_type || message.type;
  if (customType !== "scheduled_prompt") return null;
  const details = message.details || message.metadata?.details || {};
  return {
    mode: details.mode || "inline_start",
    jobId: String(details.jobId || details.job_id || "sem-id"),
    jobName: String(details.jobName || details.job_name || "tarefa agendada"),
    prompt: String(details.prompt || ""),
    model: String(details.model || ""),
    output: String(details.output || extractText(message) || ""),
    error: String(details.error || "")
  };
}

export class Gateway {
  constructor(pi, notifier, config) {
    this.pi = pi;
    this.notifier = notifier;
    this.config = config;
    this.queue = [];
    this.dispatched = null;
    this.run = null;
    this.scheduleCalls = new Map();
    this.lastState = null;
    this.startedAt = Date.now();

    // Fila de disparos inline que aguardam o agente principal encerrar o turno atual.
    this.pendingInlineSchedules = [];
    // Execuções independentes iniciadas pela extensão em modo subagente.
    this.subagentScheduleRuns = new Map();
    this.seenScheduledMarkers = new Map();
    this.lastScheduleMetrics = null;
    this.scheduleAuthorization = new ScheduleAuthorizationStore(
      config.schedule.authorizationFile,
      config.schedule.intentGuard
    );
    this.responseModes = new ResponseModeStore(
      config.tts.responseModeFile,
      config.tts.defaultMode
    );
    this.scheduleDeliveries = new ScheduleDeliveryStore(
      config.schedule.deliveryFile
    );

    pi.on("event", (event) => this.#handlePiEvent(event));
    pi.on("ready", () => {
      log.info("Gateway detectou Pi RPC pronto");
      void this.#dispatchNext();
    });
    pi.on("exit", (details) => {
      void this.#handlePiExit(details);
    });
  }

  async accept(origin) {
    const command = origin.text.trim().toLowerCase();
    if (["/help", "/ajuda", "/start"].includes(command)) {
      await origin.reply(HELP);
      return;
    }
    if (command === "/status") {
      await origin.reply(this.statusText());
      return;
    }
    if (command === "/parar") {
      await this.pi.abort();
      await origin.reply("Execução interrompida.");
      return;
    }
    if (command === "/nova") {
      if (this.dispatched || this.run) {
        await origin.reply("O agente está ocupado. Use /parar antes de iniciar uma nova sessão.");
        return;
      }
      await this.pi.newSession();
      await origin.reply("Nova sessão iniciada. As tarefas agendadas continuam persistidas no projeto.");
      return;
    }

    origin.replyFinal ||= (message) => origin.reply(message);
    const savedResponseMode = await this.responseModes.get(origin.platform, origin.targetId);
    const responseRequest = parseResponseModeRequest(origin.text, savedResponseMode, this.config);

    if (responseRequest.kind === "status") {
      await origin.reply([
        `Modo de resposta deste ${origin.platform === "telegram" ? "chat" : "canal"}: ${describeResponseMode(savedResponseMode)}`,
        "Use /modo_voz on para texto e áudio, /modo_voz audio para somente áudio ou /modo_voz off para somente texto."
      ].join("\n"));
      return;
    }
    if (responseRequest.kind === "tts_status") {
      await origin.reply([
        `TTS: ${this.config.tts.enabled ? "habilitado" : "desabilitado"}`,
        `Modo atual: ${describeResponseMode(savedResponseMode)}`,
        `Piper: ${this.config.tts.baseUrl}${this.config.tts.synthesisPath}`,
        `Voz: ${this.config.tts.voice}`,
        `Limite falado: ${this.config.tts.maxChars} caracteres`
      ].join("\n"));
      return;
    }
    if (responseRequest.kind === "set") {
      const saved = await this.responseModes.set(origin.platform, origin.targetId, responseRequest.mode);
      await origin.reply(`Modo de resposta alterado para: ${describeResponseMode(saved)}.`);
      return;
    }
    if (responseRequest.kind === "invalid") {
      await origin.reply("Modo inválido. Use /modo_voz on, off, audio, both ou status.");
      return;
    }
    if (responseRequest.kind === "usage") {
      await origin.reply("Uso: /voz <solicitação>. Exemplo: /voz Explique como funciona o Pi Agent.");
      return;
    }
    if (responseRequest.kind === "usage_text") {
      await origin.reply("Uso: /texto <solicitação>. Exemplo: /texto Liste as tarefas agendadas.");
      return;
    }

    let originalText = responseRequest.cleanedText;
    let intent = classifyScheduleIntent(originalText);
    if (command === "/tarefas") {
      originalText = "Liste as tarefas agendadas, incluindo id, nome, agenda, estado e próxima execução.";
      intent = classifyScheduleIntent(originalText, { forceList: true });
    }

    const authorization = createScheduleAuthorization(intent, this.config.schedule.authorizationTtlMs, intent.cleanedText || originalText);
    const directive = buildScheduleDirective(intent, authorization);
    const prompt = `${directive}

SOLICITAÇÃO ORIGINAL DO USUÁRIO:
${intent.cleanedText || originalText}`;

    log.info("Intenção de agendamento classificada", {
      mode: intent.mode,
      allowedActions: intent.allowedActions,
      reason: intent.reason,
      platform: origin.platform
    });

    const responseMode = responseRequest.mode;
    const scheduledDeliveryMode = intent.mode === "add"
      ? detectScheduledAudioRequest(origin.text, responseMode, this.config)
      : "text";

    this.queue.push({
      origin,
      prompt,
      originalText,
      responseMode,
      scheduledDeliveryMode,
      scheduleIntent: intent,
      scheduleAuthorization: authorization,
      queuedAt: Date.now(),
      rpcRetries: 0,
      processingNoticeSent: false,
      requeuedAfterExit: false
    });
    if (this.dispatched || this.run) {
      await origin.reply(`Pedido recebido e colocado na fila. Posição: ${this.queue.length}.`);
    }
    await this.#dispatchNext();
  }

  async #dispatchNext() {
    if (this.dispatched || this.run || this.queue.length === 0) return;
    this.dispatched = this.queue.shift();
    const current = this.dispatched;
    current.requeuedAfterExit = false;

    try {
      if (!current.processingNoticeSent) {
        current.processingNoticeSent = true;
        await current.origin.reply("⏳ Solicitação recebida. O agente está processando.");
      } else {
        await current.origin.reply("🔄 Pi RPC recuperado. Retomando a tarefa pendente.");
      }

      await this.scheduleAuthorization.write(current.scheduleAuthorization);
      await this.pi.prompt(current.prompt);
      current.requeuedAfterExit = false;
    } catch (error) {
      // O evento exit pode ter reencaminhado o mesmo item antes desta Promise rejeitar.
      if (current.requeuedAfterExit || this.dispatched !== current) return;

      this.dispatched = null;
      await this.scheduleAuthorization.clear(current.scheduleAuthorization?.token);
      log.error("Falha ao enviar prompt ao Pi", {
        error: error.message,
        code: error.code || null,
        rpcStatus: this.pi.status()
      });

      if (isRpcAvailabilityError(error) && current.rpcRetries < this.config.pi.taskRetries) {
        current.rpcRetries += 1;
        current.requeuedAfterExit = true;
        this.queue.unshift(current);
        await current.origin.reply([
          "⚠️ O processo Pi RPC está reiniciando.",
          `O pedido foi preservado na fila e será retomado automaticamente (tentativa ${current.rpcRetries}/${this.config.pi.taskRetries}).`
        ].join("\n"));
        return;
      }

      await current.origin.reply([
        "❌ Não foi possível iniciar a tarefa.",
        `Erro: ${error.message}`,
        "Consulte os logs procurando por “Pi RPC terminou” e “Reinicialização do Pi RPC agendada”."
      ].join("\n"));
      await this.#dispatchNext();
    }
  }

  async #handlePiExit(details) {
    const current = this.dispatched;
    const interruptedRun = this.run;
    this.run = null;
    this.dispatched = null;
    await this.scheduleAuthorization.clear(current?.scheduleAuthorization?.token);

    if (current && !current.requeuedAfterExit) {
      if (current.rpcRetries < this.config.pi.taskRetries) {
        current.rpcRetries += 1;
        current.requeuedAfterExit = true;
        this.queue.unshift(current);
        await current.origin.reply([
          "⚠️ A execução foi interrompida porque o Pi RPC reiniciou.",
          `O pedido continuará automaticamente após a recuperação (tentativa ${current.rpcRetries}/${this.config.pi.taskRetries}).`
        ].join("\n"));
      } else {
        await current.origin.reply([
          "❌ A tarefa foi interrompida após várias reinicializações do Pi RPC.",
          `Código de saída: ${details?.code ?? "não informado"}`,
          "Verifique os logs do contêiner antes de tentar novamente."
        ].join("\n"));
      }
    } else if (interruptedRun?.kind === "scheduled") {
      await this.notifier.sendAll([
        "❌ Tarefa agendada interrompida",
        `Agente: ${this.config.agentId}`,
        interruptedRun.scheduled?.jobName ? `Tarefa: ${interruptedRun.scheduled.jobName}` : "",
        interruptedRun.scheduled?.jobId ? `ID: ${interruptedRun.scheduled.jobId}` : "",
        "Motivo: o processo Pi RPC foi reiniciado durante a execução.",
        "A próxima ocorrência permanece agendada."
      ].filter(Boolean).join("\n"));
    }
  }

  #startRun() {
    // Pi pode emitir vários agent_start para o mesmo pedido durante retry,
    // compactação ou continuação. Nunca recrie this.run aqui.
    if (this.run) {
      this.run.lowLevelRuns += 1;
      log.info("Nova tentativa/continuação Pi", {
        kind: this.run.kind,
        lowLevelRun: this.run.lowLevelRuns
      });
      return;
    }

    const scheduled = this.dispatched ? null : this.pendingInlineSchedules.shift() || null;
    const startedAt = Date.now();
    this.run = {
      kind: this.dispatched ? "interactive" : "scheduled",
      origin: this.dispatched?.origin || null,
      prompt: this.dispatched?.prompt || scheduled?.prompt || null,
      scheduleIntent: this.dispatched?.scheduleIntent || null,
      scheduleAuthorization: this.dispatched?.scheduleAuthorization || null,
      responseMode: this.dispatched?.responseMode || "text",
      scheduledDeliveryMode: this.dispatched?.scheduledDeliveryMode || "text",
      scheduled,
      texts: [],
      errors: [],
      schedules: [],
      lowLevelRuns: 1,
      startedAt
    };

    const queueDelayMs = scheduled ? startedAt - scheduled.firedAt : 0;
    log.info("Execução Pi iniciada", {
      kind: this.run.kind,
      jobId: scheduled?.jobId || null,
      jobName: scheduled?.jobName || null,
      scheduleQueueDelayMs: queueDelayMs
    });
  }

  #captureAssistant(message, source) {
    if (!this.run || message?.role !== "assistant") return;

    const text = extractText(message);
    if (text && this.run.texts.at(-1) !== text) this.run.texts.push(text);

    const error = extractAssistantError(message);
    if (error && this.run.errors.at(-1) !== error) {
      this.run.errors.push(error);
      log.warn("Resposta do modelo terminou com erro", {
        source,
        stopReason: message.stopReason,
        error
      });
    }
  }

  #captureAgentEnd(event) {
    if (!this.run) return;
    for (const message of event.messages || []) {
      this.#captureAssistant(message, "agent_end");
    }
    if (event.willRetry) {
      log.warn("Pi fará nova tentativa automática", {
        kind: this.run.kind,
        lowLevelRun: this.run.lowLevelRuns
      });
    }
  }

  #scheduledMarkerKey(details) {
    return `${details.mode}:${details.jobId}:${details.output.slice(0, 120)}:${details.error.slice(0, 120)}`;
  }

  #isDuplicateScheduledMarker(details) {
    const key = this.#scheduledMarkerKey(details);
    const now = Date.now();
    const previous = this.seenScheduledMarkers.get(key) || 0;
    this.seenScheduledMarkers.set(key, now);

    // Limpeza simples para impedir crescimento ilimitado.
    if (this.seenScheduledMarkers.size > 200) {
      for (const [candidate, timestamp] of this.seenScheduledMarkers) {
        if (now - timestamp > 10 * 60 * 1000) this.seenScheduledMarkers.delete(candidate);
      }
    }
    return now - previous < 3000;
  }

  async #captureScheduledMarker(message, source) {
    const details = customMessageDetails(message);
    if (!details || this.#isDuplicateScheduledMarker(details)) return;

    const now = Date.now();
    log.info("Evento de tarefa agendada", {
      source,
      mode: details.mode,
      jobId: details.jobId,
      jobName: details.jobName,
      model: details.model || null,
      outputChars: details.output.length,
      error: details.error || null
    });

    if (details.mode === "subagent_start") {
      const record = { ...details, firedAt: now };
      const queue = this.subagentScheduleRuns.get(details.jobId) || [];
      queue.push(record);
      this.subagentScheduleRuns.set(details.jobId, queue);
      if (this.config.schedule.startNotification) {
        await this.notifier.sendAll([
          "⏰ Tarefa agendada disparada",
          `Agente: ${this.config.agentId}`,
          `Tarefa: ${details.jobName}`,
          `ID: ${details.jobId}`,
          `Horário: ${formatDateTime(now, this.config.timezone)}`,
          `Modo: subagente independente`,
          details.model ? `Modelo: ${details.model}` : ""
        ].filter(Boolean).join("\n"));
      }
      return;
    }

    if (details.mode === "subagent_done" || details.mode === "subagent_error") {
      const queue = this.subagentScheduleRuns.get(details.jobId) || [];
      const record = queue.shift() || { ...details, firedAt: now };
      if (queue.length > 0) this.subagentScheduleRuns.set(details.jobId, queue);
      else this.subagentScheduleRuns.delete(details.jobId);

      const durationMs = now - record.firedAt;
      const failed = details.mode === "subagent_error";
      const body = failed
        ? details.error || details.output || "A tarefa terminou com erro sem detalhes."
        : details.output || "A tarefa terminou sem conteúdo de texto.";
      const warning = durationMs >= this.config.schedule.delayWarningMs
        ? `⚠️ Tempo acima do limite configurado de ${formatDuration(this.config.schedule.delayWarningMs)}.`
        : "";

      const deliveryMode = failed ? "text" : await this.scheduleDeliveries.get(details.jobId);
      await this.notifier.sendAllResponse([
        failed ? "❌ Falha em tarefa agendada" : "✅ Resultado de tarefa agendada",
        `Agente: ${this.config.agentId}`,
        `Tarefa: ${details.jobName}`,
        `ID: ${details.jobId}`,
        `Disparada em: ${formatDateTime(record.firedAt, this.config.timezone)}`,
        `Concluída em: ${formatDateTime(now, this.config.timezone)}`,
        `Duração total: ${formatDuration(durationMs)}`,
        warning,
        "",
        redactSecrets(body).slice(0, this.config.maxResponseChars)
      ].filter((line) => line !== "").join("\n"), deliveryMode);

      this.lastScheduleMetrics = {
        jobId: details.jobId,
        jobName: details.jobName,
        mode: "subagent",
        firedAt: record.firedAt,
        startedAt: record.firedAt,
        finishedAt: now,
        queueDelayMs: 0,
        durationMs,
        failed
      };
      return;
    }

    // Marcador inline. A extensão o publica no momento do disparo, mas o prompt
    // pode aguardar como followUp até o turno atual terminar.
    const record = { ...details, firedAt: now, mode: "inline" };
    this.pendingInlineSchedules.push(record);
    if (this.config.schedule.startNotification) {
      const waiting = Boolean(this.run || this.dispatched);
      await this.notifier.sendAll([
        "⏰ Tarefa agendada disparada",
        `Agente: ${this.config.agentId}`,
        `Tarefa: ${details.jobName}`,
        `ID: ${details.jobId}`,
        `Horário: ${formatDateTime(now, this.config.timezone)}`,
        "Modo: inline",
        waiting ? "Estado: aguardando o turno atual terminar" : "Estado: iniciando"
      ].join("\n"));
    }
  }

  #handlePiEvent(event) {
    switch (event.type) {
      case "agent_start":
        this.#startRun();
        break;

      case "message_start":
        void this.#captureScheduledMarker(event.message, "message_start");
        break;

      case "message_end":
        void this.#captureScheduledMarker(event.message, "message_end");
        this.#captureAssistant(event.message, "message_end");
        break;

      case "turn_end":
        void this.#captureScheduledMarker(event.message, "turn_end");
        this.#captureAssistant(event.message, "turn_end");
        break;

      case "agent_end":
        for (const message of event.messages || []) {
          void this.#captureScheduledMarker(message, "agent_end");
        }
        this.#captureAgentEnd(event);
        break;

      case "message_update": {
        if (!this.run) break;
        const update = event.assistantMessageEvent;
        if (update?.type === "error") {
          const error = update.errorMessage || update.error || event.message?.errorMessage || "Erro durante a geração da resposta";
          if (this.run.errors.at(-1) !== String(error)) this.run.errors.push(String(error));
        }
        break;
      }

      case "auto_retry_start":
        if (this.run && event.errorMessage) this.run.errors.push(String(event.errorMessage));
        log.warn("Retry automático iniciado", {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage
        });
        break;

      case "auto_retry_end":
        if (this.run && event.success === false && event.finalError) {
          this.run.errors.push(String(event.finalError));
        }
        log.info("Retry automático finalizado", {
          success: event.success,
          attempt: event.attempt,
          finalError: event.finalError
        });
        break;

      case "tool_execution_start":
        if (event.toolName === "schedule_prompt") {
          this.scheduleCalls.set(event.toolCallId, event.args || {});
        }
        break;

      case "tool_execution_end":
        void this.#handleToolEnd(event);
        break;

      case "agent_settled":
        void this.#finishRun();
        break;

      case "extension_ui_request":
        this.#handleUiRequest(event);
        break;

      case "extension_error": {
        const error = event.error || "Erro desconhecido de extensão";
        if (this.run) this.run.errors.push(`Extensão: ${error}`);
        log.error("Erro de extensão Pi", event);
        break;
      }

      case "response":
        if (event.command === "get_state" && event.success) this.lastState = event.data;
        break;

      default:
        break;
    }
  }

  async #handleToolEnd(event) {
    if (event.toolName !== "schedule_prompt") return;
    const args = this.scheduleCalls.get(event.toolCallId) || event.args || {};
    this.scheduleCalls.delete(event.toolCallId);

    if (args.action === "remove" && !event.isError) {
      await this.scheduleDeliveries.remove(args.id || args.jobId || args.job_id);
      return;
    }
    if (args.action !== "add") return;

    if (event.isError) {
      const blockedDetails = extractToolResultText(event.result);
      log.warn("Criação de agendamento bloqueada ou falhou", {
        reason: blockedDetails || "sem detalhes",
        intentMode: this.run?.scheduleIntent?.mode || null
      });
      return;
    }

    await makeAllSchedulesShared();

    const result = extractToolResultText(event.result);
    const schedule = {
      ok: !event.isError,
      id: extractScheduleId(result),
      name: args.name || "gerado automaticamente",
      rawSchedule: args.schedule || "não informada",
      interpretedSchedule: describeSchedule(args),
      type: args.type || "cron",
      timezone: this.config.timezone,
      prompt: args.prompt || "não informado",
      model: args.model || "inline",
      deliveryMode: this.run?.scheduledDeliveryMode || "text",
      details: result
    };

    if (this.run) this.run.schedules.push(schedule);
    if (schedule.id) {
      await this.scheduleDeliveries.set(schedule.id, schedule.deliveryMode, {
        name: schedule.name,
        agentId: this.config.agentId
      });
    }

    log.info("Resultado da ferramenta schedule_prompt", {
      ok: schedule.ok,
      id: schedule.id || null,
      name: schedule.name,
      schedule: schedule.rawSchedule,
      interpretedSchedule: schedule.interpretedSchedule,
      type: schedule.type,
      timezone: schedule.timezone,
      executionModel: schedule.model,
      deliveryMode: schedule.deliveryMode
    });

    await this.notifier.sendAllWithOrigin(
      this.#scheduleConfirmation(schedule, true),
      this.run?.origin || this.dispatched?.origin || null
    );
  }

  #scheduleConfirmation(schedule, includeAgent = false) {
    return [
      schedule.ok ? "✅ Tarefa agendada" : "❌ Falha ao criar tarefa",
      includeAgent ? `Agente: ${this.config.agentId}` : "",
      `Nome: ${schedule.name}`,
      schedule.id ? `ID: ${schedule.id}` : "",
      `Quando: ${schedule.interpretedSchedule}`,
      `Cron/agenda: ${schedule.rawSchedule}`,
      `Fuso: ${schedule.timezone}`,
      `Execução: ${schedule.model === "inline" ? "inline" : `subagente (${schedule.model})`}`,
      `Entrega: ${describeResponseMode(schedule.deliveryMode || "text")}`,
      `Objetivo: ${schedule.prompt}`,
      !schedule.ok && schedule.details ? `Erro: ${schedule.details}` : ""
    ].filter(Boolean).join("\n");
  }

  #handleUiRequest(event) {
    const dialogMethods = new Set(["select", "confirm", "input", "editor"]);
    if (!dialogMethods.has(event.method)) return;
    void this.pi
      .write({ type: "extension_ui_response", id: event.id, cancelled: true })
      .catch((error) => {
        log.warn("Falha ao cancelar diálogo de extensão", { error: error.message });
      });
  }

  #emptyResponseText(run) {
    const error = lastUnique(run.errors);
    if (error) {
      return [
        "❌ O modelo não conseguiu gerar uma resposta.",
        "",
        `Erro: ${error}`,
        "",
        `Modelo: ${this.config.pi.provider}/${this.config.pi.model}`,
        `Endpoint: ${this.config.pi.baseUrl}`,
        "Verifique se o llama.cpp está acessível de dentro do contêiner em /v1/models."
      ].join("\n");
    }

    return [
      "⚠️ O Pi concluiu a execução sem conteúdo de texto.",
      `Modelo: ${this.config.pi.provider}/${this.config.pi.model}`,
      `Endpoint: ${this.config.pi.baseUrl}`,
      `Tentativas internas: ${run.lowLevelRuns}`,
      "Consulte os logs procurando por “Resposta do modelo terminou com erro” ou “Pi stderr”."
    ].join("\n");
  }

  async #finishRun() {
    const run = this.run;
    this.run = null;
    const dispatched = this.dispatched;
    this.dispatched = null;
    await this.scheduleAuthorization.clear(run?.scheduleAuthorization?.token || dispatched?.scheduleAuthorization?.token);
    if (!run) {
      await this.#dispatchNext();
      return;
    }

    let text;
    if (run.kind === "interactive" && run.schedules.length > 0) {
      text = run.schedules
        .map((schedule) => this.#scheduleConfirmation(schedule, false))
        .join("\n\n");
    } else {
      text = lastUnique(run.texts) || this.#emptyResponseText(run);
    }
    text = redactSecrets(text).slice(0, this.config.maxResponseChars);

    if (run.kind === "scheduled") {
      const finishedAt = Date.now();
      const firedAt = run.scheduled?.firedAt || run.startedAt;
      const queueDelayMs = run.startedAt - firedAt;
      const durationMs = finishedAt - run.startedAt;
      const warning = queueDelayMs >= this.config.schedule.delayWarningMs
        ? `⚠️ A tarefa aguardou ${formatDuration(queueDelayMs)} antes de o modelo começar.`
        : "";
      const message = [
        "✅ Resultado de tarefa agendada",
        `Agente: ${this.config.agentId}`,
        run.scheduled?.jobName ? `Tarefa: ${run.scheduled.jobName}` : "",
        run.scheduled?.jobId ? `ID: ${run.scheduled.jobId}` : "",
        `Disparada em: ${formatDateTime(firedAt, this.config.timezone)}`,
        `Modelo iniciou em: ${formatDateTime(run.startedAt, this.config.timezone)}`,
        `Concluída em: ${formatDateTime(finishedAt, this.config.timezone)}`,
        `Espera antes do modelo: ${formatDuration(queueDelayMs)}`,
        `Processamento: ${formatDuration(durationMs)}`,
        warning,
        "",
        text
      ].filter((line) => line !== "").join("\n");
      const deliveryMode = await this.scheduleDeliveries.get(run.scheduled?.jobId);
      await this.notifier.sendAllResponse(message, deliveryMode);
      this.lastScheduleMetrics = {
        jobId: run.scheduled?.jobId || null,
        jobName: run.scheduled?.jobName || null,
        mode: "inline",
        firedAt,
        startedAt: run.startedAt,
        finishedAt,
        queueDelayMs,
        durationMs,
        failed: run.errors.length > 0
      };
    } else if (run.origin && run.schedules.length === 0) {
      await run.origin.replyFinal(text, run.responseMode || "text");
    } else if (dispatched?.origin && run.schedules.length === 0) {
      await dispatched.origin.replyFinal(text, dispatched.responseMode || "text");
    }

    log.info("Execução Pi concluída", {
      kind: run.kind,
      durationMs: Date.now() - run.startedAt,
      scheduleQueueDelayMs: run.scheduled ? run.startedAt - run.scheduled.firedAt : null,
      outputChars: text.length,
      lowLevelRuns: run.lowLevelRuns,
      capturedTexts: run.texts.length,
      capturedErrors: run.errors.length
    });
    await this.#dispatchNext();
  }

  status() {
    return {
      agentId: this.config.agentId,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      piRunning: Boolean(this.run),
      piRpc: this.pi.status(),
      runKind: this.run?.kind || null,
      queueLength: this.queue.length,
      currentOrigin: this.dispatched?.origin?.platform || null,
      timezone: this.config.timezone,
      model: `${this.config.pi.provider}/${this.config.pi.model}`,
      modelEndpoint: this.config.pi.baseUrl,
      scheduleMode: this.config.schedule.executionMode,
      scheduleModel: this.config.schedule.model,
      scheduleIntentGuard: this.config.schedule.intentGuard,
      currentScheduleIntent: this.dispatched?.scheduleIntent?.mode || this.run?.scheduleIntent?.mode || null,
      pendingInlineSchedules: this.pendingInlineSchedules.length,
      activeScheduleSubagents: [...this.subagentScheduleRuns.values()].reduce((sum, items) => sum + items.length, 0),
      lastScheduleMetrics: this.lastScheduleMetrics,
      lowLevelRuns: this.run?.lowLevelRuns || 0,
      speech: {
        enabled: this.config.telegram.audioEnabled,
        endpoint: `${this.config.speech.baseUrl}${this.config.speech.inferencePath}`,
        language: this.config.speech.language,
        maxMb: Math.floor(this.config.telegram.audioMaxBytes / 1024 / 1024),
        maxDurationSeconds: this.config.telegram.audioMaxDurationSeconds
      },
      tts: {
        enabled: this.config.tts.enabled,
        endpoint: `${this.config.tts.baseUrl}${this.config.tts.synthesisPath}`,
        voice: this.config.tts.voice,
        defaultMode: this.config.tts.defaultMode,
        maxChars: this.config.tts.maxChars
      },
      state: this.lastState
    };
  }

  statusText() {
    const status = this.status();
    const last = status.lastScheduleMetrics;
    return [
      `Estado do agente: ${status.agentId}`,
      `Pi RPC: ${status.piRpc.ready ? "pronto" : status.piRpc.restartScheduled ? "reiniciando" : "indisponível"}`,
      `PID do Pi: ${status.piRpc.pid || "nenhum"}`,
      `Reinicializações do RPC: ${status.piRpc.restartCount}`,
      `Pi em execução: ${status.piRunning ? "sim" : "não"}`,
      `Tipo da execução: ${status.runKind || "nenhuma"}`,
      `Fila interativa: ${status.queueLength}`,
      `Agendamentos aguardando inline: ${status.pendingInlineSchedules}`,
      `Subagentes agendados ativos: ${status.activeScheduleSubagents}`,
      `Modo padrão dos agendamentos: ${status.scheduleMode}`,
      `Modelo dos agendamentos: ${status.scheduleModel}`,
      `Proteção de intenção: ${status.scheduleIntentGuard ? "ativa" : "desativada"}`,
      `Intenção atual: ${status.currentScheduleIntent || "nenhuma"}`,
      last ? `Última tarefa: ${last.jobName || last.jobId || "sem nome"} — ${formatDuration(last.durationMs)}` : "Última tarefa: ainda não executada",
      last && last.mode === "inline" ? `Última espera antes do modelo: ${formatDuration(last.queueDelayMs)}` : "",
      `Modelo: ${status.model}`,
      `Endpoint: ${status.modelEndpoint}`,
      `Áudio Telegram: ${status.speech.enabled ? "habilitado" : "desabilitado"}`,
      `Whisper: ${status.speech.endpoint} (${status.speech.language})`,
      `TTS: ${status.tts.enabled ? "habilitado" : "desabilitado"}`,
      `Piper: ${status.tts.endpoint} — voz ${status.tts.voice}`,
      `Fuso: ${status.timezone}`
    ].filter(Boolean).join("\n");
  }
}
