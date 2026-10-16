# Gravity Code

Aplicativo independente para Windows x64: interface inspirada no Claude Desktop,
motor Claude Code oficial e Gemini (Web ou API) como provedor de inteligência.

**Prévia técnica.** Não é uma recompilação oficial do Claude Desktop. A análise
com REA orientou a reconstrução dos contratos; o código e os componentes
proprietários do Desktop não são redistribuídos.

## Novidades da versão (v0.3.0)

- **Nova Interface (Clone fiel da experiência Claude Desktop):**
  - Layout refinado com barra lateral retrátil animada (`Ctrl+N` para nova conversa).
  - Controle segmentado superior para alternar entre **Modo Chat** e **Modo Code**.
  - Estado vazio com saudação contextual ("Bom dia", "Boa tarde", "Boa noite") e sugestões rápidas em chips.
  - Composer elegante com ajuste automático de altura, seleção rápida de modelo e menu de anexos.
  - Mensagens limpas e legíveis: balões do usuário alinhados à direita e respostas diretas do assistente com blocos de código com botão de cópia.
  - Ferramentas compactas e recolhíveis com diffs visuais coloridos e status em tempo real.
- **Identidade Visual Antigravity:**
  - Paleta escura neutra e elegante com acentos em azul `#4f8bff` (e suporte automático a tema claro).
  - Ícone e marca Antigravity com gradiente de órbita e animação de processamento.
- **Correção Completa do Login Google:**
  - Eliminação de referências quebradas de elementos da interface que travavam o acionamento do login.
  - User-Agent higienizado na partição de autenticação, evitando o bloqueio "Este navegador ou app pode não ser seguro" do Google.
  - Suporte completo a redirecionamentos e domínios regionais do Google (`accounts.google.com.br`, etc.).
  - Validação silenciosa e restauração automática de sessão existente sem consumo de cota.
- **Controle de Cota e Recursos:**
  - Gerenciador de Skills integrado com busca e toggles por conversa.
  - Painel de status Git / GitHub em tempo real.
  - Medidor de cota diária e seleção de limites por turno.

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
