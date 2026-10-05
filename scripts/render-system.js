import fs from "node:fs";

const filename = process.argv[2] || "/workspace/SYSTEM.md";
const begin = "<!-- BEGIN PI RUNTIME SCHEDULE POLICY -->";
const end = "<!-- END PI RUNTIME SCHEDULE POLICY -->";
const provider = process.env.PI_PROVIDER || "local-llama";
const model = process.env.PI_MODEL || "Qwen3.5-9B-Q4_K_M.gguf";
const scheduleModel = process.env.PI_SCHEDULE_MODEL || `${provider}/${model}`;
const mode = String(process.env.SCHEDULE_EXECUTION_MODE || "subagent").toLowerCase() === "inline"
  ? "inline"
  : "subagent";
const extensions = String(
  process.env.PI_SCHEDULE_EXTENSIONS ||
  "pi-web-access,pi-subagents,pi-memory"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

let content = fs.readFileSync(filename, "utf8");
const blockPattern = new RegExp(`${begin}[\\s\\S]*?${end}\\n?`, "g");
content = content.replace(blockPattern, "").trimEnd();

const policy = mode === "subagent"
  ? [
      begin,
      "",
      "## Política de runtime para agendamentos autorizados",
      "",
      "Estas regras só se aplicam quando o bloco [CONTROLE DE AGENDAMENTO DO GATEWAY] autorizar action=add:",
      "",
      "- Se o modo do gateway for `none`, execute a solicitação imediatamente e nunca use `schedule_prompt`.",
      "- Pesquisa web, análise, consulta, resumo e busca de notícias não são agendamentos por padrão.",
      `- Quando action=add estiver autorizada, defina \`model\` como \`${scheduleModel}\`.`,
      "- Defina `notify` como `false`; o gateway captura o resultado do subagente e o envia diretamente aos mensageiros.",
      `- Defina \`extensions\` como ${JSON.stringify(extensions)}.`,
      "- Não omita `model` em tarefas agendadas, pois o modo subagente evita que a tarefa aguarde o término de uma conversa interativa.",
      "- O prompt agendado deve produzir a resposta final diretamente, sem pedir que o agente principal continue o trabalho.",
      "",
      end,
      ""
    ].join("\n")
  : [
      begin,
      "",
      "## Política de runtime para agendamentos autorizados",
      "",
      "- Somente use `schedule_prompt` quando o bloco [CONTROLE DE AGENDAMENTO DO GATEWAY] autorizar a ação solicitada.",
      "- Se o modo for `none`, execute a solicitação imediatamente.",
      "- Quando action=add estiver autorizada, crie a tarefa inline, sem definir `model`.",
      "- Tarefas inline podem aguardar uma conversa ativa terminar antes de começar.",
      "",
      end,
      ""
    ].join("\n");

fs.writeFileSync(filename, `${content}\n\n${policy}`, "utf8");
console.log(`[entrypoint] Política de agendamento renderizada: mode=${mode}, model=${scheduleModel}`);
