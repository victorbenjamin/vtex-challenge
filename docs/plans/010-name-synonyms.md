# 010: Importação, incremento 4 (sinônimos para traduções)

**Status:** concluído (2026-10-25)

## Objetivo

Quarta linha da tabela da [data-analysis §3.1](../analysis/data-analysis.md): os nomes **traduzidos para o português**.
- **#57** FootwearHub `Roteador WiFi 6 TP-Link` → produto 21 `Router WiFi 6 TP-Link`;
- **#64** SuperMart `Processador AMD Ryzen 9 7950X` → produto 28 `Processor AMD Ryzen 9 7950X`.

## Contexto

- **As análises já indicavam esse caminho:**
  - [estudo §3.4](../analysis/entity-resolution-study.md): dicionários são "precisos, explicáveis e auditáveis", a resposta honesta para um conjunto pequeno de dados, mas não generalizam;
  - [data-analysis §4](../analysis/data-analysis.md), item 7: o dicionário de sinônimos é a primeira opção para traduções.
- **Decisão do usuário:** guardar os sinônimos numa **tabela no banco**, mantida pela operação sem novo deploy.
- **A regra atual** (plano 009) casa por nome normalizado e marca normalizada, e só um candidato pode restar. Depois de traduzir `roteador` → `router` e `processador` → `processor`, os dois itens ficam com o nome igual ao do produto e a mesma marca.

## Decisões

1. **Os sinônimos valem num sentido só:** traduzem o vocabulário do **seller** para o do **catálogo**, e são aplicados **só no nome do item**.
   - O catálogo e o `Product.NormalizedName` não mudam.
   - Uma mudança na tabela vale na próxima importação, sem migração e sem recalcular nada.
   - *Descartado:* aplicar nos dois lados. Cada mudança na tabela deixaria o `NormalizedName` desatualizado, até uma migração nova recalculá-lo.
2. **Tabela `NameSynonym` (migração 006):**

   ```sql
   NameSynonym (
     Term        TEXT PRIMARY KEY CHECK (Term <> '' AND instr(Term, ' ') = 0),  -- uma palavra
     Replacement TEXT NOT NULL CHECK (Replacement <> '')
   )
   ```

   - O `Term` é gravado **já normalizado** (minúsculas, sem acentos), porque é comparado com as palavras do nome normalizado.
   - A migração já insere os dois sinônimos: `roteador` → `router` e `processador` → `processor`.
   - O `down` remove a tabela.
3. **Troca por palavra inteira:** o nome normalizado é separado em palavras, e cada palavra que for um `Term` é trocada pela `Replacement`. `processadores` não é afetado por `processador`.
4. **Domínio:** a classe `NameSynonyms` (`src/domain/name-synonyms.ts`) guarda os termos e tem o método `translate(normalizedName): string`. É uma classe com comportamento, não um conjunto de dados.
5. **Infraestrutura:** `CatalogDatabase.loadNameSynonyms()` carrega a tabela **uma vez por importação**, fora das transações dos itens.
   - Isso não contradiz o plano 006. O que não pode ir para a memória é o catálogo, que cresce com o negócio. A tabela de sinônimos tem o tamanho de uma configuração.
6. **Cascata: o nome original vem primeiro, e a tradução é o fallback.**
   - Tenta-se primeiro o nome normalizado, como hoje. Só se não houver **nenhum** candidato com a mesma marca, e a tradução mudar o nome, tenta-se o nome traduzido.
   - Se o nome original for **ambíguo**, o item fica `unmatched` e a tradução não é tentada.
   - **Por que a cascata volta aqui,** se foi removida no plano 008: lá, o match exato era um caso particular do normalizado. Aqui, o nome traduzido é **outro nome**, que pode apontar para outro produto. Se o catálogo tiver `Processador X` e `Processor X`, um item `Processador X` deve ligar ao primeiro.
7. **Risco de falso positivo: baixo.** O sinônimo só amplia o match quando o nome inteiro, já traduzido, fica igual a um produto do catálogo e a marca bate. Ele não aproxima nomes parecidos.
8. **Limitações registradas:**
   - só cobre os termos cadastrados;
   - palavras com mais de uma tradução possível (`mesa` → `table` ou `desk`) exigem curadoria;
   - a generalização viria com fuzzy, embeddings ou um LLM (estudo §3.3, §3.8 e §3.10).

## Resultado esperado (gabarito)

| | Incremento 3 | **Incremento 4** |
|---|---|---|
| `linked` | 265 | **267** |
| `alreadyLinked` | 1 | 1 |
| `unmatched` | 3 | **1**: #180 `Security Test Product` |
| Ofertas no total | 1.240 | **1.242** |

Na segunda execução: 268 `alreadyLinked`.

## Passos

- [x] Migração 006: tabela `NameSynonym` com `CHECK`s e os dois sinônimos; `down`
- [x] Testes da migração: a tabela, os sinônimos inseridos, o `CHECK` de uma palavra só, a reversão
- [x] `src/domain/name-synonyms.ts` (`NameSynonyms.translate`) e testes: palavra inteira, várias palavras, termo desconhecido inalterado
- [x] `CatalogDatabase.loadNameSynonyms` e teste
- [x] `ImportCatalog`: carregar os sinônimos uma vez; cascata original → traduzido
- [x] Testes da aplicação:
  - a tradução liga;
  - o nome original tem precedência;
  - um nome original ambíguo não cai para a tradução;
  - um sinônimo inserido no banco vale na importação seguinte, sem migração
- [x] Aceitação: o gabarito, #57 → 21, #64 → 28, e cada oferta com o nome (original ou traduzido) e a marca do produto
- [x] Atualizar a `data-analysis` (§4, item 7; §5), o `README.md`, o `CLAUDE.md` e o changelog
- [x] Rodar `typecheck`, `test` e `format:check`, mais `db:reset`, `import` e `import`

## Desvios

- **Os termos não precisam ser gravados já normalizados** (decisão 2). `NameSynonyms` normaliza o termo e a substituição ao carregar, então `Roteador`, `ROTEADOR` e `roteador` funcionam do mesmo jeito. O `Term` usa `COLLATE NOCASE` para impedir o mesmo termo duas vezes com caixas diferentes.
- **`findUniqueProduct` devolve `'none'`, `'ambiguous'` ou o id,** para que a cascata saiba se deve tentar a tradução (só em `'none'`).
- **Testes de migração:** as reversões encadeadas (`down()` repetido) foram trocadas por um utilitário `rollBackTo(versão)`, para não ter de reescrever esses testes a cada migração nova.

## Resultado

- **Bate com o gabarito:** 267 `linked`, 1 `alreadyLinked`, 1 `unmatched` (#180), 0 `conflict`, 0 `rejected` e 1.242 ofertas. Na segunda execução, 268 `alreadyLinked`.
- **154 testes passam,** contra o SQLite real e sem mocks. Os novos cobrem:
  - a tradução por palavra inteira;
  - a normalização dos termos cadastrados;
  - os `CHECK`s e a reversão da tabela;
  - a precedência do nome original;
  - a ambiguidade, que não cai para a tradução;
  - a marca, ainda exigida depois de traduzir;
  - um sinônimo incluído no banco valendo na importação seguinte;
  - #57 → 21 e #64 → 28 na aceitação.
- O banco original continua intacto.
