# AGENTS.md

Instruções para agentes de código (Codex, Claude Code, Copilot etc.) que
trabalham neste repositório.

## O que é este repositório

Todos os mods do JayV moram aqui, um por pasta: `mods/<id>/mod.json`. O app
(`JayV-Coder/jayv-coder`) e o site (`JayV-Coder/site`) baixam o `catalog.json`
deste repositório pela função `mods` do `JayV-Coder/supabase`, nunca direto
do GitHub. O app guarda o último catálogo que entendeu e funciona offline com
ele.

Um mod é um manifesto, não código: o núcleo do app é Rust compilado no
instalador e não executa nada baixado. Cada manifesto liga um motor que o app
já tem ou descreve um mod pronto que o app sabe rodar.

- `llm` — um motor de integração com LLM do app (`claude`, `codex`, …).
- `feature` — um recurso opcional do app (`stats`, `mcp`, …). A pessoa liga e
  desliga na aba Mods; o plano (`plan`) continua mandando: fora do plano, o
  recurso fica desligado mesmo com o mod ligado.
- `template` — um mod pronto que a pessoa instala como um mod seu: um programa
  de linha de comando ou uma API compatível com OpenAI ou Anthropic. Vira o
  agente `mod-<id>` no app.

Os motores que o app tem estão em `engines.json`. Motor novo só chega com uma
versão nova do app; o manifesto dele entra aqui com `minApp` dessa versão (o
app mais velho o ignora).

Tirar o manifesto de um motor desliga aquele motor para todo mundo. O
`catalog.mjs` só aceita isso com o id em `engines.json` › `withdrawn`.

## Regras

- O id é o nome da pasta. Mod `llm`/`feature` usa o id do motor; mod
  `template` usa letras minúsculas, dígitos e `-` (até 28).
- Título e resumo vêm nos dez idiomas do app (`en`, `pt-BR`, `es`, `zh-CN`,
  `hi`, `ar`, `fr`, `ru`, `ja`, `de`), sem espaço nas pontas. Nada de texto
  de um projeto específico: os exemplos usam nomes genéricos.
- Depois de mexer em qualquer manifesto, rode `node scripts/catalog.mjs build`
  e commite o `catalog.json` junto. O Actions roda `check` e recusa o PR com o
  catálogo fora de dia.
- `node --test scripts/catalog.test.mjs` antes de mudar o `catalog.mjs`.
- Identificadores em inglês; comentários podem ser em português.
- O formato do catálogo é o `SCHEMA` do `catalog.mjs`. Campo novo que o app
  antigo não conhece é ignorado por ele; mudar o sentido de um campo é
  `SCHEMA` novo, e o app e o site precisam aprender o formato antes.

## Mensagem de commit

Começa por um resumo curto e, no corpo, diz quais mods entraram, mudaram ou
saíram e por quê.
