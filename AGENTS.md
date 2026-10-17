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
| `agents` | agentes de linha de comando, ACP ou de API, instalados como agentes de quem instala (`mod-<id>`, `mod-<id>-2`…) |
| `skills` | skills que o Jev escolhe pelo pedido (como as que a pessoa instala), com os servidores MCP de cada uma; os servidores só vão ao agente no pedido em que a skill vale (app 0.103+) |

O núcleo do app é Rust compilado no instalador e não executa nada baixado: um
ponto de extensão é o app sabendo aplicar um tipo de contribuição. Ponto novo
(comandos, temas…) chega assim:

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
  Quem o desinstalou não o recebe de volta. Regra do dono: só os essenciais
  vêm instalados; motores de LLM, agentes e skills esperam quem quiser
  instalar (um teste do validador confere que nenhum outro é `preinstalled`).
- `icon`: o ícone do mod, um `.svg` da pasta dele (obrigatório). O build põe o
  desenho no catálogo; o app e o site o mostram como imagem. Só o desenho:
  nada de script, estilo, evento ou endereço de fora (imagem embutida, só em
  `data:` PNG, JPEG ou WebP), até 16 kB e com `viewBox`. Ícone monocromático
  usa `currentColor` e segue a cor do texto e o tema; o colorido fica com as
  cores dele. Os créditos dos desenhos de terceiros ficam em `mods/ICONS.md`.
- `required`: essencial — o app precisa dele. Fica sempre instalado e ligado;
  ninguém o desliga nem o desinstala, no app ou no site (o plano continua
  mandando no recurso que ele traz). Pede `preinstalled`, e só depende de
  outros essenciais. Regra do dono: os recursos do app são essenciais; os
  motores de LLM e os agentes (Ollama, LM Studio) se desligam e desinstalam.
- `requires`: os mods de que ele precisa instalados e ligados. Instalar puxa
  as dependências; um mod que se instala sozinho só pede mods que também se
  instalam sozinhos; ciclo é erro.
- `version`: a versão do próprio mod, mostrada na aba Mods.
- `plan`: o recurso do plano que o mod pede; fora do plano ele aparece
  travado.

## Skills

Uma skill de mod tem `name` (letras, dígitos, `-` e `_`), `description` (em
inglês, até 400 caracteres: é o que o Jev lê para decidir se o pedido é dela),
as instruções (em inglês, para o modelo) em `instructions` ou num `.md` da
pasta do mod (`file`, que o build põe no catálogo como texto) e, se precisar,
até quatro `mcpServers` (`stdio` com `command` sem argumentos e `args`, ou
`http` com `url`). Dois mods não trazem a mesma skill. Um servidor que baixa e
roda um programa de terceiros fixa a versão exata (`pacote@1.2.3`), e o mod não
é `required`: quem usa pode desligá-lo e desinstalá-lo.

## A página de cada mod no site

Todo mod tem uma página no site (`/mods/<id>`), com busca e categorias em
`/mods`. O conteúdo mora com o mod:

- `mods/<id>/page.json` (`schema/page.schema.json`): `about` (o que o mod faz),
  `requirements` (o que mais precisa para funcionar, opcional), `setup` (os
  passos depois de instalar, até seis) e `use` (como usar, de um a seis
  passos), todos nos dez idiomas. Os passos de instalar e ligar o site escreve
  igual para todo mod.
- `mods/<id>/media/<print>.<idioma>.webp`: os prints. Um passo cita o print por
  `image` (o nome, sem idioma); o inglês é obrigatório e o idioma sem print
  mostra o inglês. O print `enable` é a aba Mods com o mod e acompanha os
  passos de instalar. Até 600 kB cada; print que nenhum passo cita é erro.

Os prints saem da tela de verdade do app, com dados de exemplo, pelo estúdio de
`JayV-Coder/jayv-coder` (`tools/mod-shots`): `node tools/mod-shots/shoot.mjs
--only <id>` grava os dez idiomas na pasta do mod. Mod novo ganha uma cena lá
quando precisa de um print além do `enable`.

## Os catálogos e as páginas

`node scripts/catalog.mjs build` grava:

- `catalog.v2.json` — o formato genérico (`SCHEMA` 2), que o app 0.95+ e o
  site 2.13+ leem;
- `catalog.json` — o formato antigo (`SCHEMA` 1), tirado do v2, para o app
  0.94 e o site 2.12. Só entra nele o mod que traz um ponto só, sem
  dependências, e cujo nome é o do motor que ele traz (ou um agente só). Todo
  motor precisa de um mod ali, senão o app antigo o desliga — o build recusa.
- `pages.json` — a página de cada mod (`PAGES_SCHEMA` 1), com os prints de
  cada passo, os idiomas que cada um tem e uma marca do conteúdo (`v`), para o
  cache de quem vê trocar junto com o print. O build recusa mod sem página.

## Regras

- O id é o nome da pasta. Mod com o nome de um motor traz aquele motor; mod com
  `agents` usa letras minúsculas, dígitos e `-` (até 28).
- Agente de `agents`: `cli` (programa com `args`/`planArgs`), `acp` (o app
  conversa pelo Agent Client Protocol; `args` só aceita `{model}`, e `env`,
  `buildMode`, `planMode` dizem como ele abre) ou `api` (`openai`,
  `anthropic`, `responses` com `modelField`, `manus`). ACP, `responses`,
  `manus`, `modelField` e `{prompt_file}` só o app 0.107 lê
  (`AGENTS_V2_SINCE`): o `catalog.mjs` pede `minApp` dessa versão e deixa o
  mod fora do `catalog.json`. Agente ACP vem com o modelo `default` (o que o
  agente escolher); quem usa carrega os outros do próprio agente.
- Título e resumo vêm nos dez idiomas do app (`en`, `pt-BR`, `es`, `zh-CN`,
  `hi`, `ar`, `fr`, `ru`, `ja`, `de`), sem espaço nas pontas. Nada de texto
  de um projeto específico: os exemplos usam nomes genéricos.
- Depois de mexer em qualquer manifesto, página ou print, rode
  `node scripts/catalog.mjs build` e commite os catálogos e o `pages.json`
  juntos. O Actions roda `check` e recusa o PR com
  um catálogo fora de dia.
- `node --test scripts/catalog.test.mjs` antes de mudar o `catalog.mjs`.
- Identificadores em inglês; comentários podem ser em português.
- O formato do catálogo é o `SCHEMA` do `catalog.mjs`. Campo novo que o app
  antigo não conhece é ignorado por ele; mudar o sentido de um campo é
  `SCHEMA` novo, e o app e o site precisam aprender o formato antes.

## Mensagem de commit

Começa por um resumo curto e, no corpo, diz quais mods entraram, mudaram ou
saíram e por quê.
