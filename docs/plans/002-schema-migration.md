# 002: Migração de schema (Seller e chave da oferta)

**Status:** concluído (2026-10-25)

## Objetivo

Ajustar o schema para representar corretamente sellers e ofertas, através de um processo de migração versionado e testado contra uma cópia do banco. O banco original não pode ser tocado (preferência 6 do `CLAUDE.md`).

## Contexto

- `SellerProductId` é `INTEGER`, mas os IDs do arquivo são UUIDs em texto ([data-analysis §1.1](../analysis/data-analysis.md)).
- Os IDs só são únicos por seller, então a identidade natural de uma oferta é `(seller, id do seller)` ([§2.2, §4 item 1](../analysis/data-analysis.md)).
- Há 10 casos de um mesmo seller com dois IDs para o mesmo produto ([§2.3](../analysis/data-analysis.md)).
- O schema original não tem índices nem restrições de unicidade.

## Decisões

1. **Cada linha de `SellerProduct` é uma oferta**, ou seja, um SKU do seller ligado a um produto do catálogo.
   - Um seller pode ter vários SKUs para o mesmo produto. Isso resolve o caso da §2.3 pela opção "um link por SKU".
   - "O seller vende o produto" passa a ser uma consulta (`DISTINCT`).
   - *Descartado:* chave primária `(ProductId, Seller)`. Ela impõe um link por produto, perde o código do seller e faz da correção de um match uma troca de chave primária.
2. **A chave primária é `(SellerId, SellerProductId)`, em tabela `WITHOUT ROWID`.** O `Id` artificial é removido, porque nada o referenciava.
   - Índice em `ProductId` para responder "quem vende o produto X".
3. **`SellerProductId` passa a `TEXT`**, com `CHECK` para impedir valor vazio.
4. **Tabela `Seller (Id, Name UNIQUE COLLATE NOCASE)`.**
   - O nome é comparado exatamente, sem espaços nas pontas e sem diferenciar maiúsculas de minúsculas. **Não há normalização aproximada:** identidade de seller não pode ser aproximada.
   - *Descartado:* só o `SellerName` normalizado em `SellerProduct`. Não garante integridade, dificulta renomear e não deixa lugar para atributos do seller.
5. **O nome `SellerProduct` é mantido** por ser o que o enunciado descreve. O significado fica documentado no schema.
6. **Mecanismo de migração: Knex** (revisado; veja *Desvios*).
   - As migrações são arquivos TS numerados em `migrations/` (`NNN_descricao.ts`), com `up` e `down` escritos em SQL via `knex.raw`.
   - O Knex controla o que foi aplicado (`knex_migrations`), usa lock (`knex_migrations_lock`) e roda cada migração numa transação.
   - *Descartado:* executor próprio com `PRAGMA user_version`. Funcionava e tinha testes, mas era código fora do problema principal para manter e explicar.
   - *Descartado:* umzug. Exigiria escrever o armazenamento do controle para SQLite.
   - *Descartado:* Kysely Migrator. Faria sentido só se o Kysely também fosse usado nas queries.
   - *Descartado:* Drizzle e Prisma. Exigiriam adotar o ORM inteiro.
7. **A migração preserva os dados existentes:** recria a tabela, copia as linhas e cria os sellers a partir de `SellerName`.
   - O `SellerProduct` original está vazio, mas a migração não depende disso.
   - Duas linhas antigas com o mesmo `(seller, id)` fazem a migração falhar, de propósito, em vez de perder dados em silêncio.
8. **Proteção do banco original:**
   - A função que abre o banco para escrita recusa o caminho `data/catalog.db`.
   - O banco de trabalho é `output/catalog.db`, criado como cópia do original.
   - Os testes conferem o SHA-256 do original antes e depois.

## Passos

- [x] `migrations/001_seller_and_offer_keys.ts` com `up` e `down`
- [x] `src/db/connection.ts`: caminhos, cópia de trabalho e abertura com `foreign_keys = ON`, recusando o original
- [x] `src/db/migrations.ts`: configuração do Knex (`createMigrator`), que também recusa o original
- [x] `src/db/cli.ts` com os scripts `db:migrate` (cria a cópia se faltar e aplica as pendentes) e `db:reset` (recopia o original e aplica tudo)
- [x] Testes em `tests/db/migrations.test.ts`: aplicação na cópia, idempotência, reversão, falha atômica, preservação de dados, restrições, original intacto e recusa do original
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset` de ponta a ponta

## Desvios

- O `better-sqlite3` já abre as conexões com `foreign_keys = 1`, por opção de compilação. Mesmo assim, o pragma é ligado explicitamente na conexão, para não depender disso.
- **A decisão 6 foi trocada de executor próprio para Knex.** O usuário não quer ter de explicar código fora do problema principal e pediu um framework conhecido. O executor próprio (`src/db/migrate.ts` e `migrations/001_*.sql`) foi removido antes de ser commitado.
  - **Ganho:** reversão (`down`), tabela de controle e lock, sem código próprio.
  - **Custo:** mais uma dependência. As migrações passam a ser arquivos TS, com o SQL dentro de `knex.raw`.
  - **Observação:** o Knex é usado só para as migrações. A aplicação continua acessando o banco com `better-sqlite3` diretamente.
