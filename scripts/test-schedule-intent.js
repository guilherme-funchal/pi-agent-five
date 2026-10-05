import assert from "node:assert/strict";
import { classifyScheduleIntent } from "../src/schedule-intent.js";

const cases = [
  ["Pesquise as notícias de política do G1 e faça um resumo", "none"],
  ["Busque na web informações sobre o Pi Agent", "none"],
  ["Analise as notícias de hoje", "none"],
  ["Verifique agora a cotação e responda", "none"],
  ["Agende uma pesquisa de notícias para amanhã às 9h", "add"],
  ["Lembre-me daqui a 10 minutos de verificar os logs", "add"],
  ["Pesquise notícias todos os dias às 8h", "add"],
  ["Execute a análise amanhã às 17h", "add"],
  ["/agendar pesquisar o G1 diariamente às 7h", "add"],
  ["/agora pesquise o G1", "none"],
  ["Liste as tarefas agendadas", "manage"],
  ["Remova a tarefa buscar-noticias", "manage"],
  ["Qual a diferença entre tarefa e agendamento?", "none"]
];

for (const [input, expected] of cases) {
  const actual = classifyScheduleIntent(input).mode;
  assert.equal(actual, expected, `${JSON.stringify(input)} deveria ser ${expected}, recebeu ${actual}`);
}

console.log(`[test] Classificador de intenção: ${cases.length}/${cases.length} casos aprovados`);
