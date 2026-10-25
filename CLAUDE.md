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

TypeScript (ESM, `strict`), Node `>=22`, `better-sqlite3`, `knex` (só para migrações), `tsx`, `vitest` e `prettier`. Os motivos estão em `docs/plans/001-typescript-environment.md`.

```bash
npm start              # roda src/index.ts com tsx
npm run typecheck      # tsc --noEmit (o tsx não verifica tipos)
npm test               # vitest run (tests/**/*.test.ts)
npm run format:check   # prettier
npm run db:migrate     # cria output/catalog.db (se faltar) e aplica as migrações pendentes
npm run db:reset       # recopia o original para output/ e aplica todas as migrações
```

**Migrações:** usam o Knex, só para migrações (a aplicação usa `better-sqlite3` diretamente).

- Os arquivos ficam em `migrations/NNN_descricao.ts`, com `up` e `down` em SQL via `knex.raw`.
- A configuração fica em `src/db/migrations.ts` (`createMigrator`), que recusa o banco original, assim como `src/db/connection.ts`.
- Detalhes em `docs/plans/002-schema-migration.md`.

Antes de considerar uma tarefa pronta, rode `typecheck`, `test` e `format:check`.

## Mapa da documentação: leia sob demanda

| Arquivo                                    | Quando ler                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                | Visão do projeto para os avaliadores: status, decisões e como rodar. Atualize-o junto com as mudanças (preferência 7).                                                              |
| `docs/CHANGELOG.md`                        | Para saber o que já foi feito e em que ordem                                                                                                                                        |
| `docs/plans/`                              | Antes de implementar algo. Verifique se existe um plano relacionado.                                                                                                                |
| `docs/analysis/data-analysis.md`           | Para decisões sobre schema, validação, normalização, matching ou testes. A seção 4 lista as decisões que saem dos dados, e a seção 5 é o gabarito de aceitação.                     |
| `docs/analysis/entity-resolution-study.md` | Para escolher ou justificar uma técnica de matching. A seção 2 trata do trade-off entre precisão e recall, e a seção 5 da cascata recomendada.                                      |
| `docs/challenge/summary.md`                | Para o enunciado e as orientações da VTEX. Esta pasta é **local e confidencial**: está no `.gitignore` e nada dela deve ir para arquivos versionados. Prefira este resumo aos PDFs. |

## Fatos essenciais (detalhes em `docs/analysis/data-analysis.md`)

- **`Product`:** 975 linhas, sem duplicatas. 119 sem marca, 34 sem categoria.
- **Schema original:** `SellerProduct` vazia, com `SellerProductId INTEGER` (os IDs do arquivo são UUIDs em texto). Sem índices nem restrições de unicidade.
- **Schema após a migração 001:**
  - `Seller (Id, Name UNIQUE COLLATE NOCASE)`.
  - `SellerProduct (SellerId, SellerProductId TEXT, ProductId)`, com chave primária `(SellerId, SellerProductId)`, `WITHOUT ROWID` e índice em `ProductId`.
  - **Cada linha é uma oferta (um SKU do seller).** Um seller pode ter vários SKUs para o mesmo produto.
- **Chave estrangeira:** sempre ative `foreign_keys = ON` na conexão (`openWorkingDatabase` já faz isso).
- **Arquivo:** 269 itens. 268 correspondem a produtos existentes. O único sem correspondente é um teste de SQL injection com ID malformado.
- **IDs:** únicos só por seller. A chave natural é `(SellerName, Id)`.
- **Falsos positivos:** fuzzy matching ingênuo junta produtos diferentes (Multivitamin Men e Women, 0.94). A precisão vem antes do recall.
- **Queries sempre parametrizadas.** O arquivo contém uma tentativa de SQL injection.
- **`data/catalog.db` é a entrada original e não pode ser alterada** (preferência 6). O trabalho acontece numa cópia em `output/`, que está no `.gitignore`.

## Decisões pendentes

- Os 777 produtos do catálogo sem seller pertencem à própria loja?

Ao decidir, mova o item para o plano ou o changelog correspondente.
