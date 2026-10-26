# Desempenho e escala: arquivos grandes e Postgres

Como a importação se comporta com arquivos grandes, o que muda num banco como o Postgres, e o que fazer, em ordem de impacto. As seções 1 a 3 são **medidas**; a seção 4 é uma **projeção**, com as premissas explícitas.

## Resumo

Três achados medidos, por ordem de importância:

1. **Vazamento de memória nativa, proporcional ao arquivo (defeito, corrigido no plano 016).** Cada consulta chama `db.prepare(...)` de novo. O `better-sqlite3` cria um *prepared statement* nativo a cada chamada, que só é liberado quando o coletor de lixo do JavaScript roda. Como a memória do JavaScript continua pequena, ele quase não roda. A memória do processo cresce cerca de 17 KB por item: com 1 milhão de itens, seriam uns 17 GB, e o processo cairia. **Guardar os statements resolve:** 10 vezes menos memória e 46% mais rápido.
2. **A confirmação de cada item em disco domina o tempo.** Uma transação por item significa uma escrita forçada em disco por item. Agrupar a importação em menos transações a deixa **21 vezes mais rápida**. Num Postgres o efeito se repete: cada confirmação espera o log ser gravado.
3. **O arquivo é lido inteiro para a memória** (`JSON.parse`). Isso fica bom até centenas de MB, mas não serve para arquivos de vários GB. O relatório já é gravado em fluxo; a leitura não.

Num Postgres entra um quarto fator, que no SQLite não existe: **a ida e volta pela rede de cada consulta.** O caminho comum faz de 5 a 7 consultas por item. O ganho principal ali vem de fazer menos idas ao banco: cache dos sellers, consultas que já devolvem o resultado (`RETURNING`), consultas em lote.

## 1. Medições

**Ambiente:** WSL2 no Windows, Node 22, `better-sqlite3`, cópia de trabalho `output/catalog.db`. Os números absolutos dependem do disco; o que importa são as proporções.

**Arquivos sintéticos,** gerados a partir do arquivo do desafio:
- **"ligar":** os 269 itens repetidos 100 ou 400 vezes, com SKUs novos. Exercita o caminho de ligar uma oferta.
- **"criar":** 5.000 produtos inéditos, em 50 marcas. Exercita o caminho de criação: a busca por nomes parecidos na marca, a criação e a revisão.

### 1.1 Tempo

| Cenário | Itens | Tempo | Itens/s |
|---|---|---|---|
| Arquivo do desafio | 269 | 1,2 s (inclui a inicialização do `tsx`) | — |
| "ligar", como está hoje (uma transação por item, journal `delete`) | 26.900 | 71 a 74 s | **~370** |
| "ligar", com WAL + `synchronous=NORMAL` | 26.900 | 9,9 s | 2.722 |
| "ligar", sem fsync (`synchronous=OFF`) | 26.900 | 11,3 s | 2.379 |
| "ligar", **tudo numa transação** (os itens viram savepoints) | 26.900 | 3,5 s | **7.648** |
| Reimportar "ligar" (tudo `alreadyLinked`, quase nada a gravar) | 26.900 | 7,3 s | ~3.700 |
| "criar" (busca na marca, criação, sem revisões) | 5.000 | 25,2 s | **~200** |

**Leitura dos números:**
- **Reimportar é 10 vezes mais rápido que importar,** porque quase não grava, e as consultas são as mesmas. **O tempo está na confirmação em disco, não nas consultas.**
- **Confirmar uma vez para o arquivo inteiro é 21 vezes mais rápido.** O WAL sozinho já dá 7 vezes.
- **Criar é o caminho mais caro:** mais consultas, até 200 produtos da marca trazidos para a memória e a similaridade calculada em JavaScript.

### 1.2 Memória

| Cenário | Itens | Memória do V8 | Memória do processo |
|---|---|---|---|
| Arquivo do desafio | 269 | 11 MB | 84 MB |
| "ligar" | 26.900 | 45 MB | 557 MB |
| "ligar" | 107.600 | 92 MB | **1.858 MB** |
| "ligar", **com os statements em cache** (teste num script descartável) | 107.600 | 64 MB | **177 MB** (e 3.942 itens/s, contra 2.703) |
| **Depois da correção (plano 016), com WAL** | 107.600 | 52 MB | **178 MB**, 4.989 itens/s |
| **Depois da correção, modo padrão** | 26.900 | 14 MB | **101 MB** (antes, 557 MB) |

A memória do JavaScript cresce pouco: é o arquivo lido inteiro. **A memória nativa crescia em linha reta com o número de itens:** eram os statements criados a cada consulta e nunca reaproveitados. **Corrigido no plano 016:** o `CatalogDatabase` prepara cada consulta uma vez e a reutiliza.

**Observação sobre o tempo no modo padrão:** depois da correção, os mesmos 26.900 itens levaram 92 s (antes, 74 s). Nesse modo, o tempo é dominado pela escrita em disco de cada confirmação, que varia bastante de uma execução para outra no WSL. A melhoria de velocidade da correção aparece com o WAL, onde o disco pesa menos.

## 2. Custo de um item hoje

Consultas por item em cada caminho do `ImportCatalog` (no SQLite cada uma é uma chamada de função; num Postgres, cada uma é uma ida e volta pela rede):

| Caminho | Consultas | Observação |
|---|---|---|
| Transação do item | 2 (`BEGIN`, `COMMIT`) | O `COMMIT` espera o disco |
| Busca pelo nome normalizado | 1, ou 2 com a tradução | Por índice |
| Seller | 2 (`INSERT ... ON CONFLICT`, depois `SELECT`) | Os sellers de um arquivo são poucos e se repetem |
| Ligar a oferta (`linked`/`alreadyLinked`) | 1, ou 2 se já existia | `INSERT ... ON CONFLICT` e, se não inseriu, `SELECT` |
| Criar (`created`/`createdForReview`) | +4 a 5: SKU, produtos da marca (até 200 linhas), produto, oferta, revisões | E a similaridade calculada no Node |
| **Total, caminho de ligar** | **~6 a 7** | |
| **Total, caminho de criar** | **~10 a 12** | |

## 3. Pontos fortes do desenho atual

Muito do que importa para escala já está certo:
- **Nada é carregado inteiro:** nem o catálogo, nem as ofertas de um seller (plano 006). Só a tabela de sinônimos, que tem o tamanho de uma configuração.
- **Todas as buscas usam índice,** conferido com `EXPLAIN QUERY PLAN` nos testes.
- **Transações curtas:** nenhuma trava longa. Num Postgres, isso evita bloquear outras escritas e atrasar a limpeza de linhas antigas.
- **As gravações são "insere se não existir", com o banco arbitrando a concorrência,** e a importação é idempotente: rodar de novo depois de uma falha completa o trabalho.
- **O relatório é gravado em fluxo,** sem acumular na memória.

## 4. Projeção para Postgres

**Premissas:**
- banco na mesma região, com **0,3 a 1 ms de ida e volta**;
- `synchronous_commit = on`, com **0,5 a 2 ms** por confirmação (o log gravado em SSD);
- uma conexão.

São estimativas para orientar a ordem das melhorias. **Não são medições.**

| Desenho | Idas ao banco por item | Itens/s por conexão | 1 milhão de itens |
|---|---|---|---|
| Como está hoje (uma transação e cerca de 7 consultas por item) | ~7, mais uma confirmação | ~150 a 400 | **~45 min a 2 h** |
| + cache de sellers e consultas com `RETURNING` | ~4, mais uma confirmação | ~250 a 700 | ~25 a 70 min |
| + lotes de 500 itens (uma confirmação por lote, um savepoint por item) | ~4 | ~500 a 1.500 | ~10 a 35 min |
| + busca em lote (os produtos de 500 itens numa consulta, `= ANY($1)`) | ~1 a 2 | ~2.000 a 5.000 | ~3 a 8 min |
| + paralelismo por seller (N conexões) | o mesmo | × N, até o limite do banco | ÷ N |
| Carga em massa: `COPY` para uma tabela de staging, seguida de SQL em conjunto | ~0 por item | dezenas de milhares | **poucos minutos** |

## 5. Gargalos e soluções, em ordem de impacto e custo

### 5.1 Reaproveitar os prepared statements (defeito, corrigido no plano 016)

- **Problema:** a memória nativa cresce cerca de 17 KB por item (seção 1.2). Um arquivo grande derruba o processo.
- **Solução:** preparar cada consulta uma vez, no `CatalogDatabase`, e reutilizar.
- **Medido:** 10 vezes menos memória e 46% mais rápido.
- **Num Postgres:** o equivalente é usar consultas preparadas com nome, reaproveitadas pelo driver.
- **Feito (plano 016):** a memória do processo com 107.600 itens caiu de 1.858 MB para 178 MB, e a velocidade com WAL subiu de 2.703 para 4.989 itens/s.

### 5.2 Confirmar em lotes, sem perder o isolamento por item

- **Problema:** uma confirmação por item domina o tempo (seção 1.1).
- **Solução:** uma transação por lote de N itens, com um **savepoint por item**:
  - um item que falha desfaz só o próprio savepoint;
  - o relatório só registra o lote depois da confirmação, como hoje faz por item.
  - É exatamente o que a medição "tudo numa transação" fez: o `better-sqlite3` transforma a transação de cada item em savepoint. Foi **21 vezes mais rápido**.
- **No SQLite, um ganho imediato e separado: `journal_mode = WAL`.** **Feito no plano 017:** a cópia de trabalho usa WAL com `synchronous = NORMAL`. Os 26.900 itens pelo CLI caíram de 71 a 92 s para **7,8 s**.
  - A cópia remove os arquivos `-wal` e `-shm` antigos antes de copiar o original.
  - Quando a conexão fecha, o SQLite transfere o WAL para o `.db`, então nada sobra entre comandos.
- **Custo:** a falha técnica passa a desfazer o lote em curso, e não só o item. A retomada continua correta, porque a importação é idempotente. Era a decisão original do plano 006, simplificada depois.

### 5.3 Menos idas ao banco por item (Postgres)

- **Sellers em cache durante a importação:** um arquivo tem poucos sellers, que se repetem. O cache só pode guardar sellers **já confirmados**: um seller criado num lote desfeito não pode ficar no cache.
- **Consultas que devolvem o resultado:** no Postgres, `INSERT ... ON CONFLICT (...) DO UPDATE SET ... RETURNING Id` dá o id do seller numa ida só. O mesmo vale para a oferta, que devolve a linha existente.
- **Busca em lote:** os produtos de todos os itens de um lote numa consulta só (`WHERE NormalizedName = ANY($1)`), e a decisão de cada item em memória. **Esta é a mudança de maior ganho num Postgres.**
- **Pipelining:** drivers como o `postgres` (porsager) enviam várias consultas sem esperar cada resposta. O `pg`, mais comum, não faz isso.

### 5.4 Ler o arquivo em fluxo

- **Problema:** `JSON.parse` do arquivo inteiro. A memória cresce com o arquivo, e nada começa antes de ele ser lido por completo.
- **Solução:** um parser de fluxo (`stream-json`), mantendo o formato de array. O laço vira `for await`, e as transações continuam síncronas ou por lote.
- **Com um driver assíncrono:** limitar quantos itens ficam em processamento ao mesmo tempo, para a leitura não andar mais rápido que a gravação.

### 5.5 Similaridade dentro do banco (o caminho de criar)

- **Problema:** para cada produto criado, até 200 produtos da marca vêm para o Node, e a similaridade é calculada em JavaScript. É o caminho mais lento (~200 itens/s) e depende da marca.
- **No Postgres:** a extensão `pg_trgm`, com um índice GIN em `NormalizedName` e o operador de similaridade (`%`), devolve só os candidatos parecidos, **sem depender da marca**. A regra dos números iguais continua no domínio, sobre esses poucos candidatos. Equivale à evolução por trigramas (FTS5) já registrada para o SQLite.

### 5.6 Normalização no próprio banco (Postgres)

- **Hoje:** o `NormalizedName` é calculado em TypeScript, e a migração 004 tem uma cópia congelada da função, porque o SQLite não sabe remover acentos.
- **No Postgres:** a extensão `unaccent`, com `lower` e `regexp_replace`, numa função `IMMUTABLE`, permite uma **coluna gerada** (`GENERATED ALWAYS AS ... STORED`) com índice.
  - **Ganho:** a cópia congelada some, e um produto novo nunca fica sem `NormalizedName`.
  - **Risco:** as duas normalizações (a do banco e a do domínio, usada nos itens) precisam ser iguais. Um teste de paridade teria de compará-las.

### 5.7 Concorrência

- **Produto criado em dobro:** com várias importações ao mesmo tempo, duas podem criar o mesmo produto.
  - **Solução:** uma restrição única em `(NormalizedName, NormalizedBrand)`, com `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Exige `NormalizedBrand` como coluna, que pode ser gerada, como na seção 5.6.
- **Ordem por seller:** paralelizar por seller (uma fila ou um worker por seller, ou um hash do nome entre N workers) mantém a ordem dos itens de cada seller. Os conflitos de SKU só acontecem dentro de um mesmo seller, então o resultado continua determinístico.
- **Isolamento:** o `READ COMMITTED` padrão do Postgres basta, porque as restrições únicas arbitram as corridas e o domínio reavalia o que já está gravado.
- **Pool de conexões:** o número de workers fica limitado pelas conexões disponíveis. Ligar o mesmo produto a muitas ofertas simultâneas não causa disputa de trava, porque cada oferta é uma linha diferente.

### 5.8 Retomada de arquivos grandes

- **Hoje:** depois de uma falha, rodar de novo reprocessa tudo. É correto, por ser idempotente, mas lento.
- **Solução:** uma tabela de importações com o hash do arquivo e o último índice confirmado. A nova execução pula direto para onde parou.

### 5.9 Postgres: manutenção

- **Inserções em massa em `SellerProduct`:** ajustar o *autovacuum* e o *analyze* da tabela, para as estatísticas acompanharem o crescimento.
- **Merge** (`UPDATE SellerProduct ... WHERE ProductId = D`): usa o índice em `ProductId` e mexe só nas ofertas de um produto. Não é um problema de escala.
- **`ProductReview`:** um índice parcial `WHERE Status = 'pending'` mantém a fila rápida com um histórico grande.

### 5.10 A alternativa em conjunto: staging com `COPY`

Para cargas iniciais de milhões de itens:
1. `COPY` do arquivo para uma tabela de staging (dezenas a centenas de milhares de linhas por segundo).
2. Os casos claros resolvidos em SQL de uma vez: as ofertas cujo nome normalizado e marca casam com exatamente um produto, com `INSERT ... SELECT ... JOIN`.
3. Só o que sobrar (traduções, criações, revisões, ambiguidades) passa pelo caminho de domínio, item a item.

- **Ganho:** ordens de grandeza mais rápido para a parte clara, que no desafio é 98% do arquivo.
- **Custo:** as regras passam a existir em dois lugares (SQL e domínio). É mais difícil de testar e de explicar, e há risco de as duas divergirem. Só compensa para cargas realmente grandes ou para a migração inicial.

## 6. Ordem recomendada

1. ~~**Reaproveitar os prepared statements**~~ (seção 5.1): **feito no plano 016.**
2. **Confirmar por lote com savepoint por item** (5.2). O WAL (para o SQLite) já foi feito no plano 017.
3. **Ler o arquivo em fluxo** (5.4).
4. **Na migração para o Postgres:** cache de sellers, `RETURNING` e busca em lote (5.3); restrição única com a marca normalizada (5.7); `pg_trgm` para os nomes parecidos (5.5).
5. **Paralelismo por seller** e retomada por checkpoint (5.7 e 5.8), quando um processo não der conta.
6. **Staging com `COPY`** (5.10), só para cargas iniciais muito grandes.
