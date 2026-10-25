# 003: Seller do próprio marketplace

**Status:** concluído (2026-10-25)

## Objetivo

Representar o próprio marketplace como um seller e ligar a ele, em `SellerProduct`, todos os produtos que já existem no catálogo. Isso resolve a decisão pendente sobre os 777 produtos sem seller ([data-analysis §3.2](../analysis/data-analysis.md)).

## Contexto

- A empresa já vende tudo o que está no catálogo antes de virar marketplace. Portanto, ela é a primeira "seller" de cada produto existente.
- Sem isso, 777 dos 975 produtos ficariam sem nenhuma oferta depois da importação. A pergunta "quem vende o produto X?" não teria resposta para eles.
- O schema da migração 001 exige `SellerProductId TEXT NOT NULL` e chave primária `(SellerId, SellerProductId)` ([plano 002](002-schema-migration.md)).

## Decisões

1. **É uma migração de dados** (`002`), aplicada pelo Knex, com `up` e `down`, seguindo a preferência 6.
2. **O nome do seller é `Marketplace`.**
   - *Limitação:* como o seller é identificado pelo nome exato (plano 002, decisão 4), um seller externo chamado "Marketplace" num arquivo seria confundido com o próprio marketplace.
   - *Alternativa descartada por ora:* uma coluna `Seller.IsMarketplace` com índice único parcial. Seria mais robusta, mas é schema a mais sem necessidade atual. Fica registrada como evolução.
3. **O `SellerProductId` das ofertas do marketplace é o `Product.Id` em texto.** O marketplace não tem um código separado para os próprios itens, e o ID do catálogo é o código dele.
4. **Só os produtos que existem no momento da migração são ligados.** Produtos criados depois, pela importação, vêm de um seller, e o marketplace não passa a vendê-los automaticamente.
5. **O `down` remove só o que esta migração criou:** as ofertas do seller `Marketplace` e o próprio seller.

## Passos

- [x] `migrations/002_marketplace_seller.ts`
- [x] Testes: 975 ofertas com `SellerProductId = Product.Id`, idempotência, reversão para o estado da 001 e ajuste dos testes existentes que contavam sellers e ofertas
- [x] Atualizar a §3.2 e a §5 (gabarito) da `data-analysis.md`, o `CLAUDE.md`, o `README.md` e o changelog
- [x] Rodar `typecheck`, `test`, `format:check` e `db:reset`

## Desvios

Nenhum.
