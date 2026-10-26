# Evoluções possíveis

Todas as evoluções discutidas ao longo do projeto e **não implementadas**, com o motivo, o custo ou risco, o que precisa existir antes e de onde vieram. Serve de mapa para a entrevista: o que foi deixado de fora, por que, e em que ordem faria sentido.

O critério para deixar algo de fora foi sempre o mesmo: não acrescentar código para defender sem ganho no desafio. O arquivo do desafio já é resolvido por completo (267 ligados, 1 já ligado, 1 criado).

**Legenda de prioridade:**
- **Alta:** fecha uma lacuna real ou é pré-requisito de outra evolução.
- **Média:** útil quando o volume ou o uso crescer.
- **Baixa:** só se surgir a necessidade.

## 1. Escala e infraestrutura

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Transações por lote** | Diluir o custo de confirmação: com 1 milhão de itens, 1 milhão de confirmações em vez de 2 mil. A transação por item foi uma simplificação **temporária**. | Uma falha desfaz o lote inteiro (a importação é idempotente, então rodar de novo completa). Mexe só no `ImportCatalog`. | — | Planos 006 e 006/desvio | Média |
| **Leitura do arquivo em fluxo** | Um arquivo de vários GB não cabe na memória (`JSON.parse`). | Exige um parser de fluxo (`stream-json`) para manter o formato de array, ou trocar o formato para NDJSON. O laço vira `for await`, mas a transação de cada item continua síncrona. | — | Discussão sobre assincronismo; plano 006 | Média |
| **Postgres no lugar do SQLite** | Banco de produção, com vários processos escrevendo. | Driver assíncrono: o caso de uso inteiro vira assíncrono. Transações `IMMEDIATE` (ou equivalente) para o catálogo lido não mudar antes da escrita. | Lote e leitura em fluxo já resolvidos | Plano 006 | Baixa no desafio |
| **Restrição única contra duplicata concorrente** | Duas importações criando o mesmo produto ao mesmo tempo gravam duas linhas (no SQLite a segunda falha; no Postgres passaria). | Exige a coluna `NormalizedBrand` (recusada no plano 009) e um índice único `(NormalizedName, NormalizedBrand)`. Mais uma cópia congelada de normalização. | Postgres | Planos 011 e 009 | Média, com Postgres |
| **Paralelismo por seller** | Processar mais rápido com um banco assíncrono. | Paralelizar itens soltos tornaria o resultado não determinístico num conflito de SKU. Por seller, os conflitos (que só ocorrem dentro do mesmo seller) continuam em ordem. | Postgres | Discussão sobre assincronismo | Baixa |
| **Separar "decidir" de "gravar"** | Quando entrar um passo lento (LLM, embeddings), a espera não pode acontecer dentro da transação. | Decidir fora da transação (pode ser assíncrono) e gravar numa transação curta. A gravação já reavalia o estado (`addOfferIfAbsent`). | Um passo lento na cascata | Discussão sobre assincronismo | Junto com LLM |
| **CI (GitHub Actions)** | Rodar checagem de tipos e testes a cada push. | Cerca de 20 linhas. O desafio diz que não é necessário. | — | Próximas etapas | Opcional |

## 2. Matching

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Identificador global (GTIN/EAN) dos sellers** | Resolve a maior parte do problema na origem: o mesmo código de barras é o mesmo produto. | Depende de os sellers enviarem o código. | Mudança no formato do arquivo | Estudo §3.1 | Alta, fora do código |
| **Busca de parecidos por trigramas (FTS5)** | A revisão de nomes parecidos só olha a mesma marca. Uma duplicata com a marca escrita de outro jeito escapa. | Tabela virtual FTS5 sincronizada com `Product`. Mais candidatos, mais revisões. | — | Plano 015 | Média |
| **Alias de marca (`BrandAlias`)** | `Samsung Electronics` e `Samsung`, `HP` e `Hewlett-Packard`: a normalização não cobre nomes diferentes da mesma empresa. Hoje cada produto passa por uma revisão própria. | **Um alias errado liga ofertas ao produto errado em todos os produtos da marca.** Tabela própria (não a `NameSynonym`), aplicada nos dois lados, sem migração de dados. Só compensa quando há muitos produtos com a mesma variação. | — | Discussão sobre marcas | Baixa |
| **Promover um merge a alias de marca** | O revisor, ao mesclar por causa de uma variação de marca, transforma a decisão numa regra para todos os produtos. | Sempre uma ação explícita, nunca automática: um merge pode ter outros motivos. | Alias de marca | Discussão sobre marcas | Baixa |
| **Desempate por categoria** | Dois produtos com o mesmo nome e a mesma marca em categorias diferentes hoje são ambíguos. A categoria poderia escolher entre eles. | Exige reconhecer variações de categoria (`Photo` e `Photography`): mapa de categorias ou comparação por prefixo. Nenhum caso nos dados. | — | Plano 009 | Baixa |
| **Unidades de medida** | `55 inch`, `55 polegadas` e `55"` são a mesma coisa; hoje só as aspas são tratadas. | Regras de normalização por unidade (polegada, GB, ml). Risco de juntar o que não deve. | Nova migração para recalcular o `NormalizedName` (cópia congelada) | Discussão sobre arquivos novos | Baixa |
| **Sinônimos de mais de uma palavra** | `placa mãe` → `motherboard`. Hoje o `Term` é uma palavra só (`CHECK`). | Troca por sequência de palavras, com cuidado na ordem de aplicação. | — | Plano 010 | Baixa |
| **Embeddings como gerador de candidatos** | Entendem significado e tradução sem dicionário. | Capturam mal os números (S23/S24), trazem dependência de modelo e pouca explicabilidade. Serviriam para **sugerir** candidatos, nunca para decidir. | Separar decidir de gravar | Estudo §3.8 | Baixa |
| ~~Fuzzy ligando automaticamente~~ | — | **Descartado:** contradiz o princípio de precisão. "Multivitamin Men" e "Women" ficam a 0.94. A similaridade só gera revisão (plano 015). | — | Estudo §2 | Não fazer |

## 3. Itens pendentes (ambiguidade)

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Detectar duplicatas do catálogo de forma proativa** | A causa de um item ambíguo é o catálogo ter dois produtos com o mesmo nome e marca. Um comando que lista esses grupos permite mesclá-los **antes** de causarem ambiguidade. | Uma consulta agrupada; a resolução usa o merge existente. | — | Discussão sobre ambiguidade | Média |
| **Pendências guardadas no banco, com ligação manual** | Hoje um item ambíguo só aparece no relatório. Guardar a pendência e ter um comando `catalog assign <seller> <sku> <produto>` permite resolvê-la sem reimportar. | Mais uma tabela e mais um comando. | — | Discussão sobre ambiguidade | Baixa |

## 4. Revisão e merge

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Merge reversível** | Hoje o merge **não é reversível**: depois do `UPDATE`, as ofertas que vieram da duplicata ficam indistinguíveis das do destino. Uma revisão humana também pode errar. | Registrar o merge como evento (`ProductMerge`) e as ofertas movidas (seller, SKU, produto de antes). Um comando de "desfazer" lê o registro. Ofertas ligadas depois pelo apelido continuam difíceis de atribuir. | — | Discussão sobre LLM | **Alta** (pré-requisito da LLM) |
| **LLM sugerindo merge ou distintos** | A LLM sabe que `Samsung Electronics` é `Samsung`, que `Smarthpone` é erro de digitação, que `Galaxy S23 Ultra` é outro modelo. Reduz o trabalho de revisão. | Um merge errado é o erro caro. Por isso **sugere, e uma pessoa confirma**. Cuidados: os textos do seller são dados (prompt injection), resposta estruturada, sem ferramentas, sugestão e justificativa guardadas, sem perguntar de novo pelo mesmo par. | Separar decidir de gravar | Discussão sobre LLM; estudo §3.10 | Média |
| **LLM aplicando sozinha com confiança alta** | Automatizar o que as sugestões mostrarem que acerta. | Só com o merge reversível e depois de medir as sugestões. | Merge reversível; sugestões medidas | Discussão sobre LLM | Baixa |
| **Interface de revisão** | Hoje a revisão é pelo comando `catalog`. | Uma tela para a fila de revisões e as sugestões. | — | Plano 012 | Baixa no desafio |
| **Oferta em espera até a revisão** | Hoje um item `createdForReview` já vende pelo produto novo, e a duplicata fica visível até o merge. | Coluna de status em `SellerProduct`. O seller espera a revisão para vender. É uma troca: nenhuma duplicata visível contra um atraso na venda. | — | Discussão sobre revisão | Baixa |

## 5. Sinônimos

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Comandos para manter os sinônimos** | A tabela foi pensada para a operação manter sem deploy, mas hoje só se mexe nela por SQL. `catalog synonyms`, `synonym add` e `synonym remove`. | Pequeno. Útil numa demonstração ao vivo. Um produto criado antes do sinônimo existir fica para mesclar depois. | — | Discussão sobre sinônimos | **Alta** |
| **Sinônimos sugeridos pelos merges** | Quando os nomes de D e P diferem por uma palavra (`roteador` e `router`), o par vira uma sugestão. A decisão do revisor ensina a regra. | Sempre aprovado por uma pessoa: um sinônimo vale para todos os itens futuros. | Comandos de sinônimos | Discussão sobre sinônimos | Média |
| **Sinônimos sugeridos pelo relatório** | Itens `created` com palavras que não existem em nenhum nome do catálogo são candidatos a tradução. | Mesmo cuidado de aprovação. | Comandos de sinônimos | Discussão sobre sinônimos | Média |
| **LLM sugerindo sinônimos** | Tradução é o ponto forte de uma LLM. O estrago de um sinônimo errado é limitado: o nome inteiro e a marca ainda precisam bater. | **Filtro automático:** a tradução precisa existir no vocabulário do catálogo e o termo não. Palavras com mais de uma tradução (`mesa` → `table`/`desk`) ainda exigem uma pessoa. Mesmos cuidados de prompt injection. | Comandos de sinônimos | Discussão sobre sinônimos | Média |

## 6. Catálogo e modelo de dados

| Evolução | Por quê | Custo / risco | Pré-requisito | Origem | Prioridade |
|---|---|---|---|---|---|
| **Enriquecer o catálogo com dados do seller** | Preencher um campo que o catálogo não tem (marca ou categoria nula), quando o seller traz. | Decidir quem tem razão quando divergem; hoje o catálogo é sempre a fonte de verdade. | — | Data-analysis §3.3 | Baixa |
| **Registrar a categoria divergente do seller** | Hoje a categoria do seller é descartada (não é comparada nem gravada). Ninguém vê que `Photo` diferiu de `Photography`. | Um campo a mais no relatório da importação. | — | Discussão sobre categoria | Baixa |
| **Tabelas `Brand` e `Category`** | Grafia única por marca e integridade (`AmazonBasics` e `Amazon Basics` estão no catálogo como marcas diferentes). | Antes, decidir quais variações são a mesma marca: entity resolution de marcas, com mapeamento manual. | Alias de marca | Discussão sobre normalização | Baixa |
| **Gravar o motivo do match em `SellerProduct`** | Auditoria permanente de cada ligação (o estudo §5 previa isso). | Hoje o motivo vai só para o relatório de cada importação. Uma coluna a mais, preenchida também na reimportação. | — | Estudo §5; plano 014 | Baixa |

## 7. Ordem sugerida, se o projeto continuasse

1. **Comandos de sinônimos** e **merge reversível:** pequenos, e são pré-requisitos do resto.
2. **Detectar duplicatas do catálogo** e **busca por trigramas:** reduzem as duplicatas que escapam hoje.
3. **LLM sugerindo** merges e sinônimos, sempre com aprovação humana e separando decidir de gravar.
4. **Escala** (lote, leitura em fluxo, Postgres com restrição única, paralelismo por seller), quando o volume exigir.
