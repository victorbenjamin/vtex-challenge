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
21. **Decisão: o marketplace é um seller.** O próprio marketplace (`Marketplace`) oferta todos os produtos do catálogo atual, o que resolve a última decisão pendente (os 777 produtos sem seller). Plano em `docs/plans/003-marketplace-seller.md`.
    - `migrations/002_marketplace_seller.ts` é uma migração de dados que cria o seller e 975 ofertas, com `SellerProductId = Product.Id` em texto. O `down` remove só o que ela criou.
    - Testes: 975 ofertas, nenhum produto sem seller e reversão isolada da 002. Os testes existentes foram ajustados para a presença do novo seller. São 19 testes no total.
    - `data-analysis.md` §3.2, §4 (item 14) e §5 foram atualizados. O gabarito agora é de 1.243 ofertas no total.
    - `CLAUDE.md` e `README.md` também foram atualizados.
22. **Discussão: o marketplace como caso especial na importação.** A ideia de um parâmetro de configuração com o ID do marketplace foi criticada.
    - Excluir o marketplace só da busca não basta: criar um seller com o mesmo nome bateria no `UNIQUE`. O certo é rejeitar o item.
    - O ID é atribuído pelo banco, então guardá-lo numa configuração cria duas fontes da verdade.
    - A proposta é uma coluna `Seller.IsMarketplace` com índice único parcial. A decisão foi adiada pelo usuário e registrada como pendente no `CLAUDE.md`.
23. **Commit e push** da migração 002 (seller `Marketplace`), do plano 003 e da documentação atualizada.
24. **`CLAUDE.md`:** a decisão pendente sobre o marketplace foi ajustada. Como a 002 já foi publicada, a coluna `IsMarketplace` precisaria de uma migração 003.
25. **Importação, incremento 1 (match exato).** Plano em `docs/plans/004-import-exact-match.md`.
    - `src/import/`:
      - `entries.ts` lê e valida o arquivo;
      - `exact-match.ts` monta o índice em memória, em que nulo é igual a nulo e uma chave ambígua nunca casa;
      - `catalog.ts` reúne as queries parametrizadas;
      - `import-entries.ts` orquestra tudo numa transação e monta o relatório;
      - `cli.ts` implementa o script `npm run import`.
    - **Regras:**
      - itens sem match exato ficam `unmatched` e não são gravados nem criam produto;
      - um SKU que já aponta para outro produto vira `conflict` e não é sobrescrito;
      - reimportar resulta em `alreadyLinked`;
      - o nome do seller do marketplace é rejeitado.
    - **Resultado com o arquivo real:** 200 ligados e 69 pendentes. Na segunda execução, 200 `alreadyLinked`.
    - 57 testes no total. Novos: `tests/import/*` e o utilitário `tests/helpers/working-database.ts`.
    - `README.md` e `CLAUDE.md` foram atualizados.
26. **Camadas e modelo de domínio rico.** Plano em `docs/plans/005-layered-domain-model.md`. Pedido do usuário: código mais orientado a objetos, separado em camadas, sem objetos anêmicos e com testes sem mocks.
    - **Camadas:** `src/domain/`, `src/application/` (`ImportCatalog`), `src/infrastructure/sqlite/` e `src/infrastructure/file/`, e `src/cli/`. O `src/db/` foi movido para `infrastructure/sqlite` e `cli/db.ts`, e o `src/import/` foi apagado.
    - **As regras foram para os objetos:**
      - `Seller.offer()` decide entre `linked`, `alreadyLinked` e `conflict` (antes isso era feito por `ON CONFLICT` e uma conferência no SQL);
      - `SellerName` cuida da comparação e do nome reservado;
      - `Catalog` faz o match exato e trata a ambiguidade;
      - `SellerProductEntry.parse()` valida;
      - `ImportReport.record*()` registra os resultados.
    - **A dependência invertida foi corrigida:** `MARKETPLACE_SELLER_NAME` agora é do domínio, a migração 002 mantém o próprio valor literal, e um teste garante que os dois são iguais.
    - **Testes:** 86, reorganizados por camada e todos sem mocks. O domínio é testado diretamente; repositórios, aplicação e aceitação rodam contra o SQLite real.
    - **Comportamento inalterado:** 200 ligados e 69 pendentes, com a importação idempotente.
    - `README.md` ganhou a seção "Arquitetura" e a nova estrutura. `CLAUDE.md` também foi atualizado. O plano 004 registra que foi substituído.
27. **Importação com desenho escalável.** Plano em `docs/plans/006-scalable-import.md`. O usuário reavaliou a transação única: o desenho deve se sustentar com um banco de produção e com volume, e o SQLite é só o substituto local.
    - **Transações por lote** (`batchSize`, 500 por padrão, `--batch-size=N` no CLI). Uma falha desfaz só o lote em curso e interrompe a importação. O relatório registra os lotes confirmados e a falha. Rodar de novo completa o trabalho.
    - **O catálogo é consultado por índice, item a item.** A migração 003 cria `IX_Product_Name_Brand_Category`. `ExactProductMatcher` decide entre match e ambiguidade a partir de até 2 candidatos. O `Catalog` em memória foi removido.
    - **Agregados menores:** `Seller` ficou com a identidade e as regras de nome, e `Offer.outcomeGiven()` decide entre ligar, já ligado e conflito olhando só a oferta existente daquele SKU.
    - **Segurança com concorrência:** `OfferRepository.addIfAbsent` usa `ON CONFLICT DO NOTHING` e devolve a oferta existente, e `SellerRepository.save` faz "insere se não existir" e lê o Id de volta.
    - **Revisões registradas:** a `data-analysis §4` (item 12) e os planos 004 (decisões 3 e 7) e 005 receberam notas.
    - **Testes:** 96, sem mocks.
    - `README.md` e `CLAUDE.md` foram atualizados com as garantias, a evolução prevista e a migração 003.
28. **Simplificação temporária: uma transação por item, sem lote.** Pedido do usuário. Registrado como desvio no plano 006.
    - `ImportCatalog` processa cada item na própria transação. O resultado entra no relatório só depois da confirmação. Uma falha desfaz o item, é registrada como `failure { index, message }` e interrompe a importação.
    - Saíram a opção `batchSize`, o `--batch-size` do CLI e `committedBatches`/`recordCommittedBatch` do relatório, que agora usa `recordCommitted` e `recordFailure`.
    - **Custo aceito:** uma confirmação por item, sem a diluição que o lote oferece em volume.
    - **Testes:** 93. Os de lote foram trocados por testes de falha e retomada por item.
    - `README.md` e `CLAUDE.md` foram atualizados.
29. **Simplificação temporária: só contagens no log, sem relatório detalhado.** Pedido do usuário ("baby steps"). O relatório volta quando todas as regras estiverem implementadas.
    - `ImportReport` foi removido e entrou `src/domain/import-summary.ts` (`ImportSummary`), com as contagens de `linked`, `alreadyLinked`, `conflict`, `unmatched` e `rejected`, mais a falha.
    - `ImportCatalog.importItem` agora devolve o resultado do item (`ItemOutcome`), contado só depois da confirmação.
    - O CLI deixou de gravar `output/import-report.json` e mostra as contagens no log.
    - **Custo registrado:** quais itens ficaram pendentes, em conflito ou rejeitados (e por quê) deixa de aparecer. Ficou como decisão pendente no `CLAUDE.md`.
    - **Testes:** 97. Os da aplicação e da aceitação verificam o banco. Entrou `tests/domain/import-summary.test.ts`.
    - `README.md`, `CLAUDE.md` e o plano 006 foram atualizados. A referência à "migração 003" para `IsMarketplace` virou "nova migração", porque a 003 agora é o índice.
30. **Simplificação dos tipos.** Plano em `docs/plans/007-simplify-types.md`. O usuário achou o código complicado. A análise mostrou cerca de 25 tipos, muitos deles cerimônia: interfaces com uma única implementação e sem mocks, embrulhos de uma linha, classes sem comportamento e restos de reescritas.
    - **Ficaram 5 classes:**
      - `SellerProductEntry` (`parse` e `isFromMarketplace`, absorvendo o `SellerName`);
      - `Offer` (`outcomeGiven(existingProductId)`);
      - `ImportSummary`;
      - `ImportCatalog`, em que a regra de ambiguidade virou uma linha;
      - `CatalogDatabase`, com todo o SQL: `transaction`, `findProductIds`, `findOrCreateSeller` e `addOfferIfAbsent`.
    - **Uma função:** `readImportFile`.
    - **Removidos:** `ports.ts`, `product.ts`, `seller.ts`, `seller-name.ts`, `exact-product-matcher.ts`, os três repositórios, `unit-of-work.ts` e `json-entry-source.ts`.
    - **Comportamento e desenho escalável mantidos:** consulta por índice, transação por item, "insere se não existir".
    - **Testes:** 87, sem mocks, contra o SQLite real.
    - `README.md` (arquitetura e estrutura) e `CLAUDE.md` foram atualizados, e os planos 005 e 006 registram a simplificação.
31. **Commit e push** da importação por match exato (planos 004 a 007), da migração 003 e da documentação.
32. **Plano 008 proposto: match por nome normalizado** (segunda linha da `data-analysis §3.1`, 64 itens). Inclui as regras de normalização, a cascata exato → normalizado, a coluna `Product.NormalizedName` com índice (migração 004) e o gabarito conferido por simulação: 263 ligados, 1 já ligado e 5 pendentes.
33. **Importação, incremento 2 (nome normalizado).** Plano em `docs/plans/008-normalized-name-match.md`. A decisão da cópia congelada foi confirmada pelo usuário.
    - `src/domain/product-name.ts` (`normalizeProductName`): remove acentos, converte para minúsculas, remove `''` e `"`, junta espaços. Preserva números, pontos, hífens e barras. `SellerProductEntry.normalizedName` usa essa função.
    - **Migração 004:** coluna `Product.NormalizedName`, preenchida com a cópia congelada `normalizeAtMigration004`, e índice `(NormalizedName, Brand, Category)`, com `down`.
    - `CatalogDatabase.findProductIdsByNormalizedName`.
    - `ImportCatalog.findUniqueProduct` implementa a cascata: o exato primeiro; o normalizado só se o exato não achar nada; ambíguo não casa, em nenhuma etapa.
    - **Resultado:** 263 ligados, 1 já ligado e 5 pendentes, exatamente como o gabarito. 122 testes.
    - `data-analysis §5` ganhou os gabaritos por incremento. `README.md` e `CLAUDE.md` foram atualizados.
34. **Só o match por nome normalizado, sem a etapa exata.** Pedido do usuário depois da análise: todo match exato também é normalizado. A única diferença seria com dois produtos do catálogo que diferem só na grafia, caso que não existe nos dados; aí o item fica ambíguo, com perda de recall e sem risco de ligar ao produto errado. Registrado como desvio no plano 008.
    - Saíram `CatalogDatabase.findProductIds` e o `ImportCatalog.findUniqueProduct`. O caso de uso faz uma consulta só.
    - A **migração 005** remove o índice `IX_Product_Name_Brand_Category` (da 003, já publicada), com o `down` recriando-o.
    - **Testes:** 117. Os casos do exato foram reunidos nos do normalizado, e um teste documenta a perda de recall aceita.
    - **Resultado igual:** 263 ligados, 1 já ligado, 5 pendentes.
    - `README.md` (a cascata agora tem 4 passos, e a migração 005 entrou) e `CLAUDE.md` foram atualizados.
35. **Commit e push** do incremento 2 (nome normalizado), das migrações 004 e 005 e da documentação.
36. **Importação, incremento 3 (variações de marca e categoria).** Plano em `docs/plans/009-brand-category-variants.md`. O usuário escolheu comparar a marca no domínio, sem migração.
    - `src/domain/brand.ts` (`normalizeBrand`): remove acentos, converte para minúsculas e remove tudo que não é letra ou dígito. `null` continua `null`.
    - `SellerProductEntry.hasBrand(brand)` compara as marcas normalizadas, com nulo só igual a nulo.
    - `CatalogDatabase.findProductsByNormalizedName(normalizedName, limit)` substitui `findProductIdsByNormalizedName` e devolve `{ id, brand }`, usando o prefixo do índice da migração 004.
    - `ImportCatalog.findUniqueProduct`: busca até `CANDIDATE_LIMIT` (50) candidatos, filtra pela marca, e só liga se restar exatamente 1. Se chegar ao teto, o item fica `unmatched`. **A categoria deixou de ser comparada.**
    - **Resultado:** 265 ligados, 1 já ligado e 3 pendentes (#57, #64, #180), exatamente como o gabarito. 134 testes.
    - `data-analysis.md` (§4, itens 9 e 10, e §5), `README.md` e `CLAUDE.md` foram atualizados.
37. **Commit e push** do incremento 3 (variações de marca e categoria) e da documentação.
38. **Plano 010 proposto: sinônimos para traduções** (quarta linha da `data-analysis §3.1`: #57 `Roteador` e #64 `Processador`). O usuário escolheu uma tabela `NameSynonym` no banco (migração 006). Os sinônimos são aplicados num sentido só (vocabulário do seller para o do catálogo), só no nome do item e por palavra inteira, como fallback depois do nome original. Gabarito: 267 ligados, 1 já ligado, 1 pendente.
39. **Importação, incremento 4 (sinônimos para traduções).** Plano em `docs/plans/010-name-synonyms.md`.
    - **Migração 006:** tabela `NameSynonym (Term COLLATE NOCASE, Replacement)`, com `CHECK` de termo de uma palavra só e as traduções `roteador → router` e `processador → processor`.
    - `src/domain/name-synonyms.ts` (`NameSynonyms.translate`): troca por palavra inteira, com os termos e as substituições normalizados ao carregar.
    - `CatalogDatabase.loadNameSynonyms` é chamado uma vez por importação.
    - **Cascata em `ImportCatalog`:** primeiro o nome do próprio item; a tradução só se não houver nenhum candidato da marca. Se o nome do item for ambíguo, a tradução não é tentada.
    - **Resultado:** 267 ligados, 1 já ligado e 1 pendente (#180, sem produto no catálogo). 154 testes.
    - Os testes de migração ganharam o utilitário `rollBackTo`. A `data-analysis` (§4, item 7, e §5), o `README.md` e o `CLAUDE.md` foram atualizados; no `CLAUDE.md`, as notas da migração 004, que estavam fora do lugar, foram reorganizadas.
40. **Commit e push** do incremento 4 (sinônimos), da migração 006 e da documentação.
