# Gravity Code

Aplicativo independente para Windows x64: interface inspirada no Claude Desktop,
motor Claude Code oficial e Gemini (Web ou API) como provedor de inteligência.

**Prévia técnica.** Não é uma recompilação oficial do Claude Desktop. A análise
com REA orientou a reconstrução dos contratos; o código e os componentes
proprietários do Desktop não são redistribuídos.

## Novidades da versão

- **Modos Chat e Code (estilo Claude Desktop):** alterne instantaneamente entre modo de
  conversa normal (respostas diretas, sem execução local de ferramentas, 1 prompt por mensagem)
  e modo Code (harness completo do Claude Code com leitura, escrita, terminal e diffs).
- **Redução drástica de consumo de cota:**
  - **Continuidade de conversa (Delta prompts):** etapas de ferramentas reusam a sessão
    anterior no Gemini e enviam apenas o que mudou, evitando reenviar 50k+ tokens repetidos.
  - **Prompt e esquemas compactados:** instruções enxutas mantendo apenas o essencial.
  - **Parser tolerante:** respostas em prosa não causam erro de formato nem gastam nova tentativa.
  - **Subagentes controlados:** ferramenta `Agent` desativada por padrão para evitar delegações automáticas que multiplicam o consumo.
- **Suporte à API oficial do Google AI Studio (Gemini API):** além da sessão web da conta Google,
  você pode configurar sua chave da API (`AIza...`) para function calling nativo e streaming.
- **Gerenciador de Skills:** detecta skills em `~/.claude/skills`, `~/.gemini/config/skills` e no
  projeto. Ative e desative quais skills injetar no contexto por conversa.
- **Integração com Git e GitHub:** exibe a branch ativa, quantidade de arquivos pendentes e
  status de autenticação do GitHub CLI (`gh`).
- **Medidor diário de cota:** acompanhe solicitações e estimativa de tokens acumulados no dia.
- **Visualização de Diffs:** veja com clareza as alterações de arquivos (`Edit` e `Write`)
  com opção de "Sempre permitir nesta conversa".

## Usar no Windows

1. Baixe o ZIP na página [Releases](https://github.com/kayoinreality/gravity-code/releases).
2. Extraia a pasta inteira e abra `GravityCode.exe`.
3. Escolha seu método de conexão:
   - **Conta Google:** clique em **Conta Google ↗** e faça login na janela do aplicativo.
   - **Gemini API:** abra **Ajustes ⚙**, selecione *Google AI Studio (API Key)* e cole sua chave.
4. Para codificar no seu projeto, clique em **Preparar motor** (baixa o Claude Code 2.1.270 oficial
   da Anthropic com hashes certificados) e selecione a pasta.
5. Para tirar dúvidas ou conversar sem mexer em arquivos, basta alternar para **Chat**.

![Interface do Gravity Code](docs/assets/interface.png)

## Modos de Operação

| Recurso | Modo Chat 💬 | Modo Code ⌨ |
| :--- | :--- | :--- |
| **Objetivo** | Dúvidas, explicações, revisões | Criar, editar, rodar comandos e testes |
| **Pasta de projeto** | Opcional / Não necessária | Obrigatória |
| **Motor local** | Não exige o motor Claude Code | Exige o motor Claude Code |
| **Consumo de cota** | **Mínimo:** 1 solicitação por envio | Compartilha orçamento configurado (padrão: 8) |
| **Execução de Bash/Ferramentas** | Desativada | Ativa com aprovação e diffs |
| **Skills** | Injetáveis via seletor | Injetáveis via seletor |

## Permissões e Segurança

- Alterações em arquivos e comandos no terminal exibem um diálogo de permissão com diffs.
- Você pode optar por permitir uma vez, negar ou escolher "Sempre permitir esta ferramenta nesta conversa".
- A sessão Google fica em perfil Electron isolado (`%LOCALAPPDATA%\GravityCodeStandalone\Partitions\gravity-google`).
- Chaves de API e configurações são armazenadas localmente no perfil do usuário.

## Desenvolver e Compilar

Node.js 24 ou superior e Windows x64 para o empacotamento:

```text
npm ci
npm test
npm run verify:public
npm run smoke:windows
npm run build:windows
```

A licença MIT cobre o código original deste repositório. Consulte
[componentes e termos separados](THIRD_PARTY_NOTICES.md).
