# 008: Importação, incremento 2 (match por nome normalizado)

**Status:** concluído (2026-10-25)

## Objetivo

Segunda etapa da cascata: resolver a segunda linha da tabela da [data-analysis §3.1](../analysis/data-analysis.md), os **64 itens cujo nome só difere na grafia** (espaços, acento, aspas) e que têm marca e categoria iguais às do catálogo.

## Contexto

Os 64 casos, conferidos nos dados:
- **60 com espaço duplo,** por exemplo `Smartphone  Galaxy S23`.
- **1 com acento:** #55 `Câmera Canon EOS R6` → #18 `Camera Canon EOS R6`.
- **1 com aspas simples duplas no lugar da aspa dupla:** #53 `Tablet iPad Pro 12.9''` → #14 `Tablet iPad Pro 12.9"`.
- **2 sem a aspa de polegada:** #267 `Tablet iPad Pro 12.9` → #14, e #268 `Smart TV Samsung 55` → #10 `Smart TV Samsung 55"`.

A simulação com a normalização proposta sobre o catálogo mostrou que:
- **nenhuma chave normalizada é ambígua:** nenhum par de produtos do catálogo fica igual depois de normalizar, nem ignorando marca e categoria;
- **os 64 casam com o produto esperado.**

Restrições vindas dos planos anteriores:
- **Busca por índice, sem carregar o catálogo em memória** (plano 006).
- **Poucos tipos, sem interfaces e sem classes sem comportamento** (plano 007).
- **Mudança de schema só por migração,** testada numa cópia (preferência 6).

## Decisões

1. **Regras da normalização,** só as que os dados exigem, mais caixa (que é genérica e segura):

   | Regra | Caso nos dados |
   |---|---|
   | Remover acentos (Unicode NFKD, descartando as marcas combinantes) | `Câmera` → `camera` |
   | Converter para minúsculas | Genérica: nenhum caso nos dados, mas sem risco de juntar produtos diferentes |
   | Remover aspas de polegada (`''` e `"`) | `12.9''`, `12.9"` e `12.9` ficam iguais; `55"` e `55` também |
   | Juntar espaços repetidos e tirar os das pontas | 60 casos |

   **Fica de fora, de propósito:**
   - remover outras pontuações (hífen, barra, ponto), porque pode juntar produtos diferentes e porque os números são o que diferencia modelos ([estudo §3.2](../analysis/entity-resolution-study.md));
   - tradução e sinônimos (`Roteador` e `Router`), que ficam para uma etapa posterior.

2. **A marca e a categoria continuam com igualdade exata,** com `IS` (nulo igual a nulo). As variações de marca e categoria (`Levi's`, `Photo`) são a terceira linha da tabela, e ficam para outra etapa.

3. **Cascata, com a precisão em primeiro lugar:**
   - o **match exato** roda primeiro;
   - **só se ele não achar nenhum produto,** roda o match por nome normalizado;
   - **em cada etapa, mais de um candidato significa ambíguo:** o item não casa e a cascata para. Um match exato ambíguo também seria ambíguo na normalização.

4. **Coluna `Product.NormalizedName` com índice (migração 004).**
   - O índice é `IX_Product_NormalizedName_Brand_Category (NormalizedName, Brand, Category)`.
   - É a única forma de buscar por nome normalizado com índice: o SQLite não consegue remover acentos em SQL, então a coluna precisa ser calculada fora dele.
   - **A migração preenche a coluna** para os 975 produtos.
   - A coluna fica sem `NOT NULL`, porque o SQLite não permite acrescentar uma coluna `NOT NULL` sem valor padrão. Um teste garante que nenhum produto fica sem valor.
   - *Descartado:* índice sobre uma função SQL registrada pelo `better-sqlite3` (`db.function`). Toda conexão precisaria registrar a função, inclusive o DBeaver, que passaria a falhar ao usar o índice ou gravar.
   - *Descartado:* carregar o catálogo em memória e normalizar lá (plano 006).

5. **A normalização é uma função do domínio:** `normalizeProductName` em `src/domain/product-name.ts`. É uma função, não uma classe, seguindo o plano 007.
   - `SellerProductEntry` expõe o nome normalizado.
   - `CatalogDatabase` ganha `findProductIdsByNormalizedName`.

6. **A migração 004 tem a própria cópia, congelada, da normalização.**
   - Uma migração precisa produzir sempre o mesmo resultado. Se importasse a função do domínio, uma mudança futura nela mudaria o que a 004 grava num banco novo.
   - **Um teste garante que a cópia e a função do domínio coincidem** para os 975 nomes do catálogo e para os casos de borda.
   - Se a normalização mudar no futuro, uma **nova** migração recalcula a coluna.
   - *Descartado:* importar a função do domínio na migração. Teria menos duplicação, mas a migração deixaria de ser reprodutível.
   - **Confirmado pelo usuário:** cópia congelada.

7. **Manutenção da coluna:** todo produto criado no futuro (etapa "produto novo") precisa gravar o `NormalizedName`. Fica registrado como requisito dessa etapa.

## Resultado esperado (gabarito)

Conferido por simulação sobre os dados reais:

| | Incremento 1 | **Incremento 2** |
|---|---|---|
| `linked` | 200 | **263** |
| `alreadyLinked` | 0 | **1**: #76 `Camera`, com o mesmo seller e ID da #55 `Câmera`, que vem antes no arquivo |
| `unmatched` | 69 | **5**: #57 `Roteador`, #64 `Processador`, #87 categoria `Photo`, #188 marca `Levi's` e #180 `Security Test Product` |
| `conflict`, `rejected` | 0 | 0 |
| Ofertas no total | 1.175 | **1.238** (975 do marketplace mais 263) |

Na segunda execução: 0 `linked`, 264 `alreadyLinked`, 5 `unmatched`.

## Passos

- [x] `src/domain/product-name.ts` (`normalizeProductName`) e testes
- [x] Migração 004: coluna, preenchimento com a cópia congelada e índice, com `down`
- [x] Testes da migração: todos os produtos preenchidos, índice criado, reversão, cópia igual à função do domínio
- [x] `SellerProductEntry` expõe o nome normalizado; `CatalogDatabase.findProductIdsByNormalizedName`, com teste de uso do índice
- [x] `ImportCatalog`: cascata exato → normalizado, com a regra de ambiguidade em cada etapa
- [x] Testes da aplicação: match normalizado, precedência do exato, ambiguidade na normalização
- [x] Aceitação: as contagens do gabarito, os quatro casos especiais (#53, #55, #267, #268) e cada oferta com o mesmo nome normalizado, marca e categoria
- [x] Atualizar a `data-analysis §5`, o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **A decisão 3 (cascata exato → normalizado) foi revista depois da implementação, a pedido do usuário: ficou só o match normalizado.**
  - Todo match exato também é um match normalizado. As duas regras só divergem quando o catálogo tem dois produtos que diferem apenas na grafia: a cascata ligaria o item ao de grafia exata, e só com a normalizada ele fica ambíguo. É uma perda de recall sem risco para a precisão, e o caso não existe nos dados.
  - O estudo (§5) já previa "normalizar e buscar a chave normalizada", sem uma etapa separada para o nome cru.
  - Saíram `CatalogDatabase.findProductIds` e o método `findUniqueProduct`. A **migração 005** remove o índice da 003, que ficou sem uso.
  - O resultado sobre o arquivo é o mesmo: 263 ligados, 1 já ligado, 5 pendentes. São 117 testes.
- **A cascata ficou num método privado, `findUniqueProduct`,** que percorre uma lista de regras (exato, depois normalizado). Uma regra nova da cascata entra como mais um item dessa lista.
- **Um teste antigo da aplicação usava espaço duplo como exemplo de "sem match".** Ele passou a usar uma variação de marca, que a normalização não cobre.

## Resultado

- **Bate exatamente com o gabarito:** 263 `linked`, 1 `alreadyLinked`, 5 `unmatched`, 0 `conflict`, 0 `rejected` e 1.238 ofertas. Na segunda execução, 264 `alreadyLinked`.
- **122 testes passam,** contra o SQLite real e sem mocks. Os novos cobrem:
  - a normalização, incluindo os pares que não podem se juntar (Men/Women, S23/S24, 55"/65", 12.9/129);
  - a migração 004: preenchimento, índice, reversão e a cópia congelada igual à função do domínio;
  - o uso do índice novo;
  - a precedência do match exato e a ambiguidade na normalização;
  - os quatro casos especiais (#53, #55, #267 e #268).
- O banco original continua intacto.
