# Fluxo de decisão de um item da importação

Como a importação decide o que fazer com cada item do arquivo, e quais resultados são possíveis. Reflete o código de `ImportCatalog` (`src/application/import-catalog.ts`) até o plano 010. Qualquer seller pode enviar itens, inclusive o `Marketplace`: os itens dele viram ofertas do seller criado pela migração 002, sem tratamento especial. **O último losango ("criar produto") ainda não está implementado:** é o assunto do plano 011, com a decisão entre as opções A e B em aberto.

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
                     └─────────┬──────────────────────────┘
                               │
          ┌────────────────────┼─────────────────────────┐
          │                    │                         │
   nenhum produto      produtos com esse nome     produtos com esse nome
   com esse nome       e 1 da MESMA MARCA         e 2+ da mesma marca
          │                    │                         │
          │                    ▼                         ▼
          │               LIGA à oferta          AMBÍGUO → PENDENTE
          │                                      (não tenta tradução)
          │
          │      (também acontece: produtos com esse nome,
          │       mas NENHUM da mesma marca → mesmo caminho abaixo)
          ▼
   ┌─────────────────────────────────────────────┐
   │ tenta o NOME TRADUZIDO (sinônimos), se mudou │
   └─────────┬───────────────────────────────────┘
             │
     mesma árvore: 1 da marca → LIGA · 2+ → PENDENTE
             │
             ▼
   não ligou por nenhum dos dois nomes
             │
   ┌─────────▼──────────────────────────────────────────────┐
   │  O NOME (próprio ou traduzido) existe no catálogo,      │
   │  só que com OUTRA MARCA?                                │
   └─────────┬───────────────────────────────┬──────────────┘
             │ não: o nome é inédito         │ sim: o nome existe, a marca não bate
             ▼                               ▼
      CRIA PRODUTO NOVO              ┌───────────────────────────────────────┐
      + liga a oferta                │ Opção A (recomendada): PENDENTE        │
      (nas duas opções)              │   pode ser variação de marca ainda não │
                                     │   coberta → revisão humana             │
                                     │ Opção B: CRIA PRODUTO NOVO             │
                                     │   risco: duplicata se for a mesma      │
                                     │   coisa escrita de outro jeito         │
                                     └───────────────────────────────────────┘
```

"LIGA à oferta" significa gravar a oferta do seller (seller, SKU, produto). Quando o SKU já tem uma oferta, o resultado depende dela: veja `alreadyLinked` e `conflict` na tabela abaixo.

### A diferença entre as opções A e B

| Item do seller | Catálogo | Opção A | Opção B |
|---|---|---|---|
| `Security Test Product` / `TestBrand…` | nenhum produto com esse nome | cria | cria |
| `Smartphone Galaxy S23` / `Samsung Electronics` | #2 `Smartphone Galaxy S23` / `Samsung` | pendente (talvez seja o mesmo produto, com a marca escrita de outro jeito) | cria um segundo "Galaxy S23", provável duplicata |
| `Yoga Mat` / `Manduka` | só `Yoga Mat` / `Gaiam` | pendente (pode ser outro produto legítimo; vai para revisão) | cria (correto, se for outro produto) |

A diferença está só no último losango. No arquivo do desafio, as duas opções dão o mesmo resultado: só o #180 é criado.

## Todos os resultados possíveis de um item

Cada item termina em exatamente um resultado, contado no `ImportSummary` (`src/domain/import-summary.ts`) e mostrado no log. Hoje a contagem não diz o **motivo** de um `rejected` ou `unmatched`; os motivos voltam com o relatório detalhado, que está adiado.

| Resultado | Quando acontece | O que é gravado | Exemplo | Estado |
|---|---|---|---|---|
| `rejected` | **Item inválido:** `Id`, `SellerName` ou `Name` ausente ou vazio; `Brand` ou `Category` com tipo errado; o item não é um objeto. | Nada | `{ "Id": "", ... }` (não há caso no arquivo) | Implementado |
| `linked` | Exatamente **um** produto com o mesmo nome normalizado (próprio ou traduzido) e a mesma marca normalizada, e o seller **ainda não tinha** oferta para esse SKU. | O seller, se for novo, e a oferta (seller, SKU, produto) | #0 MegaStore `Smartphone Galaxy S23` → produto 2; #57 `Roteador WiFi 6 TP-Link` → 21 (tradução) | Implementado |
| `alreadyLinked` | O produto foi encontrado, e o seller **já tinha** oferta para esse SKU **apontando para o mesmo produto**. É um reenvio ou uma reimportação. | Nada (idempotente) | #76 GardenStore `Camera Canon EOS R6`, com o mesmo SKU da #55 `Câmera…`; qualquer item na segunda execução | Implementado |
| `conflict` | O produto foi encontrado, mas o seller **já tinha** oferta para esse SKU **apontando para outro produto**. A oferta existente nunca é sobrescrita: na dúvida, prevalece a precisão. | Nada | Reenviar `sku-1` da MegaStore com outro produto (não há caso no arquivo) | Implementado |
| `unmatched` | **Nenhum produto com o nome** (próprio ou traduzido). | Nada | #180 `Security Test Product` (hoje) | Implementado; **vira `created` no plano 011** |
| `unmatched` | **Nome existe, mas com outra marca.** | Nada | `Smartphone Galaxy S23` / `Samsung Electronics` (não há caso no arquivo) | Implementado; **no plano 011, continua `unmatched` na opção A e vira `created` na opção B** |
| `unmatched` | **Ambíguo:** dois ou mais produtos com o mesmo nome e a mesma marca, mesmo com categorias diferentes. Se o nome próprio é ambíguo, a tradução não é tentada. | Nada | Dois `Yoga Mat` da `Gaiam` no catálogo (não há caso no arquivo) | Implementado |
| `unmatched` | **Nome genérico demais:** 50 ou mais produtos com o mesmo nome normalizado (`CANDIDATE_LIMIT`). Não dá para garantir que não exista outro da mesma marca além do teto. | Nada | (não há caso no arquivo) | Implementado |
| `created` | Nenhum produto com o nome (e, na opção B, também quando o nome existe com outra marca). Cria o produto, gravando o `NormalizedName`, e liga a oferta. O produto novo **não** ganha oferta do `Marketplace`. | O produto, o seller (se for novo) e a oferta | #180 `Security Test Product`, com a marca `TestBrand'; SELECT 1; --` gravada literalmente como texto | **Planejado (plano 011)** |

### Falha técnica (não é um resultado do item)

Se uma gravação falha (banco indisponível, disco cheio, bug), a transação do item é desfeita e a **importação para** naquele item. A falha aparece no log com o índice do item, os itens anteriores continuam gravados, e rodar de novo completa a importação, porque ela é idempotente. Esse item não é contado em nenhum dos resultados acima.

## Resultado sobre o arquivo do desafio

| Resultado | Hoje (plano 010) | Com o plano 011 (A ou B) |
|---|---|---|
| `linked` | 267 | 267 |
| `alreadyLinked` | 1 (#76) | 1 |
| `created` | não existe | 1 (#180) |
| `unmatched` | 1 (#180) | 0 |
| `conflict`, `rejected` | 0 | 0 |
