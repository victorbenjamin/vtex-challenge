# Changelog

Registro cronológico de tudo o que foi feito no projeto, da entrada mais antiga para a mais recente. Novas entradas vão no fim.

## 2026-10-25

1. **Leitura do enunciado.** Extraídos os links dos dados (`catalog.db` e `ProductEntry.json`, num bucket S3 da VTEX) e feito um primeiro levantamento das ambiguidades.
2. **Organização do projeto.**
   - Dados em `data/` e documentos em `docs/`.
   - `git init` na branch `main`.
   - `.gitignore` criado.
3. **Publicação.** Repositório público criado em https://github.com/victorbenjamin/vtex-challenge e feito o primeiro push.
4. **Confidencialidade.** Adicionado o PDF de orientações, que tem aviso de confidencialidade.
   - Os PDFs foram excluídos do versionamento.
   - O enunciado, que já tinha sido enviado, foi removido do histórico. O primeiro commit foi refeito (`c7d7462`) e enviado com force push.
5. **Estudo de técnicas.** Entity resolution e product matching: técnicas, prós e contras, e abordagem recomendada. → `docs/analysis/entity-resolution-study.md`
6. **Análise dos dados.** Perfil completo do banco e do arquivo. → `docs/analysis/data-analysis.md`
   - **Achado principal:** 268 dos 269 itens correspondem a produtos já existentes. O único sem correspondente é um teste de SQL injection.
   - As contagens do estudo foram corrigidas com base nesta análise.
7. **Commit `cc24f9b`.** Os dois documentos de análise foram enviados ao GitHub.
8. **Documentação para o Claude Code.**
   - `CLAUDE.md` criado com as preferências de trabalho.
   - `docs/` reorganizado em `analysis/`, `plans/` e `challenge/` (esta última local e no `.gitignore`).
   - Criados este changelog e o resumo local do desafio.
9. **Commit e push** do `CLAUDE.md`, do changelog e da reorganização de `docs/`.
10. **Ambiente TypeScript.** Plano em `docs/plans/001-typescript-environment.md`.
    - `package.json` (ESM, Node `>=22`), `tsconfig.json` estrito, `vitest.config.ts`, `.prettierrc`, `.prettierignore` e `.nvmrc`.
    - Dependências: `better-sqlite3`; para desenvolvimento, `typescript` 7, `tsx`, `vitest`, `prettier` e os tipos.
    - `src/index.ts` provisório e `tests/environment.test.ts`, um teste de fumaça que lê o `catalog.db` somente para leitura e confirma 975 produtos.
    - Os scripts `typecheck`, `test` e `format:check` passam.
    - `CLAUDE.md` atualizado com a stack e os comandos.
11. **Nova preferência (6): o banco original nunca é alterado.** Mudanças de schema só por migrações versionadas, testadas e executadas contra uma cópia do `catalog.db`. Registrada no `CLAUDE.md`.
12. **Commit e push** do ambiente TypeScript e da preferência 6.
13. **Decisão de modelagem.** Cada linha de `SellerProduct` é uma oferta, ou seja, um SKU do seller. Um seller pode ter vários SKUs para o mesmo produto, o que resolve os 10 casos da `data-analysis §2.3`. Também foi decidido criar a tabela `Seller`, comparando nomes exatamente e sem normalização aproximada.
14. **Migração de schema.** Plano em `docs/plans/002-schema-migration.md`.
    - `migrations/001_seller_and_offer_keys.sql` cria a tabela `Seller` e recria `SellerProduct` com chave primária `(SellerId, SellerProductId TEXT)`, `WITHOUT ROWID`, índice em `ProductId` e `CHECK`s. Os dados existentes são preservados.
    - O executor fica em `src/db/migrate.ts` e usa `PRAGMA user_version`, com uma transação por migração (substituído pelo Knex na entrada 15).
    - `src/db/connection.ts` recusa escrita no original, e `src/db/cli.ts` ganhou os scripts `db:migrate` e `db:reset`.
    - Os testes em `tests/db/migrate.test.ts` (14 casos) cobrem a aplicação numa cópia, a idempotência, a preservação de dados, as restrições, a chave estrangeira e o índice, e conferem que o original fica intacto (SHA-256).
    - `tsconfig.json` ganhou `allowImportingTsExtensions`.
15. **Migrações passam a usar o Knex.** O usuário não quer ter de explicar código fora do problema principal. Registrado como desvio no plano 002.
    - O executor próprio (`src/db/migrate.ts` e `migrations/001_*.sql`) foi removido antes de ser commitado.
    - Entram `migrations/001_seller_and_offer_keys.ts` (com `up` e `down` em SQL via `knex.raw`) e `src/db/migrations.ts` (`createMigrator`, que recusa o original).
    - Os testes passaram para `tests/db/migrations.test.ts`. Ganharam os casos de reversão e de recusa do original pelo migrador: 16 testes no total.
    - O Knex é usado só nas migrações. A aplicação segue com `better-sqlite3`.
16. **Decisão: IDs do seller aceitos em qualquer formato não vazio.** O ID pertence ao seller e o marketplace não impõe formato. Os 3 IDs fora do formato UUID (#92, #180 e #268) são aceitos.
    - **Consequência:** o `Security Test Product` (#180) vira um produto novo, com a marca gravada como texto. Não se rejeita item por conteúdo que "parece SQL"; a proteção é a parametrização.
    - **Custo aceito:** um ID digitado errado pode gerar uma oferta duplicada quando o seller reenviar com o código correto.
    - `data-analysis.md` §4 (item 4) e §5 (gabarito) foram atualizados. O gabarito agora é 1 produto novo, 0 rejeitados e 268 ofertas.
17. **Commit e push** da migração de schema (Knex), das decisões de modelagem e de IDs, e da documentação atualizada.
18. **Nova preferência (7): README para os avaliadores.** Registrada no `CLAUDE.md`: manter o `README.md` atualizado a cada mudança, sem duplicar `docs/` e sem reproduzir o conteúdo confidencial de `docs/challenge/`.
19. **`README.md` criado.** Contém o problema descrito com palavras próprias, o status, como rodar, os achados dos dados, o modelo de dados, a tabela de decisões e hipóteses, a abordagem de matching planejada, a estrutura do repositório, a stack e o uso de IA.
20. **Commit e push** do `README.md` e da preferência 7.
