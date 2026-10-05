---
name: pesquisa-simples
description: Busca o CEP e prepara a entrega, sem etapa de revisão
---

## pesquisador
phase: Pesquisa
label: Buscar CEP
as: pesquisa
output: pesquisa.md

Pesquise cuidadosamente o seguinte pedido:

{task}

## entregador
phase: Entrega
label: Preparar resposta
reads: pesquisa.md

Prepare a resposta usando somente o conteúdo produzido em {outputs.pesquisa}.
