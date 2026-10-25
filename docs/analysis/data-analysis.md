# Análise dos dados

Perfil do catálogo existente (`data/catalog.db`) e do arquivo a importar (`data/ProductEntry.json`), feito antes da implementação para fundamentar as decisões de matching e de schema. Os índices citados (`#n`) são posições, a partir de zero, no array do JSON.

## Resumo

- **Quase nada no arquivo é produto novo.** Dos 269 itens, 266 correspondem a produtos do catálogo depois de uma normalização simples. Outros 2 são traduções para o português de produtos existentes. O único item restante é um teste de SQL injection com ID inválido. **O desafio é de matching, não de cadastro.**
- **O ruído foi plantado e tem padrões claros:**
  - espaço duplo em 60 nomes;
  - acento ("Câmera");
  - tradução ("Roteador", "Processador");
  - aspas diferentes (`12.9''` e `12.9"`) ou ausentes (`55` e `55"`);
  - variação de marca ("Levi's" e "Levis") e de categoria ("Photo" e "Photography").
- **A semântica do ID é ambígua:** há IDs repetidos entre sellers, ID repetido no mesmo seller, IDs malformados e o mesmo produto enviado duas vezes pelo mesmo seller com IDs diferentes.
- **O schema não suporta os dados:**
  - `SellerProductId` é `INTEGER`, mas os IDs são UUIDs em texto.
  - Não há restrição de unicidade nem índice.
  - A chave estrangeira não é verificada.
- **O catálogo tem armadilhas para fuzzy matching:** há pares diferentes com similaridade acima de 0.85 (Men/Women, Shirt/Shorts). Um limite ingênuo causaria falsos positivos.

---

## 1. Banco de dados (`catalog.db`)

### 1.1 Schema

```sql
CREATE TABLE Product (
  Id       INTEGER PRIMARY KEY AUTOINCREMENT,
  Name     TEXT NOT NULL,
  Brand    TEXT,
  Category TEXT
);

CREATE TABLE SellerProduct (
  Id              INTEGER PRIMARY KEY AUTOINCREMENT,
  SellerName      TEXT NOT NULL,
  ProductId       INTEGER CONSTRAINT FK_Product_Id REFERENCES Product (Id) NOT NULL,
  SellerProductId INTEGER NOT NULL
);
```

| Aspecto | Situação | Implicação |
|---|---|---|
| Índices | Nenhum, além das chaves primárias | Busca por nome e verificação de link duplicado percorrem a tabela inteira. Irrelevante com 975 linhas, mas é algo a citar. |
| Unicidade | Nenhuma restrição em `Product.Name` nem em `SellerProduct` | O banco não impede produto duplicado nem link repetido. Reimportar o arquivo duplicaria tudo. |
| Chave estrangeira | Declarada, mas `PRAGMA foreign_keys = 0` | O SQLite não verifica a chave estrangeira por padrão. É preciso ativar em cada conexão. |
| `SellerProductId INTEGER` | Incompatível com os IDs do arquivo, que são UUIDs em texto | Por causa da afinidade de tipos do SQLite, o banco **aceitaria** o texto mesmo assim, mas o schema estaria mentindo sobre o dado. É preciso migrar para `TEXT`. |
| Entidade Seller | Não existe. O seller é só um texto em `SellerProduct`. | Grafias diferentes do mesmo seller viram sellers diferentes. No arquivo não há variações (20 nomes, todos consistentes). |
| Integridade | `PRAGMA integrity_check = ok`. `journal_mode = delete`. SQLite 3.45.1. | Sem corrupção. |

### 1.2 Tabela `Product` (975 linhas)

- **IDs:** de 1 a 975, sem buracos. `sqlite_sequence` está em 975.
- **`Name`:** nunca nulo nem vazio, sem espaços sobrando, só caracteres ASCII, 975 valores distintos. O tamanho vai de 9 a 36 caracteres, com mediana 21. 186 nomes contêm dígitos (modelos, tamanhos, quantidades).
- **Duplicatas:** **nenhuma**, mesmo depois de normalizar caixa, acentos e espaços, de remover todos os espaços ou de comparar como conjunto de palavras. O catálogo de partida é limpo.
- **`Brand`:** **119 nulos (12%)**, 640 valores distintos. Marcas mais comuns: OXO (12), AmazonBasics (9), Samsung (8).
- **`Category`:** **34 nulos**, 44 valores distintos. Os 34 produtos sem categoria também não têm marca, por exemplo `Crepe Maker`, `Electric Knife` e `Wine Opener Electric`.
- **Variações de marca dentro do próprio catálogo:**
  - `AmazonBasics` e `Amazon Basics`
  - `SimpleHouseware` e `Simple Houseware`
  - `simplehuman` e `Simplehuman`
  - `BLACK+DECKER` e `Black+Decker`

  Comparar marca por igualdade exata falharia até dentro do catálogo.
- **Categorias com sobreposição de significado:**
  - `Home` (5) e `Home Decor` (32)
  - `Computers` e `Components`
  - `Outdoor` e `Garden`

  51 marcas aparecem em mais de uma categoria. **A categoria é um sinal fraco de identidade do produto.**
- **Aspas como unidade de medida:** sete nomes usam `"` para polegadas, como `Monitor LG UltraWide 34"` e `Tablet iPad Pro 12.9"`. Também aparece `Violin 4/4 Full Size`.

### 1.3 Produtos diferentes com nomes parecidos

Comparação de todos os pares de produtos do catálogo com `difflib.SequenceMatcher`, depois de normalizar:

| Similaridade | Produto A | Produto B |
|---|---|---|
| 0.94 | #885 Multivitamin **Men** (Centrum) | #886 Multivitamin **Women** (One A Day) |
| 0.91 | #353 Compression **Shirt** (Nike) | #362 Compression **Shorts** (sem marca) |
| 0.90 | #272 Wireless Charger **Pad** (Anker) | #273 Wireless Charger **Stand** (Belkin) |
| 0.89 | #475 **Colander** Stainless Steel (OXO) | #485 **Ladle** Stainless Steel (OXO) |
| 0.87 | #86 **Can** Opener Electric | #98 **Wine** Opener Electric (sem marca) |
| 0.86 | #252 **Heat** Press Machine | #873 **Leg** Press Machine |
| 0.83 | #787 **Football** Official Size | #800 **Volleyball** Official Size |
| 0.83 | #762 Tennis Racket **Adult** | #764 Tennis Racket **Bag** (mesma marca, Wilson) |
| 0.81 | #569 **Wine** Glasses Set of 6 | #574 **Shot** Glasses Set of 6 |

Duas conclusões:
1. **Nenhum limite fixo de similaridade separa com segurança "mesmo produto" de "produto diferente".** As variações legítimas do arquivo chegam a 0.91 (Roteador e Router), e os falsos positivos do catálogo chegam a 0.94.
2. **A marca não resolve tudo:** "Tennis Racket Adult" e "Tennis Racket Bag" são da mesma marca e são produtos diferentes. Uma marca diferente, porém, é um bom sinal de que não é o mesmo produto, como em Men/Women e Pad/Stand.

---

## 2. Arquivo de entrada (`ProductEntry.json`)

### 2.1 Estrutura

- É um array de **269 objetos**, todos com os mesmos campos: `Id`, `SellerName`, `Name`, `Brand`, `Category`.
- Não há campos extras nem faltando. Os tipos são todos texto, exceto `Brand`, que tem 3 valores `null`.
- **Não há linhas repetidas por inteiro.**

| Campo | Distintos | Problemas |
|---|---|---|
| `Id` | 255 de 269 | 14 IDs repetidos e 3 malformados (seção 2.2) |
| `SellerName` | 20 | Nenhum. Grafias consistentes, sem espaços sobrando. |
| `Name` | 265 | **60 nomes com espaço duplo** e 1 com acento (`Câmera`) |
| `Brand` | 157 | 3 nulos. `Levi's` não existe no catálogo, que usa `Levis`. Há uma tentativa de SQL injection. |
| `Category` | 28 | `Photo` não existe no catálogo (que usa `Photography`) |

### 2.2 IDs (`Id`)

**Formato:**
- 3 IDs não seguem o formato de UUID:
  - `ddddeee-ffff-4000-1111-222233334444` (#92, Creatine Monohydrate): o primeiro bloco tem 7 caracteres em vez de 8.
  - `09835342345-4678-9abc-def012345678` (#180, Security Test Product): o primeiro bloco tem 11 caracteres.
  - `uddd0000-eeee-4111-ffff-aaaa22223333` (#268, Smart TV Samsung 55): contém `u`, que não é hexadecimal.
- **Cerca de 200 IDs têm o formato de UUID, mas não seriam UUIDs v4 válidos** (bits de variante errados), por exemplo `c3d4e5f6-a7b8-4c5d-0e1f-…`. São visivelmente IDs escritos à mão. **Validar como UUID v4 estrito rejeitaria a maior parte do arquivo.** A validação razoável é: texto não vazio, com tamanho e caracteres razoáveis. Ou, no máximo, "parece um UUID", que rejeita só os 3 malformados.

**Repetições:**

| Caso | Quantidade | Exemplo | Interpretação |
|---|---|---|---|
| Mesmo ID em **sellers diferentes**, com produtos diferentes | 13 IDs | `00112233-…-900112233445`: GardenStore/Curtain Rod e SportsHub/Bookshelf | O ID é do seller, não é global. **A chave natural é `(SellerName, Id)`.** |
| Mesmo ID **no mesmo seller** | 1 | `e5e5e5e5-…` (GardenStore): #55 "Câmera Canon EOS R6" e #76 "Camera Canon EOS R6" | Reenvio do mesmo SKU com o nome corrigido. Comportamento esperado: *upsert*, sem criar um segundo link. |
| ID que difere por um caractere | 1 | `e6e6e5e5-…` (#87, GardenStore, "Camera Canon EOS R6", categoria `Photo`) | Pode ser erro de digitação ou outro SKU. Formalmente é outro ID, e o produto é o mesmo. |
| IDs que diferem só no primeiro caractere | 3 | `dddd0000-…` (#266 Baseball Glove), `addd0000-…` (#267 iPad), `uddd0000-…` (#268 Smart TV) | Parecem IDs gerados de propósito para testar validação. Só o `u` é inválido. |

### 2.3 Mesmo seller enviando o mesmo produto com IDs diferentes

Além do caso da câmera, **10 sellers** enviam o mesmo produto duas vezes, com IDs diferentes e o nome variando só pelo espaço duplo. São os itens de #237 a #246 e de #257 a #266:

| Seller | Item A | Item B |
|---|---|---|
| OfficeSupply | #237 `Basketball Spalding Official` (`1111aaaa-…`) | #257 `Basketball Spalding  Official` (`aaaa1111-…`) |
| GardenStore | #238 `Basketball Hoop Portable` | #258 `Basketball Hoop  Portable` |
| CleaningWorld | #239 `Soccer Ball Size 5` | #259 `Soccer Ball  Size 5` |
| … | (mais 7 pares iguais) | |

**Ambiguidade:** um seller pode ter dois SKUs para o mesmo produto do catálogo?
- **Opção A:** um link por `(seller, SKU)`. Os dois SKUs apontam para o mesmo produto. Preserva a referência do seller.
- **Opção B:** um link por `(seller, produto)`. O segundo item é descartado como duplicado.

Na prática de marketplace, um seller pode ter vários SKUs, por exemplo em lotes ou condições diferentes. Mas aqui os dois itens são idênticos, então é provável que seja um cadastro duplicado. **A decisão precisa ser explícita no README.**

### 2.4 Campos nulos e suspeitos

- **`Brand = null`** aparece em 3 itens:
  - #45 Cable Organizer Kit
  - #116 Bed Frame Wood King
  - #133 Round Rug 6 Feet

  **Os três já existem no catálogo, também com `Brand` nula.** A comparação precisa tratar "nulo e nulo" como compatível, e não como diferente.
- **SQL injection**, item #180:
  ```json
  {"Id": "09835342345-4678-9abc-def012345678", "SellerName": "MegaStore",
   "Name": "Security Test Product", "Brand": "TestBrand'; SELECT 1; --", "Category": "Electronics"}
  ```
  O ataque está no campo `Brand`. O ID também é malformado. Com queries parametrizadas, o texto vira só um dado. É o único item do arquivo sem correspondente no catálogo, e com o ID inválido deve ser rejeitado e aparecer no relatório.
- **Nome do seller e categoria não têm relação:** FurnitureWorld vende fones de ouvido e KitchenPlus vende tablets. **O nome do seller não é um sinal útil para o matching.**

### 2.5 Ordem dos itens

O arquivo parece montado em blocos:
- **#0 a #29:** itens "limpos".
- **Do #30 em diante:** reenvios por outros sellers com espaço duplo, intercalados com itens novos.
- **#227 a #266:** blocos de esportes e jardim, em pares.
- **#267 e #268:** casos finais de borda.

**A ordem importa:** a câmera chega primeiro com acento (#55) e depois sem (#76) com o mesmo ID. O resultado precisa ser o mesmo qualquer que seja a ordem de processamento. Esse é um bom teste.

---

## 3. Arquivo comparado com o catálogo

### 3.1 Classificação de cada item

| Classe | Itens | O que precisa para casar |
|---|---|---|
| Igual em nome, marca e categoria | **200** | Igualdade exata |
| Nome igual depois de normalizar, mesma marca e categoria | **64** | Juntar espaços (60), remover acento (1), aspas `''` contra `"` (1), aspas ausentes (2: `12.9`, `55`) |
| Nome igual, mas marca ou categoria diferente | **2** | `Levi's` contra `Levis` (#322), `Photo` contra `Photography` (#18) |
| Tradução para o português | **2** | `Roteador WiFi 6 TP-Link` → #21 Router (similaridade 0.91). `Processador AMD Ryzen 9 7950X` → #28 Processor (0.96). |
| Sem correspondente | **1** | `Security Test Product` (o teste de SQL injection) |

**Total: 268 de 269 itens correspondem a produtos existentes.** Nenhum item legítimo cria produto novo.

Detalhes que a normalização precisa respeitar:
- **Aspas de polegada:** `12.9''` (duas aspas simples), `12.9"` e `12.9` precisam ficar iguais, e **o número precisa ser preservado**. Remover a pontuação sem cuidado transforma `12.9` em `12 9`. Isso não causa erro aqui, mas nomes de produto costumam se diferenciar justamente pelos números (`S23` e `S24`, `55"` e `65"`).
- **Transliteração de acentos:** com a normalização Unicode NFKD seguida da remoção dos acentos, `Câmera` vira `camera`.
- **Tradução:** a normalização não resolve. Exige dicionário, embeddings ou LLM. O fuzzy com proteções também resolveria, porque o número do modelo (`7950X`, `6`) e a marca batem, e a similaridade é alta.

### 3.2 Quantos sellers por produto

Depois do matching:
- **198 produtos distintos** do catálogo recebem pelo menos uma oferta.
- 144 produtos têm 1 seller, 52 têm 2 sellers e 2 têm 3 sellers. Os de 3 sellers são #14 (iPad Pro 12.9") e #10 (Smart TV Samsung 55"), justamente os que chegam com variações de aspas.
- **777 produtos do catálogo não recebem nenhum seller.**
  - **Ambiguidade:** esses produtos pertencem à própria loja, que passa a ser um seller do marketplace? O enunciado diz que "a empresa tem um catálogo com tudo que vende".
  - **Opção:** ligar o catálogo existente a um seller próprio. Seria uma migração de dados. Não é necessário para o desafio, mas vale citar.
  - **Decidido (2026-10-25):** o marketplace é um seller (`Marketplace`) e oferta todos os produtos existentes, através da migração 002 ([plano 003](../plans/003-marketplace-seller.md)). Com isso, nenhum produto fica sem seller.

### 3.3 Divergências de atributos e enriquecimento

- 64 dos itens casados têm marca e categoria idênticas às do catálogo. Só 2 divergem: `Levi's` e `Photo`.
- **Nenhum item do arquivo preenche um campo nulo do catálogo.** Os 3 produtos casados que têm nulo no catálogo também chegam com nulo no arquivo.
- **Decisão: o catálogo é a fonte de verdade.** O registro canônico não é sobrescrito com dados do seller, e a forma original pode ficar guardada no link.
- **Evolução possível:** enriquecer o catálogo quando o seller trouxer um campo que o catálogo não tem.

---

## 4. Implicações para a solução

| # | Achado | Decisão sugerida |
|---|---|---|
| 1 | IDs são texto e só são únicos por seller | Migrar `SellerProductId` para `TEXT` e criar `UNIQUE (SellerName, SellerProductId)` |
| 2 | Reenvio do mesmo `(seller, id)` | Upsert idempotente: rodar duas vezes não muda nada |
| 3 | Mesmo seller, mesmo produto, IDs diferentes (10 casos) | Decidir entre a opção A e a opção B (seção 2.3) e documentar |
| 4 | 3 IDs malformados, cerca de 200 UUIDs fora do padrão v4 | **Decidido (2026-10-25): aceitar qualquer texto não vazio.** O ID pertence ao seller e o marketplace não impõe formato. Custo aceito: um ID digitado errado pode gerar uma oferta duplicada quando o seller reenviar com o código correto. |
| 5 | SQL injection | Queries parametrizadas e teste dedicado |
| 6 | Espaços, acentos, aspas e números | Chave normalizada que preserva números e pontos decimais |
| 7 | Traduções | Dicionário de sinônimos, ou fuzzy com proteções (número do modelo e marca iguais), com LLM ou embeddings como evolução |
| 8 | Falsos positivos no catálogo (Men/Women…) | Não usar um limite fixo sozinho. Exigir que números e palavras de variante sejam iguais e que as marcas sejam compatíveis. |
| 9 | Variações de marca, inclusive dentro do catálogo | Comparar marca normalizada (sem espaços, pontuação e caixa), com nulo compatível com nulo |
| 10 | Categoria pouco confiável | Usar como desempate, nunca como bloqueio |
| 11 | Chave estrangeira não verificada | `PRAGMA foreign_keys = ON` em cada conexão |
| 12 | Sem índices | **Revisto (plano 006):** consulta indexada por item (migração 003, `(Name, Brand, Category)`), porque o desenho precisa se sustentar com volume. A sugestão original era um índice em memória, por o catálogo ser pequeno. |
| 13 | Nenhum produto legítimo novo no arquivo | Criar dados de teste próprios para o caminho "produto novo", incluindo dois sellers enviando o mesmo produto novo no mesmo arquivo |
| 14 | 777 produtos sem seller | **Decidido:** seller `Marketplace` com uma oferta para cada produto existente (migração 002) |

## 5. Resultado esperado como teste de aceitação

A classificação da seção 3.1 serve de gabarito. Com as decisões tomadas (uma oferta por SKU do seller e qualquer ID não vazio aceito), uma execução correta sobre o arquivo deve resultar em:
- **1 produto novo:** o `Security Test Product` (#180), com a marca gravada literalmente como texto.
- **0 itens rejeitados.**
- **268 ofertas novas** em `SellerProduct`: 269 itens, menos o reenvio da câmera com o mesmo `(seller, id)` (#55 e #76), que resulta numa só oferta.
  - Somadas às 975 ofertas do seller `Marketplace` (migração 002), são **1.243 ofertas** no total.
  - O `Security Test Product`, criado pela importação, não ganha oferta do `Marketplace`.
- **Nenhum link para um produto errado,** verificado contra a tabela da seção 3.1.
