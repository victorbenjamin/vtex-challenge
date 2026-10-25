# 009: Importação, incremento 3 (variações de marca e categoria)

**Status:** concluído (2026-10-25)

## Objetivo

Terceira linha da tabela da [data-analysis §3.1](../analysis/data-analysis.md): itens com o mesmo nome do catálogo, mas com **marca ou categoria escritas de outro jeito**.
- **#188** SportsHub `Belt Leather Reversible`, marca `Levi's` → produto 322 (marca `Levis`).
- **#87** GardenStore `Camera Canon EOS R6`, categoria `Photo`, ID `e6e6…` → produto 18 (categoria `Photography`).

## Contexto

- **A análise já recomendava as duas regras:**
  - §4, item 9: comparar a marca normalizada (sem espaços, pontuação e caixa), com nulo compatível com nulo;
  - §4, item 10: a categoria é pouco confiável, então serve como desempate e nunca como bloqueio.
- **Simulação sobre os dados reais:**
  - nenhum par de produtos do catálogo tem o mesmo nome normalizado, nem ignorando marca e categoria;
  - a regra nova liga exatamente #87 e #188;
  - nenhum item já ligado muda de produto.
- **Variações de marca dentro do próprio catálogo,** que a normalização trata como iguais: `AmazonBasics`/`Amazon Basics`, `BLACK+DECKER`/`Black+Decker`, `simplehuman`/`Simplehuman`, `SimpleHouseware`/`Simple Houseware`.

## Decisões

1. **`normalizeBrand`** (`src/domain/brand.ts`):
   - remove acentos;
   - converte para minúsculas;
   - remove tudo que não é letra ou dígito;
   - `null` continua `null`.
2. **`SellerProductEntry.hasBrand(brand)`:** compara as marcas normalizadas. Nulo é igual a nulo, e nulo é diferente de uma marca. A regra fica no objeto que tem os dados.
3. **A marca é comparada no domínio, sem migração** (escolha do usuário).
   - `CatalogDatabase.findProductsByNormalizedName(normalizedName, limit)` devolve `{ id, brand }`.
   - A consulta usa o prefixo do índice da migração 004, que também cobre a coluna `Brand`.
   - *Descartado:* uma coluna `NormalizedBrand` com índice (migração 006). Manteria a consulta com `LIMIT 2` exato, mas traria mais uma migração e mais uma cópia congelada.
4. **Teto de candidatos** (`CANDIDATE_LIMIT = 50`).
   - Se a busca chegar ao teto, o item fica `unmatched`: não dá para garantir que não exista outro produto com a mesma marca além do teto.
   - É o custo de filtrar a marca fora do banco.
5. **A categoria sai da comparação.**
   - Dois produtos com o mesmo nome e marca ficam ambíguos e não casam, mesmo com categorias diferentes.
   - Não há desempate por categoria, porque nenhum caso nos dados precisa dele. Fica registrado como evolução.

## Resultado esperado (gabarito)

| | Incremento 2 | **Incremento 3** |
|---|---|---|
| `linked` | 263 | **265** |
| `alreadyLinked` | 1 | 1 |
| `unmatched` | 5 | **3**: #57 `Roteador`, #64 `Processador`, #180 `Security Test Product` |
| Ofertas no total | 1.238 | **1.240** |

Na segunda execução: 266 `alreadyLinked`.

## Passos

- [x] `src/domain/brand.ts` e testes
- [x] `SellerProductEntry.hasBrand` e testes
- [x] `CatalogDatabase.findProductsByNormalizedName` (substitui `findProductIdsByNormalizedName`) e testes, incluindo o uso do índice
- [x] `ImportCatalog`: teto de candidatos e filtro por marca; testes da aplicação
- [x] Aceitação com o gabarito
- [x] Atualizar a `data-analysis` (§4, itens 9 e 10; §5), o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **`CatalogDatabase.findProductsByNormalizedName` recebe o nome normalizado,** e não a entrada inteira, porque a consulta não usa mais marca nem categoria. Por isso o `CatalogDatabase` não depende mais de `SellerProductEntry`.
- **Teste de infraestrutura:** a ordem dos candidatos segue o índice, porque não há `ORDER BY`. O teste passou a comparar a lista ordenada.

## Resultado

- **Bate com o gabarito:** 265 `linked`, 1 `alreadyLinked`, 3 `unmatched`, 0 `conflict`, 0 `rejected` e 1.240 ofertas. Na segunda execução, 266 `alreadyLinked`.
- **134 testes passam,** contra o SQLite real e sem mocks. Os novos cobrem:
  - `normalizeBrand` e `hasBrand`;
  - a consulta por nome devolvendo todas as marcas;
  - a escolha pela marca quando há vários produtos com o mesmo nome;
  - a ambiguidade com a mesma marca e categorias diferentes;
  - o teto de candidatos;
  - #87 → 18 e #188 → 322 na aceitação.
- O banco original continua intacto.
