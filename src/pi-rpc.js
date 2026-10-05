import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { log } from "./logger.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function rpcError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export class PiRpc extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.child = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.running = false;
    this.ready = false;
    this.stopping = false;
    this.restartTimer = null;
    this.restartAttempt = 0;
    this.restartCount = 0;
    this.generation = 0;
    this.lastReadyAt = null;
    this.lastExit = null;
    this.lastError = null;
  }

  async start() {
    this.stopping = false;
    if (!this.child && !this.restartTimer) this.#spawn();
    return this.waitUntilReady(this.options.startupTimeoutMs);
  }

  #spawn() {
    if (this.stopping || this.child) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const generation = ++this.generation;
    const args = [
      "--mode", "rpc",
      "--approve",
      "--provider", this.options.provider,
      "--model", this.options.model,
      "--name", this.options.sessionName,
      "--session-dir", this.options.sessionDir
    ];

    this.ready = false;
    this.stdoutBuffer = "";
    log.info("Iniciando Pi RPC", { args, cwd: this.options.cwd, generation });

    const child = spawn("pi", args, {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        log.warn("Pi stderr", { line });
      }
    });

    child.once("spawn", () => {
      log.info("Processo Pi RPC criado", { pid: child.pid, generation });
      void this.#probeUntilReady(child, generation);
    });

    child.on("error", (error) => {
      this.lastError = error.message;
      log.error("Falha no processo Pi RPC", { error: error.message, generation });
      this.emit("process_error", error);
    });

    child.on("exit", (code, signal) => {
      const wasCurrent = this.child === child;
      if (wasCurrent) this.child = null;
      this.ready = false;
      this.running = false;
      this.lastExit = { code, signal, at: Date.now(), generation };

      const error = rpcError(
        `Processo Pi RPC encerrado (código ${code ?? "n/a"}, sinal ${signal ?? "n/a"})`,
        "PI_RPC_EXITED",
        { exitCode: code, signal }
      );
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();

      log.error("Pi RPC terminou", { code, signal, generation, stopping: this.stopping });
      this.emit("exit", { code, signal, generation, stopping: this.stopping });
      this.emit("unavailable", this.status());

      if (!this.stopping && wasCurrent) this.#scheduleRestart();
    });
  }

  async #probeUntilReady(child, generation) {
    const deadline = Date.now() + this.options.startupTimeoutMs;
    let lastProbeError = "";

    while (!this.stopping && this.child === child && generation === this.generation) {
      if (Date.now() >= deadline) {
        this.lastError = lastProbeError || "Pi RPC não respondeu ao get_state";
        log.error("Pi RPC não ficou pronto dentro do limite", {
          generation,
          startupTimeoutMs: this.options.startupTimeoutMs,
          lastProbeError: this.lastError
        });
        try { child.kill("SIGTERM"); } catch {}
        return;
      }

      try {
        const response = await this.#rawSend(
          { type: "get_state" },
          this.options.probeTimeoutMs,
          child
        );
        if (response.success !== false) {
          this.ready = true;
          this.lastReadyAt = Date.now();
          this.lastError = null;
          this.restartAttempt = 0;
          log.info("Pi RPC pronto", {
            pid: child.pid,
            generation,
            sessionId: response.data?.sessionId || null,
            model: response.data?.model?.id || this.options.model
          });
          this.emit("ready", this.status());
          return;
        }
        lastProbeError = response.error || "get_state rejeitado";
      } catch (error) {
        lastProbeError = error.message;
      }

      await delay(this.options.probeIntervalMs);
    }
  }

  #scheduleRestart() {
    if (!this.options.autoRestart || this.stopping || this.restartTimer) return;
    const exponent = Math.min(this.restartAttempt, 10);
    const waitMs = Math.min(
      this.options.restartBaseMs * (2 ** exponent),
      this.options.restartMaxMs
    );
    this.restartAttempt += 1;
    this.restartCount += 1;

    log.warn("Reinicialização do Pi RPC agendada", {
      waitMs,
      attempt: this.restartAttempt,
      restartCount: this.restartCount
    });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.#spawn();
    }, waitMs);
    this.restartTimer.unref?.();
  }

  #onStdout(chunk) {
    this.stdoutBuffer += chunk.toString("utf8");
    while (true) {
      const index = this.stdoutBuffer.indexOf("\n");
      if (index < 0) break;
      let line = this.stdoutBuffer.slice(0, index);
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        this.#handle(JSON.parse(line));
      } catch (error) {
        log.error("Linha RPC inválida", { error: error.message, line: line.slice(0, 500) });
      }
    }
  }

  #handle(event) {
    if (event.type === "response" && event.id && this.pending.has(event.id)) {
      const pending = this.pending.get(event.id);
      this.pending.delete(event.id);
      clearTimeout(pending.timer);
      if (event.success === false) {
        pending.reject(rpcError(event.error || "Comando RPC rejeitado", "PI_RPC_REJECTED", { response: event }));
      } else {
        pending.resolve(event);
      }
    }

    if (event.type === "agent_start") this.running = true;
    if (event.type === "agent_settled") this.running = false;
    this.emit("event", event);
    this.emit(event.type, event);
  }

  #rawSend(command, timeoutMs, expectedChild = this.child) {
    const child = expectedChild;
    if (!child || child !== this.child || !child.stdin?.writable || child.killed) {
      return Promise.reject(rpcError("Pi RPC indisponível", "PI_RPC_UNAVAILABLE"));
    }

    const id = command.id || crypto.randomUUID();
    const payload = { ...command, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(rpcError(`Timeout RPC após ${timeoutMs} ms`, "PI_RPC_TIMEOUT", { command: command.type }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, command: command.type });

      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.reject(rpcError(`Falha ao escrever no Pi RPC: ${error.message}`, "PI_RPC_UNAVAILABLE"));
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(rpcError(`Falha ao escrever no Pi RPC: ${error.message}`, "PI_RPC_UNAVAILABLE"));
      }
    });
  }

  waitUntilReady(timeoutMs = this.options.readyWaitTimeoutMs) {
    if (this.ready && this.child?.stdin?.writable && !this.child.killed) {
      return Promise.resolve(this.status());
    }
    if (this.stopping) {
      return Promise.reject(rpcError("Pi RPC está sendo encerrado", "PI_RPC_STOPPING"));
    }
    if (!this.child && !this.restartTimer) this.#spawn();

    return new Promise((resolve, reject) => {
      const onReady = (status) => {
        cleanup();
        resolve(status);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(rpcError(
          `Pi RPC não ficou disponível após ${timeoutMs} ms`,
          "PI_RPC_READY_TIMEOUT",
          { status: this.status() }
        ));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.off("ready", onReady);
      };
      this.on("ready", onReady);
    });
  }

  async write(command) {
    await this.waitUntilReady();
    return this.#rawSend(command, this.options.timeoutMs);
  }

  async send(command, timeoutMs = this.options.timeoutMs) {
    await this.waitUntilReady(this.options.readyWaitTimeoutMs);
    return this.#rawSend(command, timeoutMs);
  }

  prompt(message) {
    const command = { type: "prompt", message };
    if (this.running) command.streamingBehavior = "followUp";
    return this.send(command);
  }

  abort() {
    return this.send({ type: "abort" }, 10000);
  }

  newSession() {
    return this.send({ type: "new_session" }, 30000);
  }

  getState() {
    return this.send({ type: "get_state" }, 30000);
  }

  status() {
    return {
      ready: this.ready,
      processAlive: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid || null,
      running: this.running,
      pendingCommands: this.pending.size,
      generation: this.generation,
      restartAttempt: this.restartAttempt,
      restartCount: this.restartCount,
      restartScheduled: Boolean(this.restartTimer),
      lastReadyAt: this.lastReadyAt,
      lastExit: this.lastExit,
      lastError: this.lastError
    };
  }

  shutdown() {
    this.stopping = true;
    this.ready = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.child) return;
    try { this.child.stdin.write(`${JSON.stringify({ type: "abort" })}\n`); } catch {}
    this.child.kill("SIGTERM");
  }
}
