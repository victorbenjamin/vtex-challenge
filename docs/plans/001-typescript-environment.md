# 001: Ambiente TypeScript

**Status:** concluído (2026-10-25)

## Objetivo

Configurar o ambiente de desenvolvimento em TypeScript para o sistema de consolidação: execução, checagem de tipos, testes, formatação e acesso ao SQLite.

## Contexto

- Linguagem escolhida pelo usuário: TypeScript.
- O ambiente tem Node 22.23.2 e npm 10.9.8.
- Dados de entrada em `data/`. O `catalog.db` original não pode ser modificado (`CLAUDE.md`).
- O código será discutido e alterado ao vivo na entrevista, então o ferramental deve ser mínimo e conhecido.

## Decisões

| Tema | Escolha | Alternativas descartadas |
|---|---|---|
| Driver SQLite | `better-sqlite3` | `node:sqlite` é nativo e não precisa de dependência, mas ainda é **experimental** no Node 22 e emite um aviso a cada execução. `sqlite3` é assíncrono por callbacks, o que traz complexidade sem ganho. O `better-sqlite3` é síncrono, maduro, tem transações simples (`db.transaction`) e statements preparados, ou seja, queries parametrizadas por padrão. |
| Execução de TS | `tsx` | `ts-node` é mais lento e mais difícil de configurar com ESM. Compilar antes de cada execução é desnecessário. |
| Checagem de tipos | `typescript` 7 com `tsc --noEmit` e `strict` | O `tsx` não verifica tipos, então a checagem fica num script separado. |
| Testes | `vitest` | `node:test` não precisa de dependência, mas a API e o modo watch são mais pobres. O Jest exige configuração extra para ESM e TS. |
| Formatação | `prettier` | Sem ESLint por enquanto: o `strict` do TS cobre o essencial, e cada ferramenta a mais é algo a explicar. Pode entrar depois. |
| Módulos | ESM (`"type": "module"`, `module: nodenext`) | CommonJS é legado. |
| Versão do Node | `>=22`, fixada em `.nvmrc` | |

## Passos

- [x] `package.json` com os scripts `start`, `typecheck`, `test`, `test:watch`, `format` e `format:check`
- [x] Instalar as dependências
- [x] `tsconfig.json` estrito
- [x] `vitest.config.ts`, `.prettierrc` e `.nvmrc`
- [x] Estrutura `src/` e `tests/`
- [x] Teste de fumaça: abre o `catalog.db` somente para leitura e confirma 975 produtos
- [x] Validar: os scripts `typecheck`, `test` e `format:check` passam

## Desvios

Nenhum.
