# Fluxo de decisão de um item da importação

Como a importação decide o que fazer com cada item do arquivo, e quais resultados são possíveis. Reflete o código de `ImportCatalog` (`src/application/import-catalog.ts`) no plano 011. Qualquer seller pode enviar itens, inclusive o `Marketplace`: os itens dele viram ofertas do seller criado pela migração 002, sem tratamento especial.

## Desenho

```
                         item do arquivo
                               │
                     ┌─────────▼─────────┐
                     │      válido?      │── não ──► REJEITADO
                     └─────────┬─────────┘
                               │ sim (qualquer seller, inclusive o Marketplace)
                     ┌─────────▼──────────────────────────┐
                     │ busca pelo NOME NORMALIZADO do item │
                     │ e filtra pela MARCA normalizada     │
                     └─────────┬──────────────────────────┘
                               │
          ┌────────────────────┼─────────────────────────┐
          │                    │                         │
   nenhum produto       1 produto da               2+ produtos da mesma
   da mesma marca       mesma marca                marca (ou 50+ candidatos)
          │                    │                         │
          │                    ▼                         ▼
          │              ENCONTRADO               AMBÍGUO → PENDENTE
          │                                       (não tenta tradução,
          │                                        não cria)
          ▼
   ┌─────────────────────────────────────────────┐
   │ tenta o NOME TRADUZIDO (sinônimos), se mudou │
   └─────────┬───────────────────────────────────┘
             │
     1 da marca → ENCONTRADO · 2+ → AMBÍGUO → PENDENTE
             │
             ▼ nenhum da marca, por nenhum dos dois nomes
   ┌──────────────────────────────────────────────┐
   │ o SKU do seller já aponta para algum produto? │── sim ──► CONFLITO (nada é criado)
   └─────────┬────────────────────────────────────┘
             │ não
   ┌─────────▼──────────────────────────────────────────────┐
   │  O NOME (próprio ou traduzido) existe no catálogo,      │
   │  só que com OUTRA MARCA?                                │
   └─────────┬───────────────────────────────┬──────────────┘
             │ não: o nome é inédito         │ sim
             ▼                               ▼
      CRIA PRODUTO + oferta           CRIA PRODUTO + oferta
                                      + registra "possível duplicata"
                                        de cada produto com o nome,
                                        para revisão e merge posterior


   ENCONTRADO ──► o SKU do seller já tem oferta?
                    ├─ não ──────────────────────► LIGA (grava a oferta)
                    ├─ sim, para o mesmo produto ► JÁ LIGADO (nada muda)
                    └─ sim, para outro produto ──► CONFLITO (a oferta existente fica)
```

**Princípio por trás do desenho:** o erro caro é **ligar a oferta ao produto errado**, porque o cliente compraria uma coisa e receberia outra. Uma duplicata é recuperável com um merge ([estudo §2](entity-resolution-study.md)). Por isso:
- **Na dúvida sobre a marca,** o seller ganha um produto próprio, nunca o de outra marca, e a suspeita fica registrada em `ProductReview` (migração 007) para alguém revisar.
- **Um item ambíguo nunca cria produto:** se há vários produtos com o mesmo nome e a mesma marca, o produto existe, só não se sabe qual. Criar outro seria duplicata garantida.
- **A revisão é resolvida pelo comando `catalog`** (plano 012):
  - `merge` move as ofertas da duplicata para o produto certo (um `UPDATE` de `ProductId` em `SellerProduct`) e marca a duplicata com `MergedIntoId`;
  - `distinct` encerra a revisão sem mudar nada.
- **Um produto mesclado vira apelido:** a busca o encontra pelo nome e pela marca dele, mas devolve o produto em que foi mesclado. A mesma variação, depois de resolvida, não volta para revisão. Com a revisão ainda pendente, ela liga à duplicata, e o merge leva todas as ofertas juntas.

## Todos os resultados possíveis de um item

Cada item termina em exatamente um resultado, contado no `ImportSummary` (`src/domain/import-summary.ts`) e mostrado no log. O **relatório** (`output/import-report.json`, plano 014) grava, para cada item, o resultado e o motivo (`reason`):

| Resultado | `reason` | Campos extras |
|---|---|---|
| `linked`, `alreadyLinked` | `matchedByName` ou `matchedByTranslatedName` | `productId` |
| `conflict` | `skuPointsToAnotherProduct` | `existingProductId` (e `productId`, se o item casou com um produto) |
| `created` | `nameNotInCatalog` | `productId` |
| `createdForReview` | `nameExistsWithOtherBrand` | `productId`, `similarProductIds` |
| `unmatched` | `ambiguous` ou `tooManyCandidates` | `candidateProductIds` (se ambíguo) |
| `rejected` | o campo inválido, por exemplo `Name must be non-empty text` | (nenhum) |
| `failed` | o erro que parou a importação | (nenhum) |

Os itens válidos também levam `sellerName`, `sellerProductId`, `name` e `brand`.

| Resultado | Quando acontece | O que é gravado | Exemplo |
|---|---|---|---|
| `rejected` | **Item inválido:** `SellerName` ou `Name` ausente ou vazio; `Id` que não é texto não vazio nem número inteiro (um inteiro é lido como texto: `123` = `"123"`); `Brand` ou `Category` com tipo errado; o item não é um objeto. | Nada | `{ "Id": "", ... }` (não há caso no arquivo) |
| `linked` | Exatamente **um** produto com o mesmo nome normalizado (próprio ou traduzido) e a mesma marca normalizada, e o seller **ainda não tinha** oferta para esse SKU. | O seller, se for novo, e a oferta (seller, SKU, produto) | #0 MegaStore `Smartphone Galaxy S23` → 2; #57 `Roteador WiFi 6 TP-Link` → 21 (tradução) |
| `alreadyLinked` | O produto foi encontrado, e o seller **já tinha** oferta para esse SKU **apontando para o mesmo produto**. É um reenvio ou uma reimportação. | Nada (idempotente) | #76 GardenStore `Camera Canon EOS R6`, com o mesmo SKU da #55 `Câmera…`; qualquer item na segunda execução |
| `conflict` | O seller **já tinha** oferta para esse SKU **apontando para outro produto**, ou o item criaria um produto novo para um SKU que já aponta para algum. A oferta existente nunca é sobrescrita, e nada é criado. | Nada | Reenviar `sku-1` da MegaStore descrevendo outro produto (não há caso no arquivo) |
| `created` | Nenhum produto da mesma marca, e **nenhum produto com o nome** (próprio ou traduzido), de nenhuma marca. O produto é criado como o seller o descreveu, com o `NormalizedName`, e a oferta é ligada. Ele **não** ganha oferta do `Marketplace`. | O produto, o seller (se for novo) e a oferta | #180 `Security Test Product`, com a marca `TestBrand'; SELECT 1; --` gravada literalmente como texto |
| `createdForReview` | Nenhum produto da mesma marca, mas **o nome existe com outra marca**. O produto é criado e ligado como em `created`, e cada produto existente com o nome fica registrado como possível duplicata (`ProductReview`, status `pending`). | O produto, o seller (se for novo), a oferta e as revisões | `Smartphone Galaxy S23` / `Samsung Electronics`, parecido com o #2 / `Samsung` (não há caso no arquivo) |
| `unmatched` | **Ambíguo:** dois ou mais produtos com o mesmo nome e a mesma marca, mesmo com categorias diferentes. Se o nome do próprio item é ambíguo, a tradução não é tentada. | Nada | Dois `Yoga Mat` da `Gaiam` no catálogo (não há caso no arquivo) |
| `unmatched` | **Nome genérico demais:** 50 ou mais produtos com o mesmo nome normalizado (`CANDIDATE_LIMIT`). Não dá para garantir que não exista outro da mesma marca além do teto. | Nada | (não há caso no arquivo) |

### Falha técnica (não é um resultado do item)

Se uma gravação falha (banco indisponível, disco cheio, bug), a transação do item é desfeita e a **importação para** naquele item. A falha aparece no log com o índice do item, os itens anteriores continuam gravados, e rodar de novo completa a importação, porque ela é idempotente. Esse item não é contado em nenhum dos resultados acima.

## Resultado sobre o arquivo do desafio

| Resultado | Primeira execução | Segunda execução |
|---|---|---|
| `linked` | 267 | 0 |
| `alreadyLinked` | 1 (#76) | 269 |
| `created` | 1 (#180) | 0 |
| `createdForReview`, `unmatched`, `conflict`, `rejected` | 0 | 0 |

No fim: 976 produtos (975 do catálogo mais o #180), 1.243 ofertas (975 do `Marketplace` mais 268 dos sellers do arquivo) e nenhuma revisão pendente.
