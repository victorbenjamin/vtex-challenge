# 016: Reaproveitar os prepared statements

**Status:** concluído (2026-10-26)

## Objetivo

Corrigir o vazamento de memória nativa medido em [performance-and-scale §1.2](../analysis/performance-and-scale.md). Cada consulta do `CatalogDatabase` chama `db.prepare(...)` de novo, e cada chamada cria um statement nativo, que só é liberado quando o coletor de lixo do JavaScript roda. A memória do processo cresce cerca de 17 KB por item (1.858 MB com 107.600 itens), e um arquivo grande derrubaria o processo.

## Decisões

1. **Cada SQL é preparado uma vez por conexão e reaproveitado,** num cache privado do `CatalogDatabase` (`Map` de texto do SQL para statement). Todas as consultas passam pelo método `statement(sql)`.
2. **`pluck()` e `raw()`** mudam o modo do statement. Como cada texto de SQL é sempre usado do mesmo jeito, aplicá-los de novo no statement do cache não muda nada.
3. **A consulta com SQL variável** (`findActiveProductsOfBrand`, com marca nula ou não) gera dois textos fixos, que viram duas entradas no cache.
4. **O comportamento não muda.** Os testes atuais são a verificação. A melhoria é medida com o mesmo arquivo sintético de 107.600 itens da análise.

## Passos

- [x] Cache de statements no `CatalogDatabase`
- [x] Rodar `typecheck`, `test` e `format:check`
- [x] Medir de novo: 107.600 itens, memória do processo e itens por segundo
- [x] Atualizar a análise, `evolution.md`, o README (a limitação conhecida) e o changelog

## Desvios

Nenhum.

## Resultado

- **As 17 chamadas a `db.prepare`** do `CatalogDatabase` passam pelo método `statement(sql)`, que guarda os statements num cache.
- **263 testes passam, sem mudança.**
- **Medido com o arquivo sintético da análise:**

  | | Antes | Depois |
  |---|---|---|
  | 107.600 itens, WAL: memória do processo | 1.858 MB | **178 MB** |
  | 107.600 itens, WAL: itens/s | 2.703 | **4.989** |
  | 26.900 itens, modo padrão: memória do processo | 557 MB | **101 MB** |

- **No modo padrão, o tempo continua dominado pela escrita em disco de cada item** (92 s nesta execução, 74 s na anterior; varia bastante no WSL). É o assunto das transações por lote.
