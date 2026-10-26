# 015: Revisão de nomes parecidos ao criar produto

**Status:** proposto (2026-10-26)

## Objetivo

Impedir que um erro de digitação ou uma ordem diferente de palavras gere uma **duplicata silenciosa**.

Hoje, `Smarthpone Galaxy S23` e `Galaxy S23 Smartphone` (marca `Samsung`) não acham nenhum produto com o mesmo nome normalizado. São tratados como inéditos e **criados sem revisão** (teste feito em 2026-10-26). O princípio do projeto é que uma duplicata é aceitável porque é recuperável por merge, mas **só é recuperável se alguém souber que ela existe**.

## Contexto

- **[Estudo §3.3](../analysis/entity-resolution-study.md):** a similaridade de texto pega erros de digitação e ordem de palavras, mas não entende significado (Men/Women, 0.94).
- **Por isso o fuzzy nunca liga a oferta.** Ele só **marca para revisão**. Ligar por similaridade traria o erro caro, o falso positivo. Marcar para revisão, no pior caso, gera uma revisão a mais.
- **Desenho para volume (plano 006):** os candidatos precisam vir de uma consulta indexada, não do catálogo inteiro.

## Decisões

1. **Quando:** só no caminho "criar produto". Um item que liga a um produto existente nunca passa por aqui.
2. **Candidatos ("blocking", estudo §3.5):** os produtos ativos **da mesma marca**.
   - A consulta é `WHERE Brand = ? COLLATE NOCASE AND MergedIntoId IS NULL`, até um teto (por exemplo, 200).
   - Usa um **índice novo em `Product (Brand COLLATE NOCASE)`** (migração 009).
   - **Limitação:** uma marca escrita de outro jeito (`Levi's` e `Levis`) não entra no bloco. Para revisão, é uma perda aceitável. A evolução é uma busca por trigramas (SQLite FTS5), que não depende da marca.
   - **Marca nula:** o bloco é o dos produtos sem marca (`Brand IS NULL`).
3. **Similaridade, no domínio** (`src/domain/name-similarity.ts`):
   - **Ordem das palavras:** compara os nomes normalizados com as palavras em ordem alfabética (`galaxy s23 smartphone` = `galaxy s23 smartphone`).
   - **Erro de digitação:** similaridade de Levenshtein normalizada sobre essas strings, com limite de **0.85**. A distância vem da biblioteca **`fastest-levenshtein`** (conhecida e pequena), para não manter código de algoritmo.
   - **Proteção:** os **números** dos dois nomes precisam ser iguais (`S23` e `S24`, `55` e `65` nunca são parecidos). É a proteção do estudo §3.3.
4. **Resultado:** `createdForReview`, com o motivo novo `similarName` em `ProductReview`.
   - **A migração 009 recria a `ProductReview`** com o `CHECK` de `Reason` ampliado (`sameNameOtherBrand`, `similarName`), preservando os dados. O SQLite não altera um `CHECK` sem recriar a tabela.
   - **Um produto pode ter os dois motivos de revisão.** Cada par (produto, parecido) aparece uma vez, com o primeiro motivo encontrado.
5. **O merge (plano 012) resolve esses casos sem mudança:** mesclar `Smarthpone Galaxy S23` no #2 faz a grafia errada virar apelido do #2.

## Gabarito (arquivo do desafio)

Inalterado: 267 ligados, 1 já ligado, 1 criado, 0 revisões. O #180 tem a marca `TestBrand'; SELECT 1; --`, que nenhum outro produto tem, então o bloco é vazio.

## Passos

- [ ] Migração 009: índice em `Product (Brand COLLATE NOCASE)`; `ProductReview` recriada com `Reason IN ('sameNameOtherBrand', 'similarName')`, preservando os dados; `down`
- [ ] Dependência `fastest-levenshtein`
- [ ] `name-similarity.ts`: ordem das palavras, Levenshtein normalizado, números iguais; testes com os casos do estudo (Men/Women, S23/S24, typo, ordem)
- [ ] `CatalogDatabase.findProductsOfBrand(brand, limit)`, com teste de uso do índice
- [ ] `ImportCatalog`: ao criar, procurar os parecidos na marca e registrar `similarName`
- [ ] Testes da aplicação: erro de digitação e ordem das palavras viram `createdForReview`; S23/S24 é criado sem revisão; um item que liga não procura parecidos; merge resolve
- [ ] Aceitação inalterada
- [ ] Atualizar o `import-decision-flow.md`, o `README.md`, o `CLAUDE.md`, o estudo (§5) e o changelog
- [ ] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`

## Decisões a confirmar com o usuário

- O limite de similaridade (0.85) e o teto de candidatos da marca (200).
- `fastest-levenshtein` como dependência, ou uma função própria de cerca de 15 linhas.

## Desvios

Nenhum até agora.
