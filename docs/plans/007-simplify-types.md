# 007: Simplificar os tipos

**Status:** concluído (2026-10-25)

## Objetivo

Reduzir os cerca de 25 tipos criados nos planos 005 e 006 ao mínimo que cumpre as instruções do usuário: orientação a objetos, camadas, sem objetos anêmicos, testes contra o SQLite real e desenho escalável. O comportamento não muda: 200 ligados, 69 pendentes e a importação idempotente.

## Contexto

O usuário achou o código complicado. O diagnóstico ficou assim:
- **5 interfaces em `ports.ts`**, cada uma com uma única implementação. Sem mocks (regra do usuário), elas não têm uso.
- **Embrulhos de uma linha:** `SqliteUnitOfWork` e `JsonEntrySource`.
- **Classes quase sem comportamento:** `Product` e `Seller`.
- **Tipos duplicados ou restos de reescritas:** `OfferOutcome` e `ItemOutcome`, `ProductAttributes`, `EntryParseResult`, `persistedId`.

A causa foi aplicar padrões (ports & adapters, unit of work, agregados) cujo valor depende de várias implementações, de mocks ou de uma equipe grande, e confundir "evitar objetos anêmicos" com "criar uma classe por conceito".

## Decisões

1. **Tipos que ficam:**

   | Tipo | Camada | Responsabilidade |
   |---|---|---|
   | `SellerProductEntry` | domain | `parse()` valida o item. `isFromMarketplace()` aplica a regra do nome reservado. Absorve o `SellerName`. |
   | `Offer` | domain | `outcomeGiven(existingProductId)` decide entre ligado, já ligado e conflito |
   | `ImportSummary` | domain | Contagens por resultado e a falha |
   | `ImportCatalog` | application | O fluxo, com uma transação por item. A regra de ambiguidade (só um candidato casa) fica aqui, em uma linha. |
   | `CatalogDatabase` | infrastructure | Uma classe com todo o SQL: `transaction`, `findProductIds`, `findOrCreateSeller` e `addOfferIfAbsent` |

2. **Sem interfaces.** A aplicação depende da classe concreta `CatalogDatabase`. Se um dia houver uma segunda implementação, extrai-se a interface nesse momento.
3. **Ler o arquivo é uma função** (`readImportFile`), não uma classe.
4. **O que não muda:**
   - as regras de negócio;
   - o desenho escalável: consulta por índice, transação por item, "insere se não existir";
   - as migrações;
   - os testes contra o SQLite real.
5. **`parse()` devolve `undefined` para um item inválido,** sem motivo, porque o relatório com motivos está adiado. O motivo volta junto com o relatório.

## Passos

- [x] Domínio: `SellerProductEntry` (com a regra do marketplace), `Offer` e `ImportSummary`
- [x] Infraestrutura: `CatalogDatabase` e `readImportFile`
- [x] Aplicação: `ImportCatalog` usando `CatalogDatabase`
- [x] Apagar `ports.ts`, `product.ts`, `seller.ts`, `seller-name.ts`, `exact-product-matcher.ts`, os 3 repositórios, `unit-of-work.ts` e `json-entry-source.ts`
- [x] Reescrever os testes por camada, todos contra o SQLite real
- [x] Atualizar o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **Saiu também o `index` do `SellerProductEntry`.** Ele só servia ao relatório, que está adiado.
- **`ImportSummary.recordFailure(index, message)` recebe dois argumentos.** O tipo `ImportFailure` foi removido.

## Resultado

- **De cerca de 25 tipos para 5 classes** (`SellerProductEntry`, `Offer`, `ImportSummary`, `ImportCatalog`, `CatalogDatabase`), **1 tipo** (`ItemOutcome`) e funções utilitárias de conexão e leitura. São 317 linhas em `src/`.
- **87 testes passam, sem mocks.** Os de infraestrutura foram reunidos em `tests/infrastructure/catalog-database.test.ts`, e a regra de ambiguidade passou a ser testada na aplicação.
- `npm run db:reset && npm run import`: 200 ligados e 69 pendentes. Na segunda execução, 200 já ligados.
- O banco original continua intacto.
