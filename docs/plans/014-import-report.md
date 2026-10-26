# 014: Relatório detalhado da importação

**Status:** proposto (2026-10-26)

## Objetivo

Gravar, para **cada item** do arquivo, o resultado e **o motivo**, para que nada se perca em silêncio. Isso fecha o pendente registrado no `CLAUDE.md` desde o plano 006 (o "relatório detalhado") e a lacuna levantada sobre a ambiguidade: hoje um item ambíguo só aparece como uma contagem, sem dizer quais são os candidatos.

## Contexto

- **Hoje o log mostra só as contagens** (`ImportSummary`). Ninguém consegue saber quais itens foram criados, ficaram em conflito ou foram rejeitados, nem por quê.
- **O relatório antigo** (`ImportReport`, plano 004) guardava todos os itens na memória e foi removido no plano 007, junto com o "baby steps". Desde o plano 006, o desenho precisa se sustentar com volume: um relatório com milhões de itens não pode ficar inteiro na memória.
- **Numa demonstração com um arquivo novo,** mostrar por que cada item terminou como terminou vale mais do que as contagens.

## Decisões

1. **Um registro por item,** com os campos:

   | Campo | Sempre | Quando |
   |---|---|---|
   | `index` | ✓ | posição no arquivo |
   | `outcome` | ✓ | `linked`, `alreadyLinked`, `conflict`, `created`, `createdForReview`, `unmatched`, `rejected` |
   | `reason` | ✓ | o motivo, em texto curto e estável (lista abaixo) |
   | `sellerName`, `sellerProductId`, `name`, `brand` | | quando o item é válido |
   | `productId` | | o produto ligado ou criado |
   | `matchedBy` | | `name` ou `translatedName`, quando o item foi ligado a um produto existente |
   | `existingProductId` | | o produto para o qual o SKU já apontava, em caso de `conflict` |
   | `candidateProductIds` | | os candidatos, quando o item é ambíguo |
   | `similarProductIds` | | os produtos parecidos, em `createdForReview` |

2. **Os motivos:**
   - **`rejected`:** o campo inválido, por exemplo `"Id must be a non-empty string or an integer"`.
     - Para isso, `SellerProductEntry.parse` volta a devolver o motivo, em vez de `undefined`. O tipo de resultado já existiu no plano 005 e foi removido no 007, quando ninguém usava o motivo.
   - **`unmatched`:** `ambiguous` (com os candidatos) ou `tooManyCandidates`.
   - **`conflict`:** `skuPointsToAnotherProduct`.
   - **Os demais:** o próprio nome do resultado basta.
3. **O relatório é gravado em fluxo, item a item,** sem ficar na memória.
   - `ImportCatalog.execute` recebe uma função opcional `onItem(record)`, chamada **depois** que a transação do item é confirmada. O registro nunca mente sobre o que foi gravado.
   - **O CLI grava em `output/import-report.ndjson`:** uma linha JSON por item, fácil de filtrar (`grep '"unmatched"'`, `jq`).
   - *Alternativa a confirmar:* um array JSON (`.json`) é mais legível para quem avalia, mas teria de ser escrito à mão em fluxo (`[`, vírgulas, `]`) ou ficar na memória. **Recomendado: NDJSON**, coerente com a premissa de escala.
4. **O `ImportSummary` continua.** As contagens seguem no log, e o caminho do relatório é mostrado no fim.
5. **Uma falha técnica** também gera um registro (`outcome: "failed"`, com a mensagem) antes de a importação parar.

## Gabarito (arquivo do desafio)

O relatório tem 269 linhas:
- 267 `linked`, das quais 2 com `matchedBy: "translatedName"` (#57, #64);
- 1 `alreadyLinked` (#76);
- 1 `created` (#180).

## Passos

- [ ] `SellerProductEntry.parse` devolve `{ entry }` ou `{ reason }`
- [ ] Tipo do registro (`ImportRecord`) no domínio, e `ImportCatalog` monta um registro por item, com o motivo; `onItem` chamado depois da confirmação
- [ ] CLI grava `output/import-report.ndjson` em fluxo
- [ ] Testes: o registro de cada resultado e motivo (incluindo os candidatos ambíguos e `matchedBy`), a ausência de registro de um item desfeito, o registro `failed`
- [ ] Aceitação: as 269 linhas e os casos #57, #64, #76 e #180
- [ ] Atualizar o `import-decision-flow.md` (os motivos), o `README.md`, o `CLAUDE.md` (remover o pendente) e o changelog
- [ ] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`

## Desvios

Nenhum até agora.
