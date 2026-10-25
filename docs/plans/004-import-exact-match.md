# 004: Importação, incremento 1 (match exato)

**Status:** concluído (2026-10-25)

## Objetivo

Primeira versão da importação. Ela resolve a primeira linha da tabela da [data-analysis §3.1](../analysis/data-analysis.md): os **200 itens iguais em nome, marca e categoria** a um produto do catálogo. A importação lê o arquivo, valida, encontra o produto por igualdade exata e grava a oferta em `SellerProduct`, na cópia de trabalho `output/catalog.db`.

As demais linhas da tabela (normalização, divergência de atributos, tradução, produto novo) entram como etapas seguintes da cascata ([estudo §5](../analysis/entity-resolution-study.md)).

## Contexto

Conferido nos dados:
- 200 itens têm match exato e formam **200 pares `(seller, id)` distintos**, de 20 sellers, para 197 produtos distintos.
- **3 deles têm `Brand = null`**, também nula no catálogo.
- Entre eles, 13 IDs se repetem entre sellers diferentes, e 1 ID está fora do formato UUID (aceito, pela decisão 16 do changelog).

## Decisões

1. **Itens sem match exato não são gravados nem viram produto novo.**
   - São 69 itens, e 68 deles existem no catálogo com outra grafia.
   - Criar produtos para eles geraria 68 duplicatas, contra o princípio de precisão em primeiro lugar ([estudo §2](../analysis/entity-resolution-study.md)).
   - Saem no relatório como **pendentes** (`unmatched`).
2. **Igualdade exata trata nulo como igual a nulo.** Em SQL, `NULL = NULL` não é verdadeiro. O índice em memória usa a chave `JSON.stringify([Name, Brand, Category])`, em que `null` é um valor comum.
3. **O índice do catálogo fica em memória**, sem coluna nova ([data-analysis §4, item 12](../analysis/data-analysis.md)). Com 975 produtos, construí-lo é instantâneo.
   - Se a mesma chave aparecer em dois produtos, a chave é tratada como **ambígua** e não casa com nenhum dos dois.
4. **Seller:** é reutilizado se existir, procurando o nome sem espaços nas pontas e sem diferenciar maiúsculas (`COLLATE NOCASE`); senão é criado. Só é criado quando há uma oferta a gravar.
5. **Nome reservado:** um item cujo seller tenha o nome `MARKETPLACE_SELLER_NAME` é **rejeitado**. É o requisito registrado como pendente no `CLAUDE.md`. A constante vem da migração 002: o código depende da migração, e não o contrário, para que a migração continue autossuficiente.
6. **Oferta:** `INSERT ... ON CONFLICT (SellerId, SellerProductId) DO NOTHING`, seguido de uma conferência:
   - inserida: `linked`;
   - já existia com o mesmo produto: `alreadyLinked` (reimportar não muda nada);
   - já existia com **outro** produto: `conflict`. Nada é sobrescrito e o item vai para o relatório.
7. **Uma única transação** para o arquivo inteiro: tudo é gravado ou nada é.
8. **O motivo do match ainda não é gravado.** Exigiria uma migração, e hoje só existe o motivo `exact`.
9. **Estrutura simples:** módulos pequenos em `src/import/`, sem framework de pipeline (decisão do usuário: "começar simples").

| Arquivo | Responsabilidade |
|---|---|
| `entries.ts` | Ler e validar o JSON |
| `exact-match.ts` | Índice exato em memória, com funções puras |
| `catalog.ts` | Acesso ao banco, com queries parametrizadas |
| `import-entries.ts` | Orquestração numa transação e montagem do relatório |
| `cli.ts` | `npm run import [arquivo]`: grava em `output/catalog.db` e gera `output/import-report.json` |

## Passos

- [x] `src/import/entries.ts` e testes
- [x] `src/import/exact-match.ts` e testes
- [x] `src/import/catalog.ts` e `src/import/import-entries.ts`, com testes sobre uma cópia migrada
- [x] `src/import/cli.ts` e o script `import`
- [x] Teste de aceitação com o arquivo real: 200 `linked`, 69 `unmatched`, 0 `rejected`, 0 `conflicts`, 20 sellers e 1.175 ofertas, com o original intacto
- [x] Atualizar o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import` (para verificar a idempotência)

## Desvios

- **As decisões 3 (índice em memória) e 7 (transação única) foram revistas no plano 006**, em favor de consultas indexadas e transações por lote, pensando em volume.
- **A estrutura em `src/import/` foi substituída pelo plano 005** (camadas e modelo de domínio rico). As regras e o comportamento foram mantidos.
- Foi criado o utilitário de teste `tests/helpers/working-database.ts` (`createMigratedDatabase`), que monta uma cópia migrada num diretório temporário e é compartilhado pelos testes da importação.

## Resultado

- **Primeira execução** de `npm run db:reset && npm run import`: 200 `linked`, 0 `alreadyLinked`, 0 `conflicts`, 69 `unmatched` e 0 `rejected`.
- **Segunda execução:** 0 `linked` e 200 `alreadyLinked`. A importação é idempotente.
- O `Security Test Product` fica entre os pendentes (`unmatched`).
- 57 testes passam, dos quais 38 novos, incluindo a aceitação com o arquivo real.
