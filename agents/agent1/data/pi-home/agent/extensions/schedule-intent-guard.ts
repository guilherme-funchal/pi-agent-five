import fs from "node:fs";
const cronPolicyModule = process.env.PI_CRON_POLICY_MODULE || "file:///app/src/cron-policy.js";
const { validateScheduleToolInput } = await import(cronPolicyModule);

const authorizationFile = process.env.SCHEDULE_AUTH_FILE || "/data/schedule-intent-authorization.json";
const enabled = !["0", "false", "no", "nao", "off"].includes(
  String(process.env.SCHEDULE_INTENT_GUARD ?? "true").toLowerCase()
);
const cronGuardEnabled = !["0", "false", "no", "nao", "off"].includes(
  String(process.env.SCHEDULE_CRON_GUARD ?? "true").toLowerCase()
);

function readAuthorization() {
  try {
    return JSON.parse(fs.readFileSync(authorizationFile, "utf8"));
  } catch {
    return null;
  }
}

function contextContainsToken(ctx, token) {
  if (!token) return false;
  try {
    const entries = ctx.sessionManager.buildContextEntries();
    return JSON.stringify(entries).includes(token);
  } catch {
    return false;
  }
}

export default function scheduleIntentGuard(pi) {
  if (!enabled) return;

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "schedule_prompt") return undefined;

    const action = String(event.input?.action || "").toLowerCase();
    const authorization = readAuthorization();
    const valid = Boolean(
      authorization &&
      Number(authorization.expiresAt) > Date.now() &&
      Array.isArray(authorization.allowedActions) &&
      authorization.allowedActions.includes(action) &&
      contextContainsToken(ctx, authorization.token)
    );

    if (!valid) {
      const reason = action === "add"
        ? "Agendamento bloqueado: o usuário não solicitou explicitamente a criação de uma tarefa agendada. Execute a solicitação atual imediatamente e responda com o resultado, sem usar schedule_prompt."
        : `Ação schedule_prompt '${action || "não informada"}' bloqueada: ela não foi autorizada pela solicitação atual do usuário.`;
      return { block: true, reason };
    }

    if (cronGuardEnabled && ["add", "update"].includes(action)) {
      const validation = validateScheduleToolInput(event.input, authorization.scheduleExpectation || null);
      if (!validation.ok) {
        const correction = validation.correctedSchedule
          ? ` Repita a chamada usando type='${validation.correctedType || authorization.scheduleExpectation?.type || event.input?.type || "cron"}' e schedule='${validation.correctedSchedule}'.`
          : "";
        return {
          block: true,
          reason: `Agendamento não gravado porque a expressão está incorreta. ${validation.reason}${correction}`
        };
      }
    }

    return undefined;
  });
}
