# 011: Importação, incremento 5 (criar produto, com revisão de possíveis duplicatas)

**Status:** concluído (2026-10-26)

## Objetivo

- **Última linha da tabela da [data-analysis §3.1](../analysis/data-analysis.md):** um item sem produto da mesma marca no catálogo passa a **criar um produto**. No arquivo do desafio, é o #180 `Security Test Product`.
- **Quando o nome já existe no catálogo com outra marca,** o produto também é criado, mas fica **registrado como possível duplicata** para revisão. O merge fica para o plano 012.

## Contexto

- **O risco que importa** é ligar a oferta ao produto errado. Uma duplicata é recuperável com um merge posterior ([estudo §2](../analysis/entity-resolution-study.md)), e os casos duvidosos devem ir para revisão humana ([estudo §3.11](../analysis/entity-resolution-study.md)).
- **A proposta do usuário** junta as duas coisas: criar, para não bloquear o seller, e registrar a suspeita, para a duplicata não passar despercebida. Isso substitui a escolha entre as opções A e B do [fluxo de decisão](../analysis/import-decision-flow.md).
- **O modelo já permite o merge:** a chave de `SellerProduct` é `(SellerId, SellerProductId)` (plano 002), então mesclar é um `UPDATE` de `ProductId`, sem trocar chaves.
- **Por que criar produto ficou para o fim** (plano 004, decisão 1): sem as regras de match, criar para todo item sem match teria gerado 68 duplicatas. Agora as regras de grafia, marca, categoria e tradução existem.

## Decisões

1. **Quando criar.** Nenhum produto da mesma marca foi encontrado, nem pelo nome do item nem pelo traduzido.
   - **Nome inédito** (nenhum produto com esse nome, de qualquer marca): cria o produto. Resultado `created`.
   - **Nome existe com outra marca:** cria o produto e registra uma revisão para cada produto existente com o mesmo nome (o do item ou o traduzido). Resultado `createdForReview`.
2. **Um item ambíguo continua sem criar.** Dois ou mais produtos com o mesmo nome **e a mesma marca**, ou 50 ou mais candidatos: o produto certamente existe, só não se sabe qual, e criar outro seria duplicata garantida. Continua `unmatched`.
3. **Antes de criar, confere o SKU.** Se o seller já tem oferta para esse SKU, apontando para qualquer produto, o resultado é `conflict` e nada é criado. Sem isso, o produto novo ficaria órfão, porque a oferta existente nunca é sobrescrita.
4. **O produto novo:**
   - é gravado como o seller o descreveu (nome, marca, categoria);
   - tem o `NormalizedName` calculado (requisito do plano 008), para os próximos itens o encontrarem;
   - **não** ganha oferta do `Marketplace` (plano 003, decisão 4);
   - um segundo seller que mande o mesmo produto novo no mesmo arquivo encontra o produto criado pelo primeiro e liga a oferta (`linked`).
5. **Tabela `ProductReview` (migração 007):**

   ```sql
   ProductReview (
     Id               INTEGER PRIMARY KEY,
     ProductId        INTEGER NOT NULL REFERENCES Product (Id),  -- o produto criado
     SimilarProductId INTEGER NOT NULL REFERENCES Product (Id),  -- o produto existente parecido
     Reason           TEXT NOT NULL CHECK (Reason IN ('sameNameOtherBrand')),
     Status           TEXT NOT NULL DEFAULT 'pending' CHECK (Status IN ('pending', 'merged', 'distinct')),
     CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (ProductId, SimilarProductId)
   )
   ```

   - **Uma tabela própria, em vez de uma coluna em `Product`:** um produto novo pode lembrar vários existentes, e a revisão tem um ciclo de vida próprio.
   - O `Reason` é uma lista fechada, que cresce se outros motivos de suspeita surgirem.
   - Os status `merged` e `distinct` são usados pelo plano 012. A lista de pendentes é a consulta `WHERE Status = 'pending'`.
6. **Resultados novos no `ImportSummary` e no log:** `created` e `createdForReview`. São exclusivos entre si: cada item conta em um só.
7. **`CatalogDatabase` ganha três métodos:**
   - `createProduct(entry)`;
   - `findOfferProductId(sellerId, sku)`;
   - `addProductReviews(productId, similarProductIds, reason)`.

   A busca de candidatos passa a informar também os produtos de outras marcas com o mesmo nome, para virarem a lista de "parecidos".
8. **Fica para o plano 012:** o comando de merge (apontar as ofertas da duplicata para o produto certo, remover a duplicata e marcar a revisão como `merged`) e a marcação `distinct`.

## Concorrência (limitação registrada)

Duas importações criando o **mesmo produto novo ao mesmo tempo** podem gravá-lo duas vezes.
- **No SQLite:** a segunda gravação falha (o banco serializa as escritas), a importação para nesse item, e uma nova execução encontra o produto e liga a oferta.
- **Num Postgres:** as duas linhas poderiam ser gravadas.
- **Correção possível:** uma restrição única sobre o nome normalizado e a marca normalizada, que exigiria a coluna `NormalizedBrand`, recusada no plano 009. Na pior hipótese, a duplicata seria resolvida pelo merge do plano 012.

## Correção incluída

O teste `never links attributes shared by more than one catalog product` insere os produtos duplicados **sem** o `NormalizedName`, desde o plano 008. A busca nunca os encontra, então o teste passa por acaso, sem exercitar a ambiguidade. Com a criação de produto, o item cairia em "criar". O teste passa a gravar o `NormalizedName` e a verificar que nada é criado.

## Resultado esperado (gabarito)

| | Hoje (plano 010) | **Plano 011** |
|---|---|---|
| `linked` | 267 | 267 |
| `alreadyLinked` | 1 | 1 |
| `created` | não existe | **1** (#180) |
| `createdForReview` | não existe | **0** (não há caso no arquivo) |
| `unmatched` | 1 | **0** |
| Ofertas | 1.242 | **1.243** |
| Produtos | 975 | **976** |
| Revisões pendentes | não existe | **0** |

Na segunda execução: 269 `alreadyLinked`, nada criado. É o resultado final previsto na `data-analysis §5` antes de qualquer código: 1 produto novo, 0 rejeitados e 1.243 ofertas.

## Passos

- [x] Migração 007 (`ProductReview`) e testes: colunas, `CHECK`s, `UNIQUE`, chaves estrangeiras, reversão
- [x] `CatalogDatabase`: `createProduct`, `findOfferProductId`, `addProductReviews`; a busca devolve também os produtos de outras marcas com o mesmo nome
- [x] `ImportCatalog`: criar, criar com revisão, conferir o SKU antes; o item ambíguo continua `unmatched`
- [x] `ImportSummary` e o CLI com `created` e `createdForReview`
- [x] Corrigir o teste de ambiguidade sem `NormalizedName`
- [x] Testes da aplicação, contra o SQLite real:
  - criação com o `NormalizedName` gravado;
  - sem oferta do marketplace;
  - o mesmo produto novo enviado por dois sellers no mesmo arquivo;
  - idempotência;
  - conflito sem criar;
  - nome com outra marca gera revisão com os parecidos certos, inclusive pelo nome traduzido;
  - item ambíguo não cria
- [x] Aceitação: o gabarito, o #180 com a marca gravada literalmente, 976 produtos, 0 revisões
- [x] Atualizar o `import-decision-flow.md` (desenho e tabela), a `data-analysis §5`, o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **`CHECK (ProductId <> SimilarProductId)`** foi acrescentado à `ProductReview`: um produto não pode ser revisado contra si mesmo.
- **A busca de candidatos não mudou.** `findProductsByNormalizedName` já devolvia todos os produtos com o nome, de qualquer marca. Os "parecidos" são os candidatos que não passam no filtro de marca, então não foi preciso alterar a consulta.
- **O resultado da busca ficou num tipo interno do caso de uso** (`Lookup`: `found`, `ambiguous` ou `notFound` com os parecidos), em vez de `number | 'none' | 'ambiguous'`, para carregar a lista de parecidos até a criação.

## Resultado

- **Bate com o gabarito:** 267 `linked`, 1 `alreadyLinked`, 1 `created`, 0 `createdForReview`, 0 `unmatched`, 0 `conflict`, 0 `rejected`; 1.243 ofertas, 976 produtos e 0 revisões. Na segunda execução, 269 `alreadyLinked` e nada criado.
- **170 testes passam,** contra o SQLite real e sem mocks. Os novos cobrem:
  - a criação, com o `NormalizedName`;
  - a ausência de oferta do marketplace;
  - dois sellers enviando o mesmo produto novo no mesmo arquivo;
  - a idempotência;
  - o conflito sem criar;
  - a criação com revisão, inclusive pelo nome traduzido e com vários parecidos;
  - o item ambíguo que não cria;
  - a tabela `ProductReview`: `CHECK`s, `UNIQUE`, chaves estrangeiras e reversão.
- **O teste de ambiguidade que passava por acaso** foi corrigido.
- O banco original continua intacto.
