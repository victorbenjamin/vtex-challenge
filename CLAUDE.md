# CLAUDE.md

Take-home da VTEX, "Catalog Consolidation": importar produtos de vários sellers (`data/ProductEntry.json`) para o catálogo SQLite (`data/catalog.db`), sem duplicar produtos e ligando cada seller ao produto em `SellerProduct`. O desafio tem ambiguidades intencionais. A avaliação pesa as decisões justificadas e o uso crítico de IA, e haverá uma entrevista ao vivo sobre o código.

## Preferências de trabalho (obrigatórias)

1. **Criticar antes de executar.** Antes de fazer qualquer coisa pedida, compare com as análises em `docs/analysis/` e com os planos em `docs/plans/`. Se houver contradição, explique por que não é uma boa ideia, citando o documento e a seção, e **pergunte se devo prosseguir mesmo assim**. Sem contradição, siga.
2. **Commit e push só quando o usuário pedir.** Nunca por iniciativa própria.
3. **Changelog.** Registre em `docs/CHANGELOG.md` tudo o que for feito, em ordem cronológica e com entradas novas no fim. Inclua o que mudou e onde, e o motivo quando não for óbvio.
4. **Planos salvos.** Toda tarefa que tiver plano tem o plano salvo em `docs/plans/`, no formato descrito em `docs/plans/README.md`. Mantenha o status e os desvios atualizados durante a execução.
5. **Docs enxutos e navegáveis.** Organize a documentação para dar contexto rápido sem carregar o que não é necessário. Não use `@imports` aqui, e leia cada documento só quando a tarefa pedir.

## Mapa da documentação: leia sob demanda

| Arquivo | Quando ler |
|---|---|
| `docs/CHANGELOG.md` | Para saber o que já foi feito e em que ordem |
| `docs/plans/` | Antes de implementar algo. Verifique se existe um plano relacionado. |
| `docs/analysis/data-analysis.md` | Para decisões sobre schema, validação, normalização, matching ou testes. A seção 4 lista as decisões que saem dos dados, e a seção 5 é o gabarito de aceitação. |
| `docs/analysis/entity-resolution-study.md` | Para escolher ou justificar uma técnica de matching. A seção 2 trata do trade-off entre precisão e recall, e a seção 5 da cascata recomendada. |
| `docs/challenge/summary.md` | Para o enunciado e as orientações da VTEX. Esta pasta é **local e confidencial**: está no `.gitignore` e nada dela deve ir para arquivos versionados. Prefira este resumo aos PDFs. |

## Fatos essenciais (detalhes em `docs/analysis/data-analysis.md`)

- **`Product`:** 975 linhas, sem duplicatas. 119 sem marca, 34 sem categoria.
- **`SellerProduct`:** vazia. `SellerProductId` é `INTEGER`, mas os IDs do arquivo são UUIDs em texto.
- **Schema:** sem índices nem restrições de unicidade. A chave estrangeira não é verificada (`PRAGMA foreign_keys` está desligado).
- **Arquivo:** 269 itens. 268 correspondem a produtos existentes. O único sem correspondente é um teste de SQL injection com ID malformado.
- **IDs:** únicos só por seller. A chave natural é `(SellerName, Id)`.
- **Falsos positivos:** fuzzy matching ingênuo junta produtos diferentes (Multivitamin Men e Women, 0.94). A precisão vem antes do recall.
- **Queries sempre parametrizadas.** O arquivo contém uma tentativa de SQL injection.
- **Não modifique `data/catalog.db`:** é a entrada original. Trabalhe numa cópia, por exemplo em `output/`, que está no `.gitignore`.

## Decisões pendentes

- Linguagem e stack.
- Mesmo seller enviando o mesmo produto com IDs diferentes (10 casos): um link por SKU ou um por produto?
- IDs malformados (3): rejeitar ou aceitar?
- Os 777 produtos do catálogo sem seller pertencem à própria loja?

Ao decidir, mova o item para o plano ou o changelog correspondente.
