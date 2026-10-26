# 017: SQLite em modo WAL

**Status:** concluído (2026-10-26)

## Objetivo

Usar o modo WAL (*Write-Ahead Logging*) na cópia de trabalho, pedido do usuário. Pela [análise de desempenho §1.1](../analysis/performance-and-scale.md), o modo padrão (journal `delete`) força várias gravações em disco por transação, e com uma transação por item isso domina o tempo da importação. O WAL foi medido **7 vezes mais rápido**, sem mudar a importação.

## Decisões

1. **`journal_mode = WAL` e `synchronous = NORMAL`** em toda conexão de escrita da cópia de trabalho:
   - em `openWorkingDatabase` (`src/infrastructure/sqlite/connection.ts`);
   - no `afterCreate` do migrador Knex (`src/infrastructure/sqlite/migrations.ts`).
   - O modo WAL fica gravado no arquivo, mas é aplicado em toda conexão para não depender da ordem em que o banco foi aberto.
2. **Durabilidade aceita:** com `synchronous = NORMAL`, uma queda de energia pode perder as últimas transações confirmadas, sem corromper o banco. A importação é idempotente, então uma nova execução refaz o que faltar.
3. **O banco original nunca entra em WAL.** O WAL altera o cabeçalho do arquivo, e o original só é aberto somente para leitura (preferência 6). `openWorkingDatabase` e o migrador já recusam o original.
4. **`createWorkingCopy` apaga os arquivos `-wal` e `-shm` do destino antes de copiar.** Arquivos de WAL de uma execução anterior seriam aplicados sobre a cópia nova e a corromperiam.
5. **Leitura externa (DBeaver com `immutable=1`):** enquanto o processo está aberto, as últimas alterações podem estar só no `-wal`. Quando a última conexão fecha, o SQLite transfere o WAL para o `.db` (checkpoint) e remove os arquivos extras. Os CLIs fecham a conexão no fim, então depois de cada comando o `.db` fica completo.

## Passos

- [x] WAL e `synchronous = NORMAL` em `openWorkingDatabase` e no migrador
- [x] `createWorkingCopy` apaga o `-wal` e o `-shm` do destino
- [x] Testes: a conexão de trabalho em WAL com `synchronous = NORMAL`; o migrador em WAL; a cópia remove os arquivos de WAL antigos; o original continua no modo `delete`
- [x] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`; medir o arquivo sintético de 26.900 itens; conferir que depois do comando não sobram `-wal` e `-shm`
- [x] Atualizar a análise, o README, o `CLAUDE.md` e o changelog

## Desvios

- **Os pragmas ficaram numa constante só** (`WORKING_DATABASE_PRAGMAS`), usada pela conexão e pelo migrador, para não divergirem.

## Resultado

- **267 testes passam.** Os novos cobrem:
  - a conexão de trabalho em WAL com `synchronous = NORMAL` e chave estrangeira;
  - o migrador em WAL;
  - a remoção dos arquivos de WAL antigos;
  - o original continuando no modo `delete`.
- **A importação do arquivo do desafio não mudou:** 267 ligados, 1 já ligado, 1 criado.
- **Velocidade:** os 26.900 itens do arquivo sintético pelo CLI levaram **7,8 s**, contra 71 a 92 s antes, com 104 MB de memória.
- **Arquivos extras:** depois de `db:reset` e de `import`, não sobram `-wal` e `-shm`. O checkpoint acontece quando a conexão fecha.
- **O banco original** continua intacto e no modo `delete`.
