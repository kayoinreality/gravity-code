# Análise do Claude Desktop com REA

Data: 2026-10-15. Ferramenta: [REA](https://github.com/morluto/rea), CLI
`rea-agents@6.5.0`, analisador JavaScript versão 1. Análise estática, sem executar
o código dos bundles, ler credenciais ou chamar modelos.

## Proveniência e escopo

- Artefato local: Claude Desktop 1.52386.6, `resources/app.asar`, 37.920.543 bytes.
- SHA-256: `5c9eb5326126ad3640403db8d729df8c917b487b5677dc129a61fc32fe8a5a61`.
- Evidence ID retornado pelo REA:
  `ev_d3f3c1e69742b53ff63e8391c87df31a2f34e8db74ce6f9991bd3696979e2a77`.
- Seleção explícita: `package.json`, `.vite/build/index.pre.js`,
  `.vite/build/index.chunk-Bd58w5mH.js`, `.vite/build/mainView.js`,
  `.vite/build/mainWindow.js`.
- Quatro arquivos JavaScript analisados, 7.712.528 bytes de texto, nenhuma
  falha de parsing. Outros 245 arquivos ficaram fora da seleção.

O resultado bruto fica somente no laboratório local. Ele contém código e
caminhos da máquina; não faz parte deste repositório ou da release.

## Observações

| Observação estática | Evidência | Consequência para a reconstrução |
| --- | --- | --- |
| O Desktop separa renderizador, bridge e controlador de sessões locais. | REA identificou 25 APIs de context bridge e 1.182 operações IPC na seleção; 1.172 usam canais dinâmicos. | Criar uma bridge pequena e explícita, com validação do remetente. Não copiar uma API interna dinâmica inteira. |
| Há configuração de gateway e modelos de inferência. | `inferenceGatewayBaseUrl` no `index.pre.js`, offsets UTF-16 501158 e 707617. | Separar a escolha de modelo da interface e do motor nativo. A presença da configuração não comprova suporte oficial ao Gemini. |
| Existem políticas e seleção de ferramentas por sessão. | `builtinToolPolicy` e `enabledMcpTools` no bundle principal; offsets UTF-16 677482 e 1092610. | Disponibilizar apenas ferramentas necessárias; evitar serializar todos os MCPs do Desktop. |
| A função de checagem de provedor monta uma requisição de mensagem com `max_tokens: 1`. | Inspeção estática complementar da função `FIt`, offset UTF-16 2423259 do bundle principal; corpo observado a partir de 2423515. | Um adaptador web que não imponha esse limite pode transformar a checagem em geração completa. A nova checagem usa somente bootstrap e catálogo. |

Hashes dos bundles usados para localizar essas observações:

- `index.pre.js`: `aeefd748e5d1057ea9eb63f251dfb9d49e063e9cefb407c6cbbd7216173c79ce`.
- `index.chunk-Bd58w5mH.js`: `9b0195b8bbba18045c7b0aa1d1f18d8ea8bf831cee67358dcfb787f4730ab42d`.

## Limites das conclusões

O REA parou inicialmente por divergências entre metadados de integridade e os
bytes observados de auxiliares nativos. Uma segunda execução usou explicitamente
`--integrity-policy record-and-continue`; os auxiliares permaneceram marcados
como não confiáveis. Isso não demonstra adulteração nem valida sua integridade.
Eles não foram decompilados, executados ou usados na nova aplicação.

Limites de orçamento do grafo reduziram a cobertura semântica de `mainView.js`
e `mainWindow.js`. Canais IPC dinâmicos não foram pareados por semelhança de
texto. Os números acima descrevem sintaxe encontrada, não fluxos comprovados
em execução nem uma auditoria completa de segurança.

Esta análise recuperou contratos e pontos de integração do JavaScript
distribuído. Não recuperou o projeto original completo e não produziu uma
recompilação equivalente do Claude Desktop. Gravity Code implementa uma
interface própria e controla o executável Claude Code separado.
