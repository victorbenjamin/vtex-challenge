# 014: Relatório detalhado da importação

**Status:** concluído (2026-10-26)

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
   - **O CLI grava em `output/import-report.json`, um array JSON** (escolha do usuário: mais legível para quem avalia).
   - **O array é escrito em fluxo:** abre com `[`, grava cada registro com uma vírgula antes (a partir do segundo) e fecha com `]`. O relatório nunca fica inteiro na memória, o que mantém a premissa de escala.
   - *Descartado:* NDJSON, uma linha JSON por item. Seria igualmente escalável e fácil de filtrar, mas o usuário preferiu um JSON comum.
4. **O `ImportSummary` continua.** As contagens seguem no log, e o caminho do relatório é mostrado no fim.
5. **Uma falha técnica** também gera um registro (`outcome: "failed"`, com a mensagem) antes de a importação parar.

## Gabarito (arquivo do desafio)

O relatório tem 269 linhas:
- 267 `linked`, das quais 2 com `matchedBy: "translatedName"` (#57, #64);
- 1 `alreadyLinked` (#76);
- 1 `created` (#180).

## Passos

- [x] `SellerProductEntry.parse` devolve `{ entry }` ou `{ reason }`
- [x] Tipo do registro (`ImportRecord`) no domínio, e `ImportCatalog` monta um registro por item, com o motivo; `onItem` chamado depois da confirmação
- [x] CLI grava `output/import-report.json` em fluxo (array JSON escrito item a item)
- [x] Testes: o registro de cada resultado e motivo (incluindo os candidatos ambíguos e `matchedBy`), a ausência de registro de um item desfeito, o registro `failed`
- [x] Aceitação: as 269 linhas e os casos #57, #64, #76 e #180
- [x] Atualizar o `import-decision-flow.md` (os motivos), o `README.md`, o `CLAUDE.md` (remover o pendente) e o changelog
- [x] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`

## Desvios

- **Sem o campo `matchedBy`:** a forma do match ficou no próprio `reason` (`matchedByName` ou `matchedByTranslatedName`), para não repetir a mesma informação em dois campos.
- **`SellerProductEntry.read` devolve `{ entry }` ou `{ rejection }`.** O `parse`, que devolve a entrada ou `undefined`, continua, usado pelos testes e pela infraestrutura.
- **Em `unmatched` por `tooManyCandidates`, os candidatos não são listados,** porque seriam 50 ou mais.
- **No registro de `conflict` de um item que casou,** também vai o `productId` com que ele casou, além do `existingProductId`.
- **`ImportRecord` ganhou um arquivo próprio** (`src/domain/import-record.ts`), com a lista dos motivos. O escritor do array em fluxo é `src/infrastructure/json-array-file.ts`.

- **Refatorado depois da execução, a pedido do usuário,** para separar a decisão da montagem do relatório:
  - **o caso de uso só decide:** devolve um `ItemResult` (o resultado, o motivo, a entrada e os ids envolvidos), sem se ocupar do formato do relatório;
  - **`toImportRecord(index, result)`** (`src/domain/import-record.ts`) monta o registro num lugar só: `index`, `outcome` e `reason` primeiro, os dados do item, e omite os campos vazios;
  - **`ImportSummary.add(record)`** conta a partir do registro, inclusive a falha, no lugar de `count` e `recordFailure`;
  - **o `execute`** ficou só com o laço: decidir, montar o registro, e entregar ao resumo e ao `onItem`;
  - **verificação:** os testes da aplicação e da aceitação passaram sem mudança, e o relatório saiu idêntico. Testes novos em `tests/domain/import-record.test.ts`.

- **Segundo refactor, a pedido do usuário,** porque a construção dos resultados e da busca ainda poluía o caso de uso:
  - **a busca saiu para `ProductMatcher`** (`src/application/product-matcher.ts`), com `match(entry)` e um resultado de quatro casos nomeados: `found`, `ambiguous`, `tooManyCandidates`, `notFound`. O `CANDIDATE_LIMIT` foi junto, e o `import-catalog.ts` o reexporta;
  - **construtores nomeados para os resultados** (`ItemResult.created(entry, productId)`, `ItemResult.ambiguous(...)` etc., em `import-record.ts`): os motivos ficam escritos num lugar só;
  - **o `importItem` virou um `switch`** sobre o resultado da busca, e o caso de uso caiu de 166 para 106 linhas;
  - **verificação:** os 232 testes passaram sem mudança, e o relatório saiu idêntico. Testes diretos do `ProductMatcher` foram acrescentados.

## Resultado

- **O relatório do arquivo do desafio tem 269 registros,** na ordem do arquivo: 265 `linked:matchedByName`, 2 `linked:matchedByTranslatedName` (#57 e #64), 1 `alreadyLinked:matchedByName` (#76) e 1 `created:nameNotInCatalog` (#180, produto 976).
- **229 testes passam,** contra o SQLite real e sem mocks. Entre os novos:
  - um registro para cada resultado e motivo (com os candidatos ambíguos e os parecidos);
  - a falha registrada, sem registro para o item desfeito;
  - os motivos de rejeição;
  - o array JSON válido (vazio e com caracteres especiais);
  - a aceitação do relatório.
- O banco original continua intacto.
