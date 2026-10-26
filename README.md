# Catalog Consolidation

Sistema que consolida produtos enviados por vários sellers no catálogo de um marketplace. Um mesmo produto pode chegar de sellers diferentes, com pequenas variações de nome, marca ou categoria. O sistema **não duplica** o produto no catálogo, mas **registra cada seller** que o vende.

- **Entrada:** `data/ProductEntry.json`, com 269 itens de 20 sellers.
- **Catálogo:** `data/catalog.db` (SQLite), com 975 produtos.

> **Status:** a importação resolve todos os itens do arquivo do desafio. Foi construída por incrementos:
>
> - **Incremento 1 (match exato):** pronto. Liga os 200 itens iguais em nome, marca e categoria.
> - **Incremento 2 (nome normalizado):** pronto. Liga mais 64 itens cujo nome só difere em espaços, acentos, caixa ou aspas de polegada. O match exato virou um caso particular dele. No arquivo do desafio, o resultado é 263 ligados e 1 já ligado (um reenvio).
> - **Incremento 3 (marca e categoria):** pronto. A marca é comparada sem caixa, espaços e pontuação (`Levi's` = `Levis`), e a categoria deixa de ser comparada (`Photo` e `Photography`). Liga mais 2 itens: 265 ligados e 1 já ligado.
> - **Incremento 4 (traduções):** pronto. Uma tabela de sinônimos traduz palavras do seller para o vocabulário do catálogo (`roteador` → `router`). Liga mais 2 itens: 267 ligados e 1 já ligado.
> - **Incremento 5 (criar produto):** pronto. Um item sem produto da mesma marca no catálogo vira um produto novo. Se o nome já existe com outra marca, o produto também é criado, mas fica registrado como possível duplicata, para revisão e merge posterior. No arquivo, cria o #180, o item de teste de SQL injection, com a marca gravada literalmente.
> - **Resultado final:** 267 ligados, 1 já ligado, 1 criado e nenhum pendente; 976 produtos e 1.243 ofertas.
> - O caminho de um item e todos os resultados possíveis estão em [docs/analysis/import-decision-flow.md](docs/analysis/import-decision-flow.md).
> - **Relatório:** cada importação mostra as contagens no log e grava em `output/import-report.json` o que aconteceu com **cada item, e por quê** (por exemplo, `linked` por `matchedByTranslatedName`, ou `unmatched` por `ambiguous`, com os candidatos).
>
> O histórico completo está em [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Como rodar

Requisitos: Node 22 ou superior (veja `.nvmrc`) e npm.

```bash
npm install
npm run db:reset       # copia data/catalog.db para output/ e aplica as migrações na cópia
npm run import         # importa data/ProductEntry.json na cópia; contagens no log e relatório em output/import-report.json
npm run catalog -- reviews                      # lista as possíveis duplicatas pendentes
npm run catalog -- merge <duplicata> <destino>  # mescla uma duplicata no produto certo
npm run catalog -- distinct <produto> <parecido> # marca um par revisado como produtos distintos
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
- [`003`](migrations/003_product_exact_match_index.ts) cria o índice `(Name, Brand, Category)` em `Product`, usado pelo match exato.
- [`004`](migrations/004_product_normalized_name.ts) cria a coluna `Product.NormalizedName`, preenchida para os produtos existentes, com o índice `(NormalizedName, Brand, Category)`.
  - O SQLite não consegue remover acentos em SQL, por isso a coluna é calculada em TypeScript.
  - A migração tem uma **cópia congelada** da normalização, para sempre gravar os mesmos valores, e um teste garante que ela coincide com a do domínio.
- [`005`](migrations/005_drop_product_exact_match_index.ts) remove o índice da 003. Todo match exato também é um match normalizado, então a importação busca só pelo nome normalizado, e um índice sem uso ainda custaria em toda escrita.
- [`006`](migrations/006_name_synonym.ts) cria a tabela `NameSynonym (Term, Replacement)` com as duas traduções do desafio. A operação pode incluir sinônimos sem nova migração.
- [`007`](migrations/007_product_review.ts) cria a tabela `ProductReview`: produtos criados pela importação que podem duplicar um existente (mesmo nome, outra marca), com status `pending`, `merged` ou `distinct`.
- [`008`](migrations/008_product_merged_into.ts) cria a coluna `Product.MergedIntoId`. Um produto mesclado continua no banco, apontando para o produto em que foi mesclado.

O schema resultante:

```sql
Product       (Id, Name, Brand, Category, NormalizedName)  -- índice (NormalizedName, Brand, Category)
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

| Questão                                   | Decisão                                                                                                     | Por quê                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade de uma oferta                  | `(seller, código do seller)`                                                                                | O código só é único por seller. É por ele que o seller vai se referir ao item em atualizações futuras, e corrigir um match errado vira um `UPDATE` de `ProductId`, não uma troca de chave. ([plano 002](docs/plans/002-schema-migration.md))                                                                         |
| Mesmo seller, mesmo produto, dois códigos | Duas ofertas para o mesmo produto                                                                           | Não se descarta informação do seller. Uma duplicata eventual fica visível numa consulta. ([data-analysis §2.3](docs/analysis/data-analysis.md))                                                                                                                                                                      |
| Seller como entidade                      | Tabela `Seller`, nome comparado exatamente (sem diferenciar maiúsculas e minúsculas)                        | Garante integridade e dá lugar a atributos futuros. A identidade de um seller não deve ser aproximada: juntar dois sellers por engano mandaria pedidos para a loja errada.                                                                                                                                           |
| Formato do código do seller               | Qualquer texto não vazio                                                                                    | O código pertence ao seller, e o marketplace não impõe formato. **Custo aceito:** um código digitado errado pode gerar uma oferta duplicada num reenvio corrigido.                                                                                                                                                   |
| Conteúdo suspeito (SQL injection)         | Gravado literalmente como texto                                                                             | A proteção é a parametrização das queries, não filtrar conteúdo.                                                                                                                                                                                                                                                     |
| Precisão ou recall no matching            | **Precisão primeiro**                                                                                       | Ligar um seller ao produto errado (o cliente recebe outro item) é pior do que duplicar um produto, que pode ser corrigido com um merge. ([estudo §2](docs/analysis/entity-resolution-study.md))                                                                                                                      |
| Alterações no banco                       | Só por migrações versionadas (Knex), testadas numa cópia                                                    | O banco original é a entrada do desafio e precisa permanecer reproduzível.                                                                                                                                                                                                                                           |
| Produtos do catálogo atual                | O próprio marketplace é um seller (`Marketplace`) e oferta todos eles. O código da oferta é o `Product.Id`. | **Hipótese nossa, não do enunciado:** a empresa já vendia todo o catálogo antes de virar marketplace. Sem isso, 777 produtos ficariam sem nenhum seller. O arquivo de importação também pode trazer itens do `Marketplace`, tratados como os de qualquer seller. ([plano 003](docs/plans/003-marketplace-seller.md)) |

## Importação e matching

A importação segue uma cascata, do critério mais rígido para o mais tolerante ([estudo §5](docs/analysis/entity-resolution-study.md)):

1. ✅ **Validar a entrada.** `SellerName` e `Name` precisam ser texto não vazio. `Brand` e `Category` podem ser nulos. Itens inválidos são contados como rejeitados.
   - **O `Id` do seller** pode ser texto não vazio ou número inteiro, lido como texto: `123` e `"123"` são o mesmo SKU. Um número decimal é rejeitado, por ser mais provavelmente um dado corrompido do que um código.
   - **Um arquivo inválido** (inexistente, JSON malformado, ou JSON que não é um array) gera uma mensagem de uma linha e código de saída 1, sem gravar nada.
2. ✅ **Match por nome normalizado e marca normalizada.**
   - **Nome:** a normalização remove acentos, ignora caixa, remove as aspas de polegada (`''` e `"`) e junta espaços. Preserva números, pontos, hífens e barras, porque são o que diferencia modelos.
   - **Um nome exatamente igual também casa por aqui:** a normalização não altera o que já é igual. Por isso não existe uma etapa separada de match exato.
   - **Marca:** comparada sem acentos, caixa, espaços e pontuação (`Levi's` = `Levis`, `Amazon Basics` = `AmazonBasics`). Nulo só casa com nulo.
   - **Categoria:** não é comparada, porque os sellers a escrevem de forma pouco confiável (`Photo` e `Photography`).
   - **Como a busca funciona:** uma consulta indexada traz os produtos com aquele nome normalizado (até 50), e o domínio filtra pela marca.
   - **Exatamente um candidato casa.** Nenhum, vários (ambíguo) ou 50 ou mais (nome genérico demais para decidir) deixam o item pendente.
   - **Perda de recall aceita:** dois produtos do catálogo com o mesmo nome e marca ficam ambíguos, mesmo com categorias diferentes, ou mesmo para um nome escrito exatamente como um deles. O caso não existe nos dados atuais.
3. ✅ **Sinônimos, se o nome do item não achar nenhum produto da marca.** O nome normalizado é traduzido palavra por palavra pela tabela `NameSynonym` (`roteador` → `router`) e a busca do passo 2 é repetida.
   - **Num sentido só e só no item:** o catálogo e o `NormalizedName` não mudam, então um sinônimo novo vale na próxima importação, sem migração.
   - **Por que é uma cascata:** o nome traduzido é outro nome e pode apontar para outro produto. Se o catálogo tiver `Processador X` e `Processor X`, o item `Processador X` liga ao primeiro.
   - **Limitação:** só cobre os termos cadastrados, e palavras com mais de uma tradução (`mesa` → `table` ou `desk`) exigem curadoria. Fuzzy, embeddings ou um LLM generalizariam, com os riscos discutidos no [estudo](docs/analysis/entity-resolution-study.md).
4. ✅ **Nenhum produto da marca, por nenhum dos dois nomes: cria o produto** como o seller o descreveu, com o `NormalizedName`, e liga a oferta.
   - **Se o nome existe com outra marca,** o produto também é criado, e cada produto existente com o nome fica registrado em `ProductReview` como possível duplicata. O seller nunca é ligado a um produto talvez errado, e a duplicata não passa despercebida.
   - **Um item ambíguo nunca cria produto:** se há vários candidatos da mesma marca, o produto existe.
   - **Se o SKU do seller já aponta para algum produto, nada é criado:** o resultado é `conflict`.
   - **O produto novo não ganha oferta do `Marketplace`.**
   - **Resolução das revisões** (plano 012), pelo comando `catalog`:
     - **`merge <D> <P>`** move as ofertas de D para P, marca D como mesclado (`MergedIntoId`) e encerra as revisões de D. Aceita qualquer par de produtos ativos, inclusive duplicatas antigas do catálogo.
     - **`distinct <D> <P>`** encerra a revisão do par, sem mudar produtos nem ofertas.
   - **Um produto mesclado vira apelido do destino:** a busca devolve o destino. Por isso, depois de resolvida, a mesma variação (o mesmo nome com a mesma marca) **não volta para revisão**: liga ao destino, se foi mesclada, ou ao próprio D, se foi marcada como distinta. Só uma variação nova abre revisão.
   - **Com a revisão ainda pendente,** a mesma variação também não abre outra revisão: liga a D, e o merge depois leva todas as ofertas de D juntas.

**Garantias atuais:**

- **Uma transação curta por item.** Uma falha técnica desfaz só o item em curso, interrompe a importação e aparece no log, com o índice do item. Os itens anteriores continuam gravados. _Simplificação temporária:_ transações por lote diluem o custo de confirmação em volumes grandes e podem voltar só no caso de uso, sem mudar o domínio.
- **Reimportar não muda nada, e completa uma importação interrompida:** as ofertas já existentes são contadas como `alreadyLinked`.
- **Segura com importações concorrentes:** o banco arbitra. Seller e oferta são gravados com "insere se não existir", e quem perde a corrida reavalia contra o que já está gravado, sem erro e sem sobrescrever.
- **Precisão em primeiro lugar:** um SKU que já aponta para outro produto vira `conflict` e não é sobrescrito. Um item ambíguo fica `unmatched`: nem liga, nem cria. Na dúvida sobre a marca, cria-se um produto marcado para revisão, em vez de arriscar o produto errado.
- **Limitação de concorrência na criação:** duas importações criando o mesmo produto novo ao mesmo tempo podem gravá-lo duas vezes.
  - No SQLite, a segunda gravação falha e uma nova execução corrige.
  - Num Postgres, seria preciso uma restrição única sobre o nome e a marca normalizados ([plano 011](docs/plans/011-create-product-with-review.md)).
- **Desenho para volume:**
  - nada é carregado inteiro: nem o catálogo, nem as ofertas de um seller;
  - cada item faz consultas por chave ou por índice.
  - Com os dados do desafio, uma versão em memória seria mais rápida. A escolha troca desempenho no caso pequeno por um desenho que se sustenta no caso grande.
- **Detalhes:** [plano 004](docs/plans/004-import-exact-match.md) (primeira versão) e [plano 006](docs/plans/006-scalable-import.md) (desenho escalável).

**Evolução prevista, não implementada:**

- leitura do arquivo em fluxo (NDJSON) em vez de um array JSON único;
- paralelismo por seller;
- Postgres no lugar do SQLite;
- match aproximado **com proteções** (números iguais, marcas compatíveis, palavras de variante iguais, como Men/Women), antes de criar produto, com busca de candidatos em vez de comparar com o catálogo inteiro;
- uma interface de revisão para as possíveis duplicatas, além do comando `catalog`.

## Arquitetura

O código é organizado em três camadas, com poucos tipos:

```
cli/import.ts ─► ImportCatalog            (application: o fluxo, uma transação por item)
                   ├─► ProductMatcher     (application: acha o produto pelo nome e pela marca)
                   ├─► SellerProductEntry (domain: valida o item; compara a marca)
                   ├─► Offer              (domain: ligado, já ligado ou conflito; nunca sobrescreve)
                   ├─► ImportSummary      (domain: contagens por resultado)
                   ├─► ItemResult         (domain: o resultado e o motivo de cada item)
                   ├─► ImportRecord       (domain: a linha do relatório, montada por toImportRecord)
                   └─► CatalogDatabase    (infrastructure: todo o SQL, por chave ou índice)
```

- **As regras ficam nos objetos que têm os dados:**
  - `SellerProductEntry.parse()` e `hasBrand()`;
  - `Offer.outcomeGiven()`;
  - a busca e a regra de ambiguidade (só um candidato casa) ficam no `ProductMatcher`.
- **O domínio não tem SQL nem importa nada de fora dele.**
- **Sem interfaces "por precaução".** A aplicação depende da classe concreta `CatalogDatabase`. Uma interface só se justifica quando há uma segunda implementação ou um mock, e aqui não há nenhum dos dois.
- **Testes sem mocks:**
  - o domínio é testado diretamente;
  - `CatalogDatabase`, a aplicação e a aceitação rodam contra uma cópia real do SQLite, migrada num diretório temporário.

Detalhes em [plano 007](docs/plans/007-simplify-types.md). Os planos 005 e 006 registram a versão anterior, mais carregada, e por que ela foi simplificada.

## Estrutura do repositório

```
data/            entrada original do desafio (somente leitura)
migrations/      migrações de schema (Knex)
src/
  domain/        regras de negócio: SellerProductEntry, Offer, ImportSummary, NameSynonyms, normalizeProductName, normalizeBrand
  application/   casos de uso ImportCatalog, MergeProducts e MarkDistinct; ProductMatcher
  infrastructure/
    sqlite/      CatalogDatabase (todo o SQL), conexão e migrações
    import-file  leitura do arquivo JSON
  cli/           comandos db:migrate, db:reset, import e catalog
tests/           domain/, infrastructure/, application/, acceptance/ e db/ (vitest, sem mocks)
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
