# CLAUDE.md

Take-home da VTEX, "Catalog Consolidation": importar produtos de vários sellers (`data/ProductEntry.json`) para o catálogo SQLite (`data/catalog.db`), sem duplicar produtos e ligando cada seller ao produto em `SellerProduct`. O desafio tem ambiguidades intencionais. A avaliação pesa as decisões justificadas e o uso crítico de IA, e haverá uma entrevista ao vivo sobre o código.

## Preferências de trabalho (obrigatórias)

1. **Criticar antes de executar.** Antes de fazer qualquer coisa pedida, compare com as análises em `docs/analysis/` e com os planos em `docs/plans/`. Se houver contradição, explique por que não é uma boa ideia, citando o documento e a seção, e **pergunte se devo prosseguir mesmo assim**. Sem contradição, siga.
2. **Commit e push só quando o usuário pedir.** Nunca por iniciativa própria.
3. **Changelog.** Registre em `docs/CHANGELOG.md` tudo o que for feito, em ordem cronológica e com entradas novas no fim. Inclua o que mudou e onde, e o motivo quando não for óbvio.
4. **Planos salvos.** Toda tarefa que tiver plano tem o plano salvo em `docs/plans/`, no formato descrito em `docs/plans/README.md`. Mantenha o status e os desvios atualizados durante a execução.
5. **Docs enxutos e navegáveis.** Organize a documentação para dar contexto rápido sem carregar o que não é necessário. Não use `@imports` aqui, e leia cada documento só quando a tarefa pedir.
6. **O banco original nunca é alterado.**
   - `data/catalog.db` é somente leitura: abra sempre com `{ readonly: true }`.
   - Toda alteração de schema é feita por **migração**: um arquivo versionado, aplicado em ordem e idempotente.
   - Toda migração é **testada e executada contra uma cópia** do banco original, por exemplo em `output/` ou num arquivo temporário nos testes. Nunca contra o original.
7. **README para os avaliadores.** Mantenha o `README.md` da raiz atualizado sempre que algo mudar: comandos, schema, decisões, status ou limitações. Ele é escrito para os avaliadores entenderem o projeto sem ler o resto.
   - Ele **resume e aponta** para `docs/`, sem duplicar o conteúdo.
   - É público: descreve o problema com palavras próprias e **nunca reproduz** o conteúdo de `docs/challenge/`.
   - Ao atualizar o changelog, verifique se o README também precisa mudar.

## Stack e comandos

TypeScript (ESM, `strict`), Node `>=22`, `better-sqlite3`, `knex` (só para migrações), `fastest-levenshtein` (similaridade de nomes), `tsx`, `vitest` e `prettier`. Os motivos estão em `docs/plans/001-typescript-environment.md`.

```bash
npm start              # roda src/index.ts com tsx
npm run typecheck      # tsc --noEmit (o tsx não verifica tipos)
npm test               # vitest run (tests/**/*.test.ts)
npm run format:check   # prettier
npm run db:migrate     # cria output/catalog.db (se faltar) e aplica as migrações pendentes
npm run db:reset       # recopia o original para output/ e aplica todas as migrações
npm run import         # importa data/ProductEntry.json em output/catalog.db; contagens no log e relatório item a item em output/import-report.json
npm run catalog -- reviews | merge <duplicata> <destino> | distinct <produto> <parecido>
```

**Migrações:** usam o Knex, só para migrações (a aplicação usa `better-sqlite3` diretamente).

- Os arquivos ficam em `migrations/NNN_descricao.ts`, com `up` e `down` em SQL via `knex.raw`.
- A configuração fica em `src/infrastructure/sqlite/migrations.ts` (`createMigrator`), que recusa o banco original, assim como `src/infrastructure/sqlite/connection.ts`.
- Detalhes em `docs/plans/002-schema-migration.md`.

Antes de considerar uma tarefa pronta, rode `typecheck`, `test` e `format:check`.

**Arquitetura** (planos 005, 006 e 007): `cli → application → domain`, com `infrastructure` usada pela aplicação. **Mantenha poucos tipos** (plano 007): `SellerProductEntry`, `Offer`, `ImportSummary`, `ItemResult`/`ImportRecord` (domain), `ImportCatalog`, `ProductMatcher`, `MergeProducts`, `MarkDistinct` (application) e `CatalogDatabase` (infrastructure, todo o SQL).

- **O domínio (`src/domain/`) não importa nada de fora dele.** As regras ficam nos objetos que têm os dados (`SellerProductEntry.parse`/`hasBrand`, `Offer.outcomeGiven`, `NameSynonyms.translate`). Não crie interfaces sem uma segunda implementação (não há mocks), nem classes sem comportamento.
- **Desenho para volume** (plano 006): nada é carregado inteiro (catálogo ou ofertas de um seller), as consultas são por chave ou índice, as transações são curtas, uma por item (o lote foi retirado temporariamente a pedido do usuário), e a gravação é segura contra concorrência ("insere se não existir" e reavaliação). Não reintroduza carga em memória nem uma transação única.
- **Testes sem mocks:**
  - domínio testado diretamente;
  - `CatalogDatabase`, aplicação e aceitação contra o SQLite real, via `tests/helpers/working-database.ts` (`createMigratedDatabase`, `sqliteImportCatalog`).

## Mapa da documentação: leia sob demanda

| Arquivo                                    | Quando ler                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                | Visão do projeto para os avaliadores: status, decisões e como rodar. Atualize-o junto com as mudanças (preferência 7).                                                                                        |
| `docs/CHANGELOG.md`                        | Para saber o que já foi feito e em que ordem                                                                                                                                                                  |
| `docs/plans/`                              | Antes de implementar algo. Verifique se existe um plano relacionado.                                                                                                                                          |
| `docs/analysis/data-analysis.md`           | Para decisões sobre schema, validação, normalização, matching ou testes. A seção 4 lista as decisões que saem dos dados, e a seção 5 é o gabarito de aceitação.                                               |
| `docs/analysis/import-decision-flow.md`    | Para entender o caminho de um item na importação (desenho do fluxo) e todos os resultados possíveis (`rejected`, `linked`, `alreadyLinked`, `conflict`, `unmatched`, `created`), com quando cada um acontece. |
| `docs/analysis/evolution.md`               | Para saber o que foi discutido e deixado de fora, por quê, e em que ordem faria sentido implementar. Consulte antes de propor uma evolução.                                                                   |
| `docs/analysis/performance-and-scale.md`   | Para decisões de desempenho e escala: medições (custo da confirmação por item, vazamento de memória dos prepared statements), projeção para Postgres e ordem de melhorias.                                    |
| `docs/analysis/entity-resolution-study.md` | Para escolher ou justificar uma técnica de matching. A seção 2 trata do trade-off entre precisão e recall, e a seção 5 da cascata recomendada.                                                                |
| `docs/challenge/summary.md`                | Para o enunciado e as orientações da VTEX. Esta pasta é **local e confidencial**: está no `.gitignore` e nada dela deve ir para arquivos versionados. Prefira este resumo aos PDFs.                           |

## Fatos essenciais (detalhes em `docs/analysis/data-analysis.md`)

- **`Product`:** 975 linhas, sem duplicatas. 119 sem marca, 34 sem categoria.
- **Schema original:** `SellerProduct` vazia, com `SellerProductId INTEGER` (os IDs do arquivo são UUIDs em texto). Sem índices nem restrições de unicidade.
- **Schema após a migração 001:**
  - `Seller (Id, Name UNIQUE COLLATE NOCASE)`.
  - `SellerProduct (SellerId, SellerProductId TEXT, ProductId)`, com chave primária `(SellerId, SellerProductId)`, `WITHOUT ROWID` e índice em `ProductId`.
  - **Cada linha é uma oferta (um SKU do seller).** Um seller pode ter vários SKUs para o mesmo produto.
- **Após a migração 002:** existe o seller `Marketplace` (o próprio marketplace), com uma oferta para cada um dos 975 produtos. O `SellerProductId` dessas ofertas é o `Product.Id` em texto. O arquivo de importação pode trazer itens do `Marketplace`, sem tratamento especial.
- **Migração 003:** criou o índice `IX_Product_Name_Brand_Category`; a **migração 005 o removeu**, porque a importação busca só pelo nome normalizado (todo match exato também é normalizado).
- **Após a migração 004:** coluna `Product.NormalizedName`, preenchida, com índice `IX_Product_NormalizedName_Brand_Category`.
  - A migração tem uma **cópia congelada** da normalização (`normalizeAtMigration004`), e um teste a compara com `normalizeProductName` (`src/domain/product-name.ts`).
  - **Se a normalização mudar,** crie uma nova migração que recalcule a coluna. Nunca edite a 004.
  - **Todo produto criado** pela importação precisa gravar o `NormalizedName`.
- **Após a migração 006:** tabela `NameSynonym (Term, Replacement)`, com `roteador → router` e `processador → processor`.
- **Após a migração 007:** tabela `ProductReview (ProductId, SimilarProductId, Reason, Status)`, com as possíveis duplicatas criadas pela importação. O status é `pending`, `merged` ou `distinct`.
- **Relatório da importação** (plano 014): `ImportCatalog.execute(items, onItem)` chama `onItem` com um `ImportRecord` por item, **depois** da confirmação da transação. O CLI grava os registros em fluxo num array JSON (`JsonArrayFile`), sem guardar o relatório na memória. Os motivos (`reason`) estão listados em `src/domain/import-record.ts`. **Divisão:**
  - `ProductMatcher` busca o produto (`match`: `found`, `ambiguous`, `tooManyCandidates`, `notFound`);
  - `ImportCatalog` decide e grava, devolvendo resultados pelos construtores `ItemResult.*`;
  - `toImportRecord` monta o registro;
  - `ImportSummary.add` conta.
- **Após a migração 009:** índice `IX_Product_Brand` e o motivo de revisão `similarName` (plano 015).
  - Ao criar um produto, `ProductMatcher.similarNamesOf` compara o nome com os produtos ativos da mesma marca (`areSimilarNames`: palavras ordenadas, Levenshtein ≥ 0.85, os mesmos números) e registra as revisões.
  - **A similaridade nunca liga uma oferta;** só gera revisão.
- **Após a migração 008:** coluna `Product.MergedIntoId` (plano 012).
  - Um produto mesclado **não é apagado**: vira apelido do destino. `findProductsByNormalizedName` devolve `coalesce(MergedIntoId, Id)`, e os candidatos são deduplicados por id.
  - **Invariante:** `MergedIntoId` sempre aponta para um produto ativo. `markMerged` refaz a cadeia.
  - `MergeProducts` move as ofertas, marca o produto e encerra as revisões; `MarkDistinct` encerra a revisão do par.
  - Os sinônimos valem **num sentido só e só no nome do item**. O catálogo e o `NormalizedName` não mudam, então incluir um sinônimo não exige migração.
- **Regra de match (planos 009 e 010):**
  - nome normalizado (`normalizeProductName`) e marca normalizada (`normalizeBrand`, com nulo só igual a nulo);
  - a categoria é ignorada;
  - a marca é filtrada no domínio (`SellerProductEntry.hasBrand`), sobre os candidatos de `findProductsByNormalizedName`, com teto `CANDIDATE_LIMIT`;
  - só um candidato casa;
  - **cascata:** primeiro o nome do próprio item; só se não houver nenhum candidato da marca, o nome traduzido (`NameSynonyms.translate`). Se o nome do item for ambíguo, a tradução não é tentada.
  - **sem produto da marca por nenhum dos dois nomes (plano 011):** cria o produto, com o `NormalizedName`. Resultado `created` se o nome é inédito, `createdForReview` se ele existe com outra marca, com uma linha em `ProductReview` por produto parecido. Não cria se o SKU já aponta para algum produto (`conflict`), nem se o item é ambíguo (`unmatched`).
  - **princípio:** ligar ao produto errado é o erro caro; uma duplicata é recuperável por merge.
- **Conexões de escrita da cópia de trabalho** (`WORKING_DATABASE_PRAGMAS`, em `connection.ts`): `foreign_keys = ON`, `journal_mode = WAL` e `synchronous = NORMAL` (plano 017). Aplicadas por `openWorkingDatabase` e pelo migrador. `createWorkingCopy` apaga os `-wal` e `-shm` antigos antes de copiar. O original nunca entra em WAL.
- **Prepared statements:** no `CatalogDatabase`, use sempre `this.statement(sql)`, que reaproveita o statement. Nunca chame `db.prepare` a cada consulta: a memória nativa cresceria com o tamanho do arquivo (plano 016).
- **Arquivo:** 269 itens. 268 correspondem a produtos existentes. O único sem correspondente é um teste de SQL injection com ID malformado.
- **IDs:** únicos só por seller. A chave natural é `(SellerName, Id)`.
- **Falsos positivos:** fuzzy matching ingênuo junta produtos diferentes (Multivitamin Men e Women, 0.94). A precisão vem antes do recall.
- **Queries sempre parametrizadas.** O arquivo contém uma tentativa de SQL injection.
- **`data/catalog.db` é a entrada original e não pode ser alterada** (preferência 6). O trabalho acontece numa cópia em `output/`, que está no `.gitignore`.

## Decisões pendentes

- Nenhuma no momento.

Ao decidir, mova o item para o plano ou o changelog correspondente.
