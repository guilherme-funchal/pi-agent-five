# Pesquisa Capital do Brasil - Fluxo Completo

Execute integralmente o fluxo "Orquestrador de Pesquisas" definido no AGENTS.md para o seguinte pedido:

**PEDIDO ORIGINAL:** Pesquise qual é a capital do Brasil utilizando somente fontes oficiais.

**REQUISITOS:** Execute obrigatoriamente o fluxo completo:
- Orquestrador → Pesquisador → Revisor → Entregador

**METADADOS:**
ID_SOLICITACAO: BR-capital-2026-final
DATA_HORA_RECEBIMENTO: NAO_REGISTRADO
CANAL_ORIGEM: USUARIO
DESTINATARIO: ORQUESTADOR
ARQUIVO_DESTINO: capital-brasil.md
PEDIDO_ORIGINAL: Pesquise qual é a capital do Brasil utilizando somente fontes oficiais.

**ESCOPO ESTRUTURADO:**
TEMA: Capital do Brasil
OBJETIVO: Identificar e validar oficialmente qual cidade é a capital federal brasileira
PERIODO: Histórico (desde 1889 até atualmente)
RECORTE_GEOGRAFICO: Brasil, com foco no Distrito Federal/Brasília
PROFUNDIDADE: Alta - pesquisa acadêmica e jurídica
FORMATO_ESPERADO: Relatório completo em markdown
CRITERIOS_DE_QUALIDADE: Fontes oficiais (Planalto.gov.br, Gov.br, IBGE, etc.)

**FONTES OFICIAIS PRIORITÁRIAS:**
- https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm (CF/1988)
- https://cidades.ibge.gov.br/brasil/df/brasilia (IBGE Cidades@)
- https://www.gov.br/ (Governo Federal)
- https://www.planalto.gov.br/ccivil_03/leis/ (Leis Federais)

**INSTRUÇÕES:**
1. Execute o Pesquisador primeiro com async: false
2. Aguarde o resultado e a criação do arquivo pesquisa.md
3. Execute o Revisor com outputSchema estrito
4. Aguarde decisão de aprovação/revisão
5. Se approved, execute o Entregador
6. Não use chain estática - uma etapa por vez
