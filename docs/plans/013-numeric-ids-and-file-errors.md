# 013: IDs numéricos e erros de arquivo amigáveis

**Status:** concluído (2026-10-26)

## Objetivo

Preparar a importação para arquivos diferentes do desafio, que podem ser usados na entrevista ao vivo:
1. **Aceitar `Id` numérico.** Hoje `{"Id": 123, ...}` é **rejeitado**, porque a validação exige texto. O schema original tinha `SellerProductId INTEGER`, então um arquivo de teste com IDs inteiros é plausível, e **todos os itens seriam rejeitados**.
2. **Mostrar um erro de uma linha para um arquivo inválido.** Hoje um JSON malformado derruba o CLI com o erro bruto do Node.

## Contexto

Teste feito numa cópia descartável (2026-10-26):

| Entrada | Hoje |
|---|---|
| `"Id": 123` | `rejected` |
| arquivo com `{oops` | erro de sintaxe do Node, com o trecho do arquivo e sem contexto |

A decisão do changelog (entrada 16) é que o ID do seller pode ter **qualquer formato não vazio**. Um número é um formato válido. Rejeitá-lo contradiz essa decisão.

## Decisões

1. **`SellerProductEntry.parse`** (`src/domain/seller-product-entry.ts) aceita `Id` como:
   - texto não vazio (como hoje);
   - ou **inteiro seguro** (`Number.isSafeInteger`), convertido para texto (`123` → `"123"`).

   **Continuam rejeitados:** números não inteiros (`1.5`), `NaN`, `Infinity`, booleanos, objetos. Um ID decimal é mais provavelmente um dado corrompido do que um código.
   - **Consequência:** `123` e `"123"` são o **mesmo** SKU para o mesmo seller. Um reenvio com o outro tipo dá `alreadyLinked`. É o comportamento certo, porque a coluna é `TEXT`.
2. **`readImportFile`** (`src/infrastructure/import-file.ts`) lança um `Error` com uma mensagem clara, que cita o caminho do arquivo, para cada caso:
   - arquivo inexistente;
   - JSON malformado (com a mensagem do parser);
   - JSON que não é um array (como hoje).
3. **O CLI de importação** (`src/cli/import.ts`) captura o erro de leitura, mostra só a mensagem e sai com código 1. Nada é gravado, porque a leitura acontece antes de qualquer transação.

## Gabarito

Inalterado: 267 ligados, 1 já ligado, 1 criado. O arquivo do desafio só tem IDs em texto.

## Passos

- [x] `SellerProductEntry.parse` aceita inteiro seguro; testes: `123` aceito e convertido, `1.5`/`true`/`NaN` rejeitados, `123` e `"123"` como o mesmo SKU (`alreadyLinked`)
- [x] `readImportFile` com mensagens claras; testes: arquivo inexistente, JSON malformado, não array
- [x] CLI captura o erro e sai com código 1; verificado manualmente com um arquivo malformado
- [x] Atualizar o `import-decision-flow.md` (a regra de validação), o `README.md` e o changelog
- [x] Rodar `typecheck`, `test`, `format:check`, `db:reset` e `import`

## Desvios

- **Testes de `readImportFile` num arquivo próprio** (`tests/infrastructure/import-file.test.ts`), com arquivos temporários reais.
- **Também são rejeitados** inteiros fora do intervalo seguro (`2 ** 53`), objetos e `Infinity`.

## Resultado

- **210 testes passam,** contra o SQLite real e sem mocks.
- **Pelo CLI:**
  - `{"Id": 123, ...}` é ligado, e não rejeitado;
  - arquivo malformado, inexistente ou que não é array: uma linha de erro com o caminho, código 1, e nada é gravado.
- **A importação do arquivo do desafio não mudou:** 267 ligados, 1 já ligado, 1 criado.
- O banco original continua intacto.
