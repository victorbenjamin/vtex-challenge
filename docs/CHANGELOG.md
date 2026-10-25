# Changelog

Registro cronológico de tudo o que foi feito no projeto, da entrada mais antiga para a mais recente. Novas entradas vão no fim.

## 2026-10-25

1. **Leitura do enunciado.** Extraídos os links dos dados (`catalog.db` e `ProductEntry.json`, num bucket S3 da VTEX) e feito um primeiro levantamento das ambiguidades.
2. **Organização do projeto.**
   - Dados em `data/` e documentos em `docs/`.
   - `git init` na branch `main`.
   - `.gitignore` criado.
3. **Publicação.** Repositório público criado em https://github.com/victorbenjamin/vtex-challenge e feito o primeiro push.
4. **Confidencialidade.** Adicionado o PDF de orientações, que tem aviso de confidencialidade.
   - Os PDFs foram excluídos do versionamento.
   - O enunciado, que já tinha sido enviado, foi removido do histórico. O primeiro commit foi refeito (`c7d7462`) e enviado com force push.
5. **Estudo de técnicas.** Entity resolution e product matching: técnicas, prós e contras, e abordagem recomendada. → `docs/analysis/entity-resolution-study.md`
6. **Análise dos dados.** Perfil completo do banco e do arquivo. → `docs/analysis/data-analysis.md`
   - **Achado principal:** 268 dos 269 itens correspondem a produtos já existentes. O único sem correspondente é um teste de SQL injection.
   - As contagens do estudo foram corrigidas com base nesta análise.
7. **Commit `cc24f9b`.** Os dois documentos de análise foram enviados ao GitHub.
8. **Documentação para o Claude Code.**
   - `CLAUDE.md` criado com as preferências de trabalho.
   - `docs/` reorganizado em `analysis/`, `plans/` e `challenge/` (esta última local e no `.gitignore`).
   - Criados este changelog e o resumo local do desafio.
9. **Commit e push** do `CLAUDE.md`, do changelog e da reorganização de `docs/`.
