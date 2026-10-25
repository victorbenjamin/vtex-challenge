# 005: Camadas e modelo de domínio rico

**Status:** concluído (2026-10-25)

## Objetivo

Reorganizar o código da importação (plano 004) em camadas, com orientação a objetos e um **modelo de domínio rico**: as regras de negócio ficam nos objetos que as possuem, em vez de em funções soltas ou no serviço. O comportamento não muda: o gabarito continua 200 ligados e 69 pendentes, com a importação idempotente.

## Contexto

- **Pedido do usuário:** código mais orientado a objetos, melhor separado em camadas e sem objetos anêmicos.
- **Tensão registrada:** isso pesa contra "começar simples" (plano 004, decisão 9) e contra "não explicar código fora do problema principal" (changelog, entrada 15). A mitigação é um DDD leve: três camadas, sem contêiner de injeção de dependência e sem classes base genéricas.
- **Testes:** o usuário exige que **não haja mocks**.
  - Tudo o que toca o banco (repositórios, aplicação, aceitação) usa uma cópia real do SQLite, migrada num diretório temporário.
  - O domínio é testado diretamente: não depende do banco, então não há o que substituir.

## Decisões

1. **Camadas e direção das dependências:** `cli → application → domain ← infrastructure`.
   - O domínio não importa nada de fora dele.
   - A infraestrutura implementa as interfaces que o domínio define.
2. **Onde ficam as regras:**

   | Objeto | Comportamento |
   |---|---|
   | `SellerProductEntry.parse(raw, index)` | Validação na criação. Um item que existe já é válido. |
   | `SellerName` (objeto de valor) | `trim`, igualdade sem diferenciar maiúsculas e `isReserved()` |
   | `Seller` | `offer(sku, product)` decide entre `linked`, `alreadyLinked` e `conflict`, e nunca sobrescreve. `register(name)` recusa o nome reservado. |
   | `Catalog` | `findExactMatch(attrs)`: o índice e a ambiguidade ficam encapsulados |
   | `Product` | Identidade e a chave de igualdade exata, com nulo igual a nulo |
   | `ImportReport` | `record*()`: registra cada resultado |

3. **A regra de conflito sai do SQL e vai para o domínio.**
   - `Seller` carrega as próprias ofertas e decide.
   - O repositório só insere as ofertas novas, obtidas com `pullNewOffers()`.
   - O `ON CONFLICT` deixa de ser necessário: a chave primária continua como última barreira.
4. **Identidade atribuída pela persistência.**
   - Um `Seller` novo nasce sem `id`.
   - `SellerRepository.save()` insere o seller e chama `assignId()`.
   - É a única operação de mutação exposta para a infraestrutura.
5. **Transação:** a interface `UnitOfWork` fica no domínio, e `SqliteUnitOfWork` implementa com `db.transaction`. A aplicação recebe a transação de fora.
6. **A constante do marketplace é do domínio** (`MARKETPLACE_SELLER_NAME` em `seller-name.ts`).
   - A migração 002 mantém o próprio valor literal, para continuar autossuficiente.
   - Um teste garante que os dois são iguais.
   - Isso corrige a dependência invertida do plano 004, em que o código importava da migração.
7. **Entrada:** `JsonEntrySource` (infraestrutura) só lê o arquivo e garante que é um array. A validação de cada item é do domínio.
8. **O banco e as migrações não mudam.** Os arquivos de `src/db/` vão para `src/infrastructure/sqlite/`.

## Estrutura

```
src/
  domain/          product, catalog, seller-name, seller, seller-product-entry, import-report, ports
  application/     import-catalog (caso de uso ImportCatalog)
  infrastructure/
    sqlite/        connection, migrations, unit-of-work, catalog-repository, seller-repository
    file/          json-entry-source
  cli/             db (db:migrate, db:reset), import (import)
tests/
  domain/          testes diretos dos objetos, sem banco e sem mocks
  infrastructure/  repositórios contra o SQLite real
  application/     ImportCatalog contra o SQLite real
  acceptance/      arquivo real de ponta a ponta
  db/              migrações (já existiam)
```

## Passos

- [x] Domínio e testes de domínio
- [x] Infraestrutura (mover `src/db`, repositórios, transação e leitura do arquivo) e testes contra o SQLite real
- [x] Aplicação (`ImportCatalog`) e testes contra o SQLite real
- [x] CLIs e scripts do `package.json`
- [x] Mover os testes antigos (`tests/import/*`) para as novas camadas e apagar `src/import/`
- [x] Teste de igualdade da constante do marketplace com a da migração 002
- [x] Atualizar o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **Simplificado no plano 007:** as interfaces de `ports.ts`, os repositórios, `UnitOfWork`, `Seller`, `SellerName` e `Product` foram removidos por serem cerimônia: cada interface tinha uma única implementação, e não há mocks.
- **Revisto no plano 006:** `Catalog` (em memória) virou `ExactProductMatcher` com consulta indexada; `Seller` deixou de carregar as ofertas, e a regra de conflito foi para `Offer.outcomeGiven()`; o repositório de ofertas voltou a usar `ON CONFLICT`, desta vez para segurança com concorrência.
- **`Product` ficou só com identidade e a chave exata.** Um método `isExactly()` foi removido por não ter uso. A regra de comparação vive em `Catalog`.
- **O repositório de seller não usa mais `ON CONFLICT`.** Quem decide o que é novo é o `Seller`, e a chave primária continua sendo a última barreira.

## Resultado

- 86 testes passam, distribuídos em `tests/domain`, `tests/infrastructure`, `tests/application`, `tests/acceptance` e `tests/db`. Nenhum usa mocks.
- O domínio não importa nada de fora de `src/domain/` (verificado por busca nos imports).
- `npm run db:reset && npm run import`: 200 ligados e 69 pendentes. Na segunda execução, 200 já ligados, como no plano 004.
- O banco original continua intacto.
