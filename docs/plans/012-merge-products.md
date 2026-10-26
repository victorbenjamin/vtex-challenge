# 012: Merge de produtos duplicados

**Status:** concluído (2026-10-26)

## Contexto

O plano 011 passou a criar produtos e a registrar em `ProductReview` os casos em que o nome já existia com outra marca, como possíveis duplicatas. Falta a outra metade: **resolver** essas revisões.
- **Mesclar:** a duplicata D vai para o produto certo P.
- **Marcar como distintos:** o revisor decide que são produtos diferentes.

O modelo já permite o merge: a chave de `SellerProduct` é `(SellerId, SellerProductId)` (plano 002), então mover ofertas é só um `UPDATE` de `ProductId`.

**Decisões do usuário:**
- **D é marcado como mesclado, não apagado,** para preservar o histórico. Isso exige a migração 008, com `Product.MergedIntoId`.
- **O merge aceita qualquer par de produtos,** e não só os que têm revisão pendente. Isso permite corrigir também duplicatas antigas do catálogo.

## Decisões

### 1. Migração 008 (`migrations/008_product_merged_into.ts`)

```sql
ALTER TABLE Product ADD COLUMN MergedIntoId INTEGER REFERENCES Product (Id)
  CHECK (MergedIntoId IS NULL OR MergedIntoId <> Id);
```

- O `down` faz `DROP COLUMN`. Testado num banco em memória: o SQLite 3.45 aceita, mesmo com a chave estrangeira.
- **Invariante:** `MergedIntoId` sempre aponta para um produto **ativo** (não mesclado). O merge garante isso refazendo a cadeia, como descrito abaixo.

### 2. O produto mesclado vira apelido do destino (a decisão central)

- **`CatalogDatabase.findProductsByNormalizedName`** (`src/infrastructure/sqlite/catalog-database.ts`) passa a devolver `coalesce(MergedIntoId, Id) AS id`. A consulta continua usando o índice da 004.
- **Consequência:** um item com o nome e a marca de D é ligado a P.
  - **O reenvio do item de D** dá `alreadyLinked`. Sem isso, o item cairia em "criar produto" e terminaria em `conflict`, porque o SKU já aponta para P.
  - **Um seller novo com a mesma variação** (por exemplo, `Galaxy S23` / `Samsung Electronics`) liga direto a P. O merge "ensina" a variação ao sistema.
- **`ImportCatalog.lookUp`** (`src/application/import-catalog.ts`): dois candidatos que resolvem para o **mesmo** id não são ambíguos. A comparação passa a ser por id distinto. Os `similarProductIds` também são deduplicados.

### 3. Caso de uso `MergeProducts` (`src/application/merge-products.ts`)

O método `execute(duplicateId, targetId)` roda numa transação (`CatalogDatabase.transaction`).

**Validações** (cada uma lança um `Error` com mensagem clara):
- os dois ids são diferentes;
- os dois produtos existem;
- a duplicata ainda não foi mesclada;
- o destino não foi mesclado (é preciso mesclar no produto ativo).

**Passos:**
1. **Move as ofertas de D para P:** `UPDATE SellerProduct SET ProductId = P WHERE ProductId = D`. Não há colisão de chave, porque a chave é `(SellerId, SellerProductId)`. Um seller pode acabar com dois SKUs para P, o que o modelo permite. Isso inclui as ofertas do `Marketplace`.
2. **Marca D:** `MergedIntoId = P`.
3. **Refaz a cadeia:** `UPDATE Product SET MergedIntoId = P WHERE MergedIntoId = D`, para manter a invariante.
4. **Resolve as revisões:** as revisões `pending` que citam D, como `ProductId` ou como `SimilarProductId`, viram `merged`. D deixou de existir como produto ativo, então as dúvidas sobre ele se encerram.

**Retorno:** quantas ofertas foram movidas e quantas revisões foram resolvidas.

### 4. Caso de uso `MarkDistinct` (`src/application/mark-distinct.ts`)

- `execute(productId, similarProductId)` muda a revisão `pending` do par (nos dois sentidos) para `distinct`.
- Se não houver revisão pendente desse par, lança erro.
- Ofertas e produtos não mudam.

### 5. Métodos novos no `CatalogDatabase`

Todos com queries parametrizadas:
- `findProductForMerge(id)`: devolve `{ id, mergedIntoId }` ou `undefined`;
- `moveOffers(fromId, toId)`: devolve o número de ofertas movidas;
- `markMerged(duplicateId, targetId)`: marca o produto e refaz a cadeia;
- `resolveReviewsOf(productId, status)`: devolve o número de revisões resolvidas;
- `markReviewDistinct(a, b)`: devolve o número de revisões alteradas;
- `listPendingReviews()`: devolve id, produto (nome e marca), produto parecido (nome e marca) e data.

### 6. CLI (`src/cli/catalog.ts`) e o script `catalog` no `package.json`

```bash
npm run catalog -- reviews                      # lista as revisões pendentes
npm run catalog -- merge <duplicata> <destino>  # mescla D em P
npm run catalog -- distinct <produto> <parecido>
```

- Opera na cópia `output/catalog.db`, com `openWorkingDatabase`, que recusa o banco original.
- Em caso de erro, mostra a mensagem e sai com código 1.

### 7. Quando a mesma situação se repete

Pergunta do usuário. Um item novo com o **mesmo nome e a mesma marca** de uma duplicata já resolvida não gera nova revisão, mas por motivos diferentes:

| Item novo (nome `Galaxy S23`) | Depois de mesclar D em P | Depois de marcar D e P como distintos |
|---|---|---|
| marca `Samsung` (a de P) | `linked` a P | `linked` a P |
| marca `Samsung Electronics` (a de D) | `linked` a **P**, pelo apelido (`MergedIntoId`) | `linked` a **D**, um produto ativo comum |
| marca `Samsung Elec.` (variação nova) | cria produto + revisão contra P | cria produto + revisões contra P e D |

Uma variação nova, que nenhuma decisão cobriu, continua gerando revisão. É o comportamento certo: é uma dúvida nova.

**Com a revisão ainda pendente** (pergunta do usuário): a mesma marca nova aparecendo de novo **não** volta para revisão.
- Na primeira vez, o item criou D e abriu a revisão (D, P).
- Enquanto ela está pendente, D é um produto comum com essa marca. Um segundo item com o mesmo nome e a mesma marca, de qualquer seller, encontra D e é ligado a ele (`linked`), sem criar produto nem abrir revisão.
- **Ao mesclar,** todas as ofertas acumuladas em D (dos dois sellers) passam para P de uma vez.
- **Ao marcar como distintos,** as ofertas continuam em D.

A revisão é aberta **uma vez por variação**, não uma vez por item. A decisão do revisor vale para todos os sellers que mandaram aquela variação.

## Testes planejados (SQLite real, sem mocks)

- **Migração 008:**
  - a coluna existe;
  - o `CHECK` recusa um produto mesclado em si mesmo;
  - a chave estrangeira recusa um destino inexistente;
  - a reversão funciona;
  - a lista de migrações inclui a 008.
- **`MergeProducts`:**
  - move as ofertas de vários sellers, inclusive do `Marketplace`;
  - marca D;
  - a revisão (D, P) vira `merged`;
  - outras revisões pendentes de D também viram `merged`;
  - a cadeia é refeita (C mesclado em D, depois D em P: C passa a apontar para P);
  - erros: o mesmo id, um id inexistente, uma duplicata já mesclada, um destino mesclado;
  - uma falha no meio desfaz tudo.
- **Importação depois do merge:**
  - o reenvio do item de D dá `alreadyLinked`;
  - um seller novo com o nome e a marca de D liga a P (`linked`), sem criar produto;
  - dois candidatos que resolvem para o mesmo id não são ambíguos.
- **`MarkDistinct`:** a revisão pendente vira `distinct`, nos dois sentidos do par; sem revisão pendente, dá erro; as ofertas não mudam.
- **Recorrência com revisão pendente:** o primeiro seller cria D e abre a revisão. Um segundo seller com o mesmo nome e marca resulta em `linked` a D, sem produto nem revisão novos. O merge de D em P move as **duas** ofertas para P.
- **Recorrência (seção 7):** um teste para cada célula da tabela. Depois de mesclar e depois de marcar como distintos, verifica que o item com a marca de D não cria produto nem revisão, e que uma variação nova cria um produto e abre as revisões esperadas.
- **`CatalogDatabase`:** `findProductsByNormalizedName` devolve o id resolvido e continua usando o índice (`EXPLAIN QUERY PLAN`); `listPendingReviews`.
- **Aceitação com o arquivo real:** inalterada (267 ligados, 1 já ligado, 1 criado, 0 revisões). Confirma que nada mudou para quem não usa o merge.

## Documentação a atualizar

- **Novo `docs/plans/012-merge-products.md`:** as decisões (apagar ou marcar, qualquer par, o apelido) e o resultado.
- **`docs/analysis/import-decision-flow.md`:** uma nota de que um produto mesclado é encontrado como apelido do destino.
- **`README.md`:** os comandos `catalog`, a migração 008, e o merge saindo da lista de evolução.
- **`CLAUDE.md`:** os comandos, os fatos da migração 008, a regra do apelido e a invariante de `MergedIntoId`.
- **`docs/CHANGELOG.md`.**

## Verificação

```bash
npm run typecheck && npm test && npm run format:check
npm run db:reset && npm run import                 # resultado igual ao de hoje
npm run catalog -- reviews                         # nenhuma revisão pendente
npm run catalog -- merge 2 2                       # erro: o mesmo produto
npm run catalog -- distinct 1 2                    # erro: sem revisão pendente
sha256sum data/catalog.db                          # igual ao de antes
```

## Desvios

- **Teste a mais:** merge de uma duplicata **ambígua** do catálogo (mesmo nome e mesma marca de #2). Antes do merge, o item fica `unmatched`. Depois, os dois candidatos resolvem para #2 e o item liga. O merge também desfaz ambiguidades.
- **O teste de `createProduct`** compara a linha inteira do produto, então passou a incluir `MergedIntoId: null`.
- **O CLI valida os ids** (inteiros positivos) antes de chamar os casos de uso.

## Resultado

- **197 testes passam,** contra o SQLite real e sem mocks. Entre eles, os da tabela da seção 7 e o da recorrência com revisão pendente.
- **A importação do arquivo do desafio não mudou:** 267 ligados, 1 já ligado, 1 criado, 0 revisões.
- **Ciclo completo pelo CLI, na cópia de trabalho:**
  - um item `Galaxy S23 / Samsung Electronics` gera a revisão (#977 contra #2);
  - `merge 977 2` move 1 oferta e resolve 1 revisão;
  - `reviews` fica vazio;
  - o reenvio do mesmo item dá `alreadyLinked`.
- **Os erros do CLI** (mesmo id, par sem revisão, id inválido) saem com código 1.
- O banco original continua intacto.
