---
name: pesquisa-revisao-entrega
description: Pesquisa, revisão estruturada e relatório final formatado com histórico e auditoria
---

## pesquisador
phase: Pesquisa
label: Pesquisar e registrar
as: pesquisa
output: pesquisa.md
progress: true

Execute a pesquisa solicitada em `{task}`.

Registre obrigatoriamente:

- ID da solicitação;
- data/hora do recebimento;
- data/hora da pesquisa;
- canal de origem;
- destinatário;
- arquivo solicitado;
- arquivo gerado;
- estado da pesquisa;
- pedido original;
- síntese;
- evidências e fontes;
- análise;
- limitações.

Grave o relatório em `{chain_dir}/pesquisa.md`.

Não entregue diretamente ao usuário.

## revisor
phase: Revisão
label: Validar, classificar e estruturar
as: revisao
reads: pesquisa.md
output: revisao.md
progress: true

Leia e revise `{chain_dir}/pesquisa.md`.

Conteúdo produzido pelo pesquisador:

{outputs.pesquisa}

Produza uma revisão estruturada contendo:

- ficha editorial;
- status visual;
- confiança e natureza das fontes;
- quantidade confirmada de fontes;
- validação cruzada;
- parecer curto;
- tabela de validação;
- dados principais validados;
- fontes aprovadas;
- limitações;
- correções ou ressalvas;
- metadados de encaminhamento.

Grave em `{chain_dir}/revisao.md`.

Não refaça a pesquisa e não entregue diretamente ao usuário.

## entregador
phase: Entrega
label: Formatar relatório completo
as: entrega
reads: pesquisa.md, revisao.md
output: entrega-resumo.md
progress: true

Leia:

- `{chain_dir}/pesquisa.md`;
- `{chain_dir}/revisao.md`.

Pesquisa:

{outputs.pesquisa}

Revisão:

{outputs.revisao}

Gere o documento final no padrão editorial definido pelo agente entregador, com estas seções obrigatórias:

1. Resultado Final;
2. Revisão do Processo;
3. Fontes Aprovadas;
4. Histórico Completo do Processo;
5. Registro de Auditoria;
6. Conclusão.

O documento deve ter título, subtítulo, bloco inicial de metadados, tabelas Markdown, parecer destacado, limitações, linha do tempo dos quatro papéis, fluxo de trabalho, auditoria e status final.

Grave o documento completo em `/workspace/<ARQUIVO_DESTINO_SOLICITADO>` e uma cópia em `{chain_dir}/entrega.md`.

Faça somente uma validação das seções obrigatórias.

Devolva ao Pi principal uma resposta compacta com resultado, revisão, histórico dos quatro papéis, caminho do arquivo e estado final.

Não reproduza o relatório inteiro no Discord ou Telegram.
