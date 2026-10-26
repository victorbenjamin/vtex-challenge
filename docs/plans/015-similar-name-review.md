# 015: Revisão de nomes parecidos ao criar produto

**Status:** concluído (2026-10-26)

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

- [x] Migração 009: índice em `Product (Brand COLLATE NOCASE)`; `ProductReview` recriada com `Reason IN ('sameNameOtherBrand', 'similarName')`, preservando os dados; `down`
- [x] Dependência `fastest-levenshtein`
- [x] `name-similarity.ts`: ordem das palavras, Levenshtein normalizado, números iguais; testes com os casos do estudo (Men/Women, S23/S24, typo, ordem)
- [x] `CatalogDatabase.findProductsOfBrand(brand, limit)`, com teste de uso do índice
- [x] `ImportCatalog`: ao criar, procurar os parecidos na marca e registrar `similarName`
- [x] Testes da aplicação: erro de digitação e ordem das palavras viram `createdForReview`; S23/S24 é criado sem revisão; um item que liga não procura parecidos; merge resolve
- [x] Aceitação inalterada
- [x] Atualizar o `import-decision-flow.md`, o `README.md`, o `CLAUDE.md`, o estudo (§5) e o changelog
- [x] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`

## Decisões a confirmar com o usuário

- **Executado com os valores propostos:** limite de similaridade 0.85, teto de 200 candidatos por marca, e a biblioteca `fastest-levenshtein` (o usuário já tinha pedido para não manter código fora do problema principal). Podem ser ajustados.

## Desvios

- **O método se chama `findActiveProductsOfBrand`** (o plano dizia `findProductsOfBrand`), porque exclui os produtos mesclados.
- **A busca de parecidos fica no `ProductMatcher`** (`similarNamesOf`), junto com o resto da busca, e não no `ImportCatalog`.
- **Motivo no relatório:** `similarNameExists`. Quando o nome também existe com outra marca, prevalece `nameExistsWithOtherBrand`.
- **Nomes idênticos não são "parecidos":** são tratados pelo match de nome.
- **Correção de um teste meu:** usei `Galaxy S23 Ultra` como exemplo de nome parecido, mas a regra corretamente não o considera parecido com `Galaxy S23` (similaridade 0.78): é outro modelo. O exemplo virou um teste próprio ("outro modelo da marca não é parecido").

## Resultado

- **263 testes passam,** contra o SQLite real e sem mocks. Os novos cobrem:
  - a regra de similaridade: erro de digitação e ordem de palavras parecidos; outro número, tamanho ou modelo não; o alarme falso de Shirt/Shorts;
  - a busca por marca: sem diferenciar maiúsculas, marca nula, sem os mesclados, com o índice;
  - a migração 009: motivo novo, restrições, dados preservados, reversão;
  - o caso de uso: revisão por nome parecido, só dentro da marca, os dois motivos juntos, um item que liga não procura parecidos, e o merge transformando o erro de digitação em apelido.
- **Pelo CLI, numa cópia descartável:** `Smarthpone Galaxy S23` e `Galaxy S23 Smartphone` viraram revisões contra o #2 (e o segundo também contra o primeiro, criado logo antes).
- **A importação do arquivo do desafio não mudou:** 267 ligados, 1 já ligado, 1 criado, 0 revisões.
- O banco original continua intacto.
