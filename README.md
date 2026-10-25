# Catalog Consolidation

Sistema que consolida produtos enviados por vários sellers no catálogo de um marketplace. Um mesmo produto pode chegar de sellers diferentes, com pequenas variações de nome, marca ou categoria. O sistema **não duplica** o produto no catálogo, mas **registra cada seller** que o vende.

- **Entrada:** `data/ProductEntry.json`, com 269 itens de 20 sellers.
- **Catálogo:** `data/catalog.db` (SQLite), com 975 produtos.

> **Status:** schema e processo de migração prontos e testados. A importação (leitura do arquivo, matching e gravação das ofertas) é o próximo passo. O histórico completo está em [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Como rodar

Requisitos: Node 22 ou superior (veja `.nvmrc`) e npm.

```bash
npm install
npm run db:reset       # copia data/catalog.db para output/ e aplica as migrações na cópia
npm test               # testes (vitest)
npm run typecheck      # checagem de tipos (tsc)
```

O banco original (`data/catalog.db`) **nunca é alterado**. Todo o trabalho acontece numa cópia em `output/catalog.db`, e o código recusa abrir o original para escrita.

## O que os dados mostram

Antes de implementar, os dois arquivos foram analisados por completo ([docs/analysis/data-analysis.md](docs/analysis/data-analysis.md)). Os achados que mais influenciam a solução:

- **Quase tudo no arquivo já existe no catálogo.** Dos 269 itens, 268 correspondem a produtos existentes. O desafio é encontrar o produto certo (_matching_), não cadastrar produtos.
- **As variações são reais e plantadas:**
  - espaço duplo em 60 nomes;
  - acento ("Câmera");
  - nomes traduzidos ("Roteador" por "Router");
  - aspas de polegada em formatos diferentes;
  - variações de marca ("Levi's"/"Levis") e de categoria ("Photo"/"Photography").
- **Similaridade de texto engana.** O próprio catálogo tem produtos diferentes com nomes quase iguais, como "Multivitamin Men" e "Multivitamin Women" (0.94 de similaridade). Um limite de similaridade ingênuo juntaria produtos distintos.
- **Os IDs pertencem a cada seller:**
  - o mesmo ID aparece em sellers diferentes;
  - um seller reenvia o mesmo ID;
  - 10 sellers enviam o mesmo produto com dois IDs diferentes.
- **Há uma tentativa de SQL injection** num campo de marca.

## Modelo de dados

O schema original não acomodava os dados: `SellerProductId` era `INTEGER`, mas os IDs são UUIDs em texto, e não havia restrições de unicidade. Duas migrações ajustam o banco:

- [`001`](migrations/001_seller_and_offer_keys.ts) altera o schema, criando a tabela `Seller` e a nova chave das ofertas.
- [`002`](migrations/002_marketplace_seller.ts) é uma migração de dados: cria o seller `Marketplace` e uma oferta dele para cada um dos 975 produtos existentes.

O schema resultante:

```sql
Product       (Id, Name, Brand, Category)              -- inalterada
Seller        (Id, Name UNIQUE COLLATE NOCASE)         -- nova
SellerProduct (SellerId, SellerProductId TEXT, ProductId)
              PRIMARY KEY (SellerId, SellerProductId)  -- índice em ProductId
```

**Cada linha de `SellerProduct` é uma oferta:** "o item de código X no sistema do seller Y corresponde ao produto Z do catálogo".

- Vários sellers podem apontar para o mesmo produto.
- Um mesmo seller pode ter mais de um código para o mesmo produto.
- "Quais sellers vendem o produto Z" é uma consulta `DISTINCT` sobre essa tabela.

## Decisões e hipóteses

O desafio tem ambiguidades intencionais. Cada decisão abaixo tem a justificativa e as alternativas descartadas nos documentos indicados.

| Questão                                   | Decisão                                                                                                     | Por quê                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identidade de uma oferta                  | `(seller, código do seller)`                                                                                | O código só é único por seller. É por ele que o seller vai se referir ao item em atualizações futuras, e corrigir um match errado vira um `UPDATE` de `ProductId`, não uma troca de chave. ([plano 002](docs/plans/002-schema-migration.md))                                                     |
| Mesmo seller, mesmo produto, dois códigos | Duas ofertas para o mesmo produto                                                                           | Não se descarta informação do seller. Uma duplicata eventual fica visível numa consulta. ([data-analysis §2.3](docs/analysis/data-analysis.md))                                                                                                                                                  |
| Seller como entidade                      | Tabela `Seller`, nome comparado exatamente (sem diferenciar maiúsculas e minúsculas)                        | Garante integridade e dá lugar a atributos futuros. A identidade de um seller não deve ser aproximada: juntar dois sellers por engano mandaria pedidos para a loja errada.                                                                                                                       |
| Formato do código do seller               | Qualquer texto não vazio                                                                                    | O código pertence ao seller, e o marketplace não impõe formato. **Custo aceito:** um código digitado errado pode gerar uma oferta duplicada num reenvio corrigido.                                                                                                                               |
| Conteúdo suspeito (SQL injection)         | Gravado literalmente como texto                                                                             | A proteção é a parametrização das queries, não filtrar conteúdo.                                                                                                                                                                                                                                 |
| Precisão ou recall no matching            | **Precisão primeiro**                                                                                       | Ligar um seller ao produto errado (o cliente recebe outro item) é pior do que duplicar um produto, que pode ser corrigido com um merge. ([estudo §2](docs/analysis/entity-resolution-study.md))                                                                                                  |
| Alterações no banco                       | Só por migrações versionadas (Knex), testadas numa cópia                                                    | O banco original é a entrada do desafio e precisa permanecer reproduzível.                                                                                                                                                                                                                       |
| Produtos do catálogo atual                | O próprio marketplace é um seller (`Marketplace`) e oferta todos eles. O código da oferta é o `Product.Id`. | A empresa já vendia todo o catálogo antes de virar marketplace. Sem isso, 777 produtos ficariam sem nenhum seller. **Limitação:** o seller é identificado pelo nome, então um seller externo chamado "Marketplace" seria confundido com ele. ([plano 003](docs/plans/003-marketplace-seller.md)) |

## Abordagem de matching (planejada)

Uma cascata, do critério mais rígido para o mais tolerante, gravando em cada oferta o motivo do match ([estudo §5](docs/analysis/entity-resolution-study.md)):

1. Validar a entrada.
2. Normalizar o nome (caixa, acentos, espaços e aspas), preservando números e códigos de modelo.
3. Match exato pelo nome normalizado.
4. Match aproximado **com proteções**: números iguais, marcas compatíveis e palavras de variante iguais (Men/Women, Shirt/Shorts).
5. Sem match confiável: criar o produto.

## Estrutura do repositório

```
data/            entrada original do desafio (somente leitura)
migrations/      migrações de schema (Knex)
src/db/          conexão, configuração das migrações e CLI do banco
tests/           testes (vitest)
docs/
  analysis/      análise dos dados e estudo de técnicas de entity resolution
  plans/         planos de cada etapa, com decisões e desvios
  CHANGELOG.md   histórico cronológico do projeto
output/          cópia de trabalho do banco (gerada, fora do git)
```

## Stack

TypeScript (`strict`), Node 22, `better-sqlite3` (acesso ao banco), Knex (só para migrações), Vitest e Prettier. As escolhas e as alternativas consideradas estão no [plano 001](docs/plans/001-typescript-environment.md).

## Uso de IA

O projeto foi desenvolvido com o Claude Code como assistente. As instruções de trabalho dadas a ele estão em [CLAUDE.md](CLAUDE.md), e entre elas:

- criticar cada pedido com base nas análises antes de executar;
- registrar planos e decisões;
- nunca alterar o banco original.

As análises de dados foram geradas com scripts e conferidas contra os arquivos. As decisões de modelagem foram discutidas e tomadas pelo autor, e algumas sugestões da IA foram revistas: por exemplo, o executor de migrações próprio foi trocado por um framework conhecido. O registro dessas decisões está no [changelog](docs/CHANGELOG.md) e nos [planos](docs/plans/).
