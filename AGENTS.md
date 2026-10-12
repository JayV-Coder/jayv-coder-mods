# AGENTS.md

Instruções para agentes de código (Codex, Claude Code, Copilot etc.) que
trabalham neste repositório.

## O que é este repositório

Todos os mods do JayV moram aqui, um por pasta: `mods/<id>/mod.json`. O app
(`JayV-Coder/jayv-coder`) e o site (`JayV-Coder/site`) baixam o catálogo deste
repositório pela função `mods` do `JayV-Coder/supabase`, nunca direto do
GitHub. O app guarda o último catálogo que entendeu e funciona offline com ele.

## Mod é do sistema, não de um assunto

Um mod funciona como mod de jogo: um pacote com nome, versão, autor e o que ele
acrescenta ao app. Quem usa instala, liga, desliga e desinstala cada um na aba
Mods (ou no site, em Painel › Mods), por ambiente. Nada nele é preso a LLM: o
mod diz, em `contributes`, o que traz para cada **ponto de extensão** do app, e
um mod pode trazer vários pontos de uma vez.

| ponto | o que traz |
| --- | --- |
| `llmEngines` | motores de integração com LLM do app (`claude`, `codex`, …) |
| `features` | recursos opcionais do app (`stats`, `mcp`, …); o plano continua mandando |
| `agents` | agentes de linha de comando ou de API, instalados como agentes de quem instala (`mod-<id>`, `mod-<id>-2`…) |

O núcleo do app é Rust compilado no instalador e não executa nada baixado: um
ponto de extensão é o app sabendo aplicar um tipo de contribuição. Ponto novo
(servidores MCP, skills, comandos, temas…) chega assim:

1. o app aprende a aplicá-lo (um ponto em `jayv-mods`, ligado no registro do
   núcleo, e a tela);
2. ele entra em `POINTS` do `scripts/catalog.mjs`, com `since` na versão do
   app que o aplica, e no `schema/mod.schema.json`;
3. o app antigo ignora o mod que usa um ponto que ele não conhece.

Os motores que o app tem estão em `engines.json`. Motor novo só chega com uma
versão nova do app; o mod dele entra aqui com `minApp` dessa versão (o app mais
velho o ignora). Tirar o último mod que traz um motor desliga aquele motor para
todo mundo: o `catalog.mjs` só aceita isso com o id em `engines.json` ›
`withdrawn`.

## Campos que mudam o comportamento

- `preinstalled`: o mod se instala, ligado, no login de quem ainda não o tem.
  Quem o desinstalou não o recebe de volta.
- `requires`: os mods de que ele precisa instalados e ligados. Instalar puxa
  as dependências; um mod que se instala sozinho só pede mods que também se
  instalam sozinhos; ciclo é erro.
- `version`: a versão do próprio mod, mostrada na aba Mods.
- `plan`: o recurso do plano que o mod pede; fora do plano ele aparece
  travado.

## Os dois catálogos

`node scripts/catalog.mjs build` grava:

- `catalog.v2.json` — o formato genérico (`SCHEMA` 2), que o app 0.95+ e o
  site 2.13+ leem;
- `catalog.json` — o formato antigo (`SCHEMA` 1), tirado do v2, para o app
  0.94 e o site 2.12. Só entra nele o mod que traz um ponto só, sem
  dependências, e cujo nome é o do motor que ele traz (ou um agente só). Todo
  motor precisa de um mod ali, senão o app antigo o desliga — o build recusa.

## Regras

- O id é o nome da pasta. Mod com o nome de um motor traz aquele motor; mod com
  `agents` usa letras minúsculas, dígitos e `-` (até 28).
- Título e resumo vêm nos dez idiomas do app (`en`, `pt-BR`, `es`, `zh-CN`,
  `hi`, `ar`, `fr`, `ru`, `ja`, `de`), sem espaço nas pontas. Nada de texto
  de um projeto específico: os exemplos usam nomes genéricos.
- Depois de mexer em qualquer manifesto, rode `node scripts/catalog.mjs build`
  e commite os dois catálogos juntos. O Actions roda `check` e recusa o PR com
  um catálogo fora de dia.
- `node --test scripts/catalog.test.mjs` antes de mudar o `catalog.mjs`.
- Identificadores em inglês; comentários podem ser em português.
- O formato do catálogo é o `SCHEMA` do `catalog.mjs`. Campo novo que o app
  antigo não conhece é ignorado por ele; mudar o sentido de um campo é
  `SCHEMA` novo, e o app e o site precisam aprender o formato antes.

## Mensagem de commit

Começa por um resumo curto e, no corpo, diz quais mods entraram, mudaram ou
saíram e por quê.
