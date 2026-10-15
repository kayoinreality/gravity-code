# Validação da prévia 0.1.0

## Comprovado sem geração Google

- Testes automatizados do protocolo: rejeição de JSON inválido, ferramenta
  desconhecida e anexos não suportados; sequência de eventos Anthropic;
  estimativa que inclui instruções, esquemas e histórico.
- Descoberta autenticada simulada faz somente bootstrap e catálogo. Nenhuma
  chamada ao endpoint de geração é necessária para a checagem.
- Testes do controlador verificam inicialização antes do envio, permissões
  por stdio e recusa explícita; argumentos mantêm modo manual, modo restrito
  e exclusão de configurações MCP externas.
- Motor Windows real 2.1.270 executado contra transporte simulado, com rede
  bloqueada: resposta de texto e ciclo de escrita. O motor emitiu uma solicitação
  de permissão; o arquivo foi criado somente depois da aprovação do host.
- A lista efetivamente enviada pelo motor nesse teste foi `Agent`, `Bash`,
  `Edit`, `Glob`, `Grep`, `Read`, `Write`.
- Delegação real no motor simulado: processo principal com modelo Argon,
  ferramenta `Agent` com `model: haiku` e solicitação do agente em Flash. O
  controlador aguarda os agentes ativos e o retorno final da sessão.
- Caminho do preload contendo espaço verificado com o executável nativo.
- Retomada de conversa em um segundo processo do motor verificada com o mesmo
  identificador e perfil isolado.
- Download real do servidor oficial validado contra os hashes do arquivo
  comprimido e do executável, em uma pasta nova, sem depender de cache local.
- Aplicativo Windows empacotado: perfil temporário separado, preload com bridge
  isolada, interface renderizada e nenhuma geração. A janela interativa também
  foi conferida no desktop após corrigir o redesenho da primeira abertura.
- Verificação de publicação exclui executáveis de terceiros, bundles extraídos,
  perfis, cookies, chaves, logs e caminhos pessoais do código público.

## Limites

O adaptador de sessão e geração Gemini foi testado ao vivo no protótipo privado
anterior. Esse resultado não comprova o funcionamento completo desta nova
montagem independente. O login e uma tarefa real nesta interface precisam ser
confirmados quando a cota da conta permitir.

Não foram medidas as porcentagens de uso ou tokens faturados pelo Google.
As respostas simuladas validam o controlador e as permissões, não a qualidade
de planejamento do Gemini ou a estabilidade futura do protocolo web.
