# Estudo: Entity Resolution para consolidação de catálogo

Estudo das técnicas para decidir se dois registros de produto descrevem o mesmo item, aplicado aos dados deste desafio. Serve de base para as decisões registradas no README.

## 1. O problema

Na literatura o problema aparece como **Entity Resolution**, **Record Linkage** ou **Deduplication**. No varejo, chama-se **Product Matching**. A pergunta central é: dois registros diferentes descrevem a mesma coisa do mundo real?

O pipeline clássico tem seis etapas:

```
Normalização → Blocking → Comparação → Classificação → Agrupamento → Revisão
  (limpar)    (reduzir     (score por   (match? não?   (transitivi-  (humano na
              os pares)     campo)       dúvida?)       dade)         zona cinza)
```

Neste desafio há uma simplificação importante: os itens de entrada são comparados **contra um catálogo canônico**, e não todos contra todos. Isso evita a maior parte dos problemas de transitividade (seção 3.6).

### Os dados

| Fonte | Conteúdo |
|---|---|
| `data/catalog.db`, tabela `Product` | 975 produtos (`Name`, `Brand`, `Category`), sem duplicatas mesmo após normalizar os nomes. 34 produtos sem `Category`. |
| `data/catalog.db`, tabela `SellerProduct` | Vazia. `SellerProductId` é `INTEGER`. |
| `data/ProductEntry.json` | 269 itens de 20 sellers (`Id`, `SellerName`, `Name`, `Brand`, `Category`). |

Como os itens de entrada se relacionam com o catálogo (detalhes em [data-analysis.md](data-analysis.md)):
- 200 batem exatamente com um produto do catálogo.
- 266 batem depois de normalizar nome, acentos e aspas, e de tolerar variações de marca e categoria.
- 2 são traduções para o português de produtos existentes.
- 1 é um teste de SQL injection.
- **Nenhum item legítimo é produto novo.**

### Ambiguidades encontradas

1. **`Id` em formato UUID texto**, enquanto o schema define `SellerProductId INTEGER`.
2. **3 IDs que não são UUIDs válidos**: `09835342345-…`, `uddd0000-…` e `ddddeee-…`.
3. **14 IDs repetidos:**
   - 13 pertencem a sellers diferentes, com produtos diferentes. Isso indica que o ID só é único por seller.
   - 1 é o mesmo seller enviando o mesmo item duas vezes: "Câmera" e "Camera" Canon EOS R6.
4. **Variações de escrita:**
   - Idioma e acentos: Câmera/Camera, Roteador/Router, Processador/Processor.
   - Pontuação: `12.9''`.
   - Marca: Levi's/Levis.
   - Categoria: Photo/Photography.
5. **Tentativa de SQL injection** em `Brand`: `TestBrand'; SELECT 1; --`.
6. **3 itens com `Brand` nula.**
7. **Nenhuma restrição de unicidade** no schema.

## 2. O trade-off mais importante: os dois tipos de erro

| Erro | O que acontece | Custo |
|---|---|---|
| **Falso positivo** (junta produtos diferentes) | Um seller fica ligado ao produto errado. O cliente compra um item e recebe outro. | **Alto.** Afeta pedido, devolução e confiança. |
| **Falso negativo** (não junta produtos iguais) | O produto aparece duplicado no catálogo. | **Baixo.** É indesejável, mas recuperável com um merge posterior. |

**Decisão: privilegiar a precisão.** Na dúvida, criar o produto novo ou mandar para revisão é melhor do que juntar errado.

Uma comparação de similaridade de texto (`difflib.SequenceMatcher`, após normalizar) entre os produtos do próprio catálogo encontra pares diferentes com nota alta:

| Similaridade | Produto A | Produto B |
|---|---|---|
| 0.94 | Multivitamin **Men** (Centrum) | Multivitamin **Women** (One A Day) |
| 0.91 | Compression **Shirt** (Nike) | Compression **Shorts** |
| 0.90 | Wireless Charger **Pad** (Anker) | Wireless Charger **Stand** (Belkin) |
| 0.89 | **Colander** Stainless Steel (OXO) | **Ladle** Stainless Steel (OXO) |
| 0.87 | **Can** Opener Electric | **Wine** Opener Electric |
| 0.86 | **Heat** Press Machine | **Leg** Press Machine |

Um limite ingênuo de 0.85 juntaria todos esses pares. Já "Câmera Canon EOS R6" e "Camera Canon EOS R6" são o mesmo produto. **A distância entre as letras não mede a distância entre os significados.**

## 3. Técnicas

### 3.1 Identificador global (GTIN/EAN, MPN)
É o padrão da indústria: dois itens com o mesmo código de barras são o mesmo produto.
- ✅ É determinístico, preciso e barato.
- ❌ Não existe nos dados. O `Id` do JSON é o identificador interno de cada seller.
- 💡 Evolução possível: exigir GTIN dos sellers resolve boa parte do problema na origem.

### 3.2 Normalização com chave canônica
Transforma o nome numa forma padrão (minúsculas, sem acentos, sem pontuação, espaços ajustados) e compara a igualdade exata.
- ✅ É simples, determinística e explicável. Nos dados, resolve 264 dos 269 itens só pelo nome.
- ❌ Não cobre tradução, sinônimos ("Notebook" e "Laptop") nem ordem de palavras.
- ⚠️ Normalizar demais também é perigoso. Remover números, por exemplo, transforma "S23" e "S24" na mesma coisa.

### 3.3 Similaridade de texto (fuzzy matching)

| Métrica | Bom para | Fraco para |
|---|---|---|
| Levenshtein / Damerau | erros de digitação | nomes longos e palavras trocadas de ordem |
| Jaro-Winkler | nomes curtos, prefixo em comum | descrições de produto |
| Token sort / token set ratio | ordem das palavras e palavras extras | dá nota alta para "Men" e "Women" |
| Jaccard de n-gramas | variações parciais | palavras curtas que mudam o sentido |
| TF-IDF + cosseno | dar peso às palavras raras e informativas | precisa de um corpus; tem pouco efeito com 975 itens |

- ✅ Pega variações de escrita sem treinamento, é barato e é determinístico.
- ❌ Não entende significado. O limite é arbitrário e precisa ser calibrado.
- 💡 Proteções que compensam a fraqueza:
  - Números e códigos de modelo devem ser idênticos.
  - As marcas devem ser compatíveis, se as duas existirem.
  - Os dois nomes devem ter as mesmas palavras de variante (men/women, shirt/shorts).

### 3.4 Dicionários e regras de domínio
Sinônimos e traduções, aliases de marca e mapa de categorias.
- ✅ É preciso, explicável e auditável. Resolve os casos que a normalização não pega.
- ❌ Precisa de manutenção manual e não generaliza.
- 💡 É a resposta honesta para um conjunto pequeno de dados. Embeddings ou LLM são a evolução natural.

### 3.5 Blocking (reduzir os pares a comparar)
Só compara itens da mesma marca, da mesma categoria ou que compartilham uma palavra. Em escala, usa *sorted neighborhood* ou MinHash/LSH.
- ✅ Torna o problema viável com milhões de itens.
- ❌ Se o campo usado para agrupar estiver errado, o match nunca é avaliado. Nos dados há `Brand` nula, Photo/Photography e produtos sem `Category`.
- 💡 Com 975 × 269 pares, a comparação completa é trivial. O blocking fica como evolução.

### 3.6 Agrupamento e transitividade
Se A≈B e B≈C, então A≈C? Um algoritmo union-find pode criar uma "cadeia" que junta coisas diferentes.
- Comparar contra o catálogo canônico evita quase todo o problema.
- **Existe um caso real:** dois sellers enviando, no mesmo arquivo, o mesmo produto que ainda não existe no catálogo. O segundo item precisa encontrar o produto criado pelo primeiro. Isso exige atualizar o índice a cada inserção, e o resultado passa a depender da ordem dos itens no arquivo.

### 3.7 Linkage probabilístico (Fellegi-Sunter)
Cada campo tem duas probabilidades: a chance de concordar quando é um match (m) e quando não é (u). Os pesos se somam num score. A biblioteca Splink implementa isso e ajusta os pesos sem rótulos, pelo algoritmo EM.
- ✅ É fundamentado, explicável e não exige dados rotulados.
- ❌ Funciona melhor com vários campos independentes. Aqui são só três, e dois deles são pouco confiáveis.

### 3.8 Embeddings semânticos com busca vetorial
Um modelo transforma cada nome num vetor, e buscam-se os vizinhos mais próximos (FAISS, sqlite-vec).
- ✅ Entende significado e tradução sem dicionário, generaliza e escala.
- ❌ Captura mal os números (S23/S24). Também traz dependência de um modelo, um limite arbitrário e pouca explicabilidade.
- 💡 Funciona bem como gerador de candidatos, deixando a decisão final para as regras.

### 3.9 Modelo supervisionado
Calcula atributos para cada par (fuzzy, embedding, marca igual, números iguais) e treina um classificador.
- ✅ Aprende os pesos ideais.
- ❌ Precisa de pares rotulados. Com tão pouco dado, o risco de *overfitting* é alto.

### 3.10 LLM como juiz
Para cada item da zona cinza, o modelo recebe os melhores candidatos e responde se algum é o mesmo produto, com justificativa e em formato estruturado.
- ✅ Lida com ambiguidade, tradução e conhecimento de mundo, e explica a decisão.
- ❌ Tem custo e latência, não é determinístico, pode alucinar e cria dependência de uma API externa. Dados maliciosos podem tentar manipular o modelo (*prompt injection*).
- 💡 É seguro se for usado só na zona cinza, com resposta estruturada, cache e uma alternativa determinística.

### 3.11 Revisão humana com limites
Decide por faixa de score:
- **score ≥ alto:** junta automaticamente;
- **baixo ≤ score < alto:** vai para revisão;
- **score < baixo:** cria um produto novo.
- 💡 Para o desafio, basta um relatório de casos ambíguos.

## 4. Como medir

1. Rotular o resultado esperado de cada um dos 269 itens: o `ProductId` existente ou "novo". O rótulo vira o teste de aceitação.
2. Medir precisão e recall, e mostrar o efeito de variar o limite.
3. Manter casos de regressão fixos: Men/Women, Shirt/Shorts, Câmera/Camera, IDs duplicados, SQL injection e `Brand` nula.

## 5. Abordagem recomendada

Uma cascata, do mais barato e confiável para o mais caro e flexível:

```
1. Validar entrada       → ID inválido, campos obrigatórios, duplicado (seller, id)
2. Normalizar            → chave canônica + dicionário de sinônimos/aliases
3. Match exato da chave  → resolve ~98% dos itens          [motivo: "exact"]
4. Fuzzy com proteções   → números iguais, marca compatível,
                           palavras de variante iguais     [motivo: "fuzzy:0.93"]
5. Zona cinza            → relatório para revisão; LLM opcional em modo plugin
6. Sem match             → cria produto e atualiza o índice em memória
```

Em cada ligação, gravar o motivo do match e o score em `SellerProduct`, para que cada decisão seja auditável.

**Como ficou na implementação** (planos 008 a 015): o passo 4 (fuzzy com proteções) **não liga ofertas**. Ele só marca para revisão um produto criado cujo nome é parecido com o de outro da mesma marca (plano 015). A ligação automática fica restrita ao nome normalizado (ou traduzido) com a marca normalizada. O motivo de cada item vai para o relatório da importação (plano 014), e não para `SellerProduct`.

**Por que essa abordagem:**
- O núcleo é determinístico e testável.
- Cada decisão é explicável.
- O ponto onde entra IA fica isolado.

O valor da solução está em tratar os ~2% difíceis sem criar falsos positivos.
