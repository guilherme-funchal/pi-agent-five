import express from "express";
import { log } from "./logger.js";

export function startHttp(config, gateway, pi) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    const rpc = pi.status();
    res.status(rpc.ready ? 200 : 503).json({
      ok: rpc.ready,
      agentId: config.agentId,
      piRpc: rpc,
      timezone: config.timezone,
      queueLength: gateway.queue.length
    });
  });

  app.get("/api/status", (_req, res) => res.json(gateway.status()));

  app.post("/api/prompt", async (req, res) => {
    if (!config.apiToken) {
      res.status(403).json({ error: "API_TOKEN não configurado" });
      return;
    }
    const auth = req.header("authorization") || "";
    if (auth !== `Bearer ${config.apiToken}`) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Campo message obrigatório" });
      return;
    }

    const replies = [];
    await gateway.accept({
      platform: "http",
      targetId: "api",
      userId: "api",
      text: message,
      reply: async (text) => { replies.push(text); },
      replyFinal: async (text) => { replies.push(text); }
    });
    res.status(202).json({ accepted: true, initialReplies: replies });
  });

  const server = app.listen(config.port, "0.0.0.0", () => {
    log.info("Servidor HTTP iniciado", { port: config.port });
  });
  return server;
}
