# 006: Importação com desenho escalável

**Status:** concluído (2026-10-25)

## Objetivo

Ajustar a importação (planos 004 e 005) para um desenho que se sustente com um banco de produção e com volume. O SQLite é só o substituto local. "Não precisa estar pronto para produção" se refere à infraestrutura (Docker, CI), não ao desenho.

O comportamento sobre o arquivo do desafio não muda: 200 ligados, 69 pendentes e a importação idempotente.

## Contexto

O usuário reavaliou a transação única. Com a premissa de escala, quatro pontos não se sustentam:
1. **Uma transação para o arquivo inteiro:** trava longa, atraso na limpeza de linhas antigas e na replicação, e uma falha perde tudo.
2. **O catálogo inteiro em memória:** inviável com milhões de produtos.
3. **O `Seller` carrega todas as ofertas** para checar um único SKU: o agregado está grande demais.
4. **Concorrência:** duas importações simultâneas criando o mesmo seller ou a mesma oferta estouram a restrição única.

Essas decisões contradizem três registros anteriores, todos justificados pelo tamanho pequeno dos dados: o plano 004 (decisões 3 e 7) e a [data-analysis §4, item 12](../analysis/data-analysis.md). Com a premissa nova, o usuário decidiu revisá-las.

## Decisões

1. **Transações por lote.** Cada lote de N itens (500 por padrão, configurável) roda na própria transação.
   - Os resultados de um lote só entram no relatório depois que ele é confirmado.
   - Uma falha técnica desfaz só o lote em curso e **interrompe a importação**, porque a causa provavelmente é sistêmica. O relatório registra a falha e os lotes já confirmados.
   - Rodar de novo completa o trabalho, porque a importação é idempotente.
   - *Perde-se* a garantia de "arquivo inteiro ou nada". É aceitável: feeds de marketplace são processados item a item.
2. **O catálogo é consultado por índice, item a item**, em vez de carregado em memória.
   - A consulta usa `Name = ? AND Brand IS ? AND Category IS ?`, em que `IS` trata nulo como igual a nulo, com `LIMIT 2`.
   - O domínio (`ExactProductMatcher`) decide: um candidato é um match, dois são ambíguos e não casam.
   - A migração **003** cria o índice `IX_Product_Name_Brand_Category`.
3. **Agregados menores.**
   - O `Seller` fica com a identidade e as regras de nome.
   - A oferta vira o objeto `Offer`, e `offer.outcomeGiven(existing)` decide entre ligar, já ligado e conflito, olhando **só a oferta existente daquele SKU**.
4. **Gravação segura contra concorrência.** O banco é o árbitro:
   - **Oferta:** `OfferRepository.addIfAbsent(offer)` faz um `INSERT ... ON CONFLICT DO NOTHING` e, se não inseriu, devolve a oferta existente. O domínio então decide entre já ligado e conflito, e nada é sobrescrito.
   - **Seller:** `SellerRepository.save` faz um `INSERT ... ON CONFLICT (Name) DO NOTHING` seguido de um `SELECT` do Id. Se outra importação criou o seller antes, o código usa o dela.
5. **Fica só documentado, sem implementar:**
   - leitura do arquivo em fluxo (NDJSON);
   - paralelismo por seller;
   - Postgres;
   - busca de candidatos para o matching aproximado.
6. **Trade-off assumido:** com os dados do desafio, a versão em memória era mais rápida, porque fazia menos idas ao banco. A escolha troca desempenho no caso pequeno por um desenho que se sustenta no caso grande.

## Passos

- [x] Migração 003 (índice em `Product`) e ajuste dos testes de migração
- [x] Domínio: `ExactProductMatcher`, `Offer`, `Seller` reduzido, `ImportReport` com lotes e falha, portas `ProductRepository` e `OfferRepository`
- [x] Infraestrutura: `SqliteProductRepository`, `SqliteOfferRepository` e o `save` do seller seguro contra concorrência
- [x] Aplicação: `ImportCatalog` com lotes, e a opção `--batch-size` no CLI
- [x] Testes contra o SQLite real: uso do índice, corridas de seller e oferta, falha de um lote, aceitação com lotes pequenos
- [x] Atualizar o `README.md`, o `CLAUDE.md`, a `data-analysis.md` §4 (item 12), as notas nos planos 004 e 005 e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **Simplificado no plano 007:** `ExactProductMatcher` e os três repositórios viraram uma linha em `ImportCatalog` e uma classe `CatalogDatabase`. O desenho escalável (índice, transação curta, "insere se não existir") foi mantido.
- **`Seller.persistedId`** foi adicionado. Ele lança erro se o seller não foi gravado, e evita um `as number` na aplicação.
- **`CatalogRepository` foi renomeado para `ProductRepository`.** O repositório não carrega mais um catálogo, só busca produtos.

- **Transações por lote substituídas por uma transação por item** (decisão 1). É uma simplificação **temporária** pedida pelo usuário.
  - Continua escalável quanto às travas: a transação é ainda mais curta.
  - Perde-se a diluição do custo de confirmação: com 1 milhão de itens, são 1 milhão de confirmações em vez de 2 mil.
  - O lote pode voltar só no `ImportCatalog`, sem mudar o domínio nem os repositórios.
  - Saíram a opção `batchSize`, o `--batch-size` do CLI e a contagem de lotes no relatório. A falha agora aponta um item (`index`) em vez de um intervalo.

- **O relatório detalhado (`ImportReport`) foi retirado temporariamente** a pedido do usuário ("baby steps").
  - Em seu lugar entrou `ImportSummary`, só com contagens por resultado, mostradas no log, e a falha.
  - O relatório volta quando todas as regras estiverem implementadas.
  - Com isso, os testes passaram a verificar o banco em vez do relatório. Os motivos de rejeição não são mais verificados por teste, só a contagem.

## Resultado

- 96 testes passam, sem mocks. Os novos cobrem:
  - o índice sendo usado (`EXPLAIN QUERY PLAN`);
  - a corrida na criação de seller e de oferta;
  - a falha de um lote: só ele é desfeito, os anteriores ficam e a importação para;
  - a nova execução depois de uma falha, que completa a importação;
  - a aceitação com lotes de 7, que dá o mesmo resultado que um lote único.
- `npm run db:reset && npm run import`: 200 ligados e 69 pendentes, em 1 lote. Com `--batch-size=50`: 200 já ligados, em 6 lotes.
- O banco original continua intacto.
