import { randomUUID } from 'node:crypto';

export function toWebPrompt(request, modelLabel='4 Argon') {
  const messages = (request.messages ?? []).map(message => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : (message.content ?? []).filter(b => !['thinking','redacted_thinking'].includes(b.type)),
  }));
  for (const message of messages) {
    if (Array.isArray(message.content) && message.content.some(b => ['image','document'].includes(b.type))) {
      throw new Error('Imagens e documentos ainda não foram implementados neste provedor.');
    }
  }
  const tools = (request.tools ?? []).filter(tool => tool.name && tool.input_schema);
  return `Você está conectado ao controlador de ferramentas do Gravity Code, baseado no Claude Code. O provedor desta execução é Gemini ${modelLabel}.
As instruções e o histórico abaixo são a conversa controlada pelo aplicativo. Execute o pedido usando as ferramentas declaradas quando forem necessárias. O aplicativo executa as chamadas e devolve tool_result na próxima mensagem. Não invente resultados de ferramentas.
Responda com um único objeto JSON válido, sem bloco de código, exatamente no formato {"text":"sua mensagem","tool_calls":[{"name":"nome exato da ferramenta","input":{}}]}. Use tool_calls vazio para uma resposta final. Use o campo text para explicações ao usuário. Quando houver ferramentas, solicite as chamadas para realizar a tarefa em vez de apenas descrever o procedimento. Nunca solicite ferramentas ausentes da lista.
Roteamento de agentes: quando a ferramenta Agent estiver disponível, model="haiku" encaminha a tarefa para Gemini Flash; model="opus" ou model="sonnet" seguem o modelo principal selecionado. Para tarefas auxiliares simples, prefira Flash. Escolha explicitamente o modelo para cada delegação. Cada agente recebe seu próprio histórico do controlador.
INSTRUÇÕES DO CONTROLADOR:
${typeof request.system === 'string' ? request.system : JSON.stringify(request.system ?? [])}
FERRAMENTAS DISPONÍVEIS:
${JSON.stringify(tools)}
ESCOLHA DE FERRAMENTA:
${JSON.stringify(request.tool_choice ?? {type:'auto'})}
HISTÓRICO:
${JSON.stringify(messages)}`;
}

export function parseReply(text, tools = []) {
  let reply;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { reply = JSON.parse(cleaned); } catch {
    throw new Error('O Gemini não retornou o formato de ferramentas esperado. Nenhuma ação foi executada.');
  }
  if (!reply || typeof reply.text !== 'string' || !Array.isArray(reply.tool_calls)) {
    throw new Error('Resposta do Gemini com formato inválido. Nenhuma ação foi executada.');
  }
  const allowed = new Map(tools.filter(t => t.name && t.input_schema).map(t => [t.name,t]));
  const content = reply.text ? [{type:'text',text:reply.text}] : [];
  for (const call of reply.tool_calls) {
    if (!allowed.has(call.name) || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)) {
      throw new Error('O Gemini solicitou uma ferramenta inválida. Nenhuma ação foi executada.');
    }
    content.push({type:'tool_use',id:`toolu_${randomUUID().replaceAll('-','')}`,name:call.name,input:call.input});
  }
  if (!content.length) throw new Error('Resposta vazia do Gemini.');
  return content;
}

// This is a local size estimate, not Google's usage or billing meter.
export function inputMetrics(request,modelLabel='4 Argon') {
  const prompt=toWebPrompt(request,modelLabel);
  return {prompt,characters:prompt.length,estimatedInputTokens:Math.ceil(prompt.length/4),
    systemCharacters:JSON.stringify(request.system??[]).length,
    toolsCharacters:JSON.stringify((request.tools??[]).filter(tool=>tool.name&&tool.input_schema)).length,
    messagesCharacters:JSON.stringify(request.messages??[]).length};
}

export function anthropicMessage(request, content,metrics=inputMetrics(request)) {
  return {id:`msg_${randomUUID().replaceAll('-','')}`,type:'message',role:'assistant',model:request.model??'gemini-4-argon',content,
    stop_reason:content.some(b=>b.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null,
    usage:{input_tokens:metrics.estimatedInputTokens,output_tokens:Math.ceil(JSON.stringify(content).length/4)}};
}

export function asSSE(message) {
  const events=[];
  const emit=(type,value)=>events.push(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  emit('message_start',{message:{...message,content:[],stop_reason:null,usage:{...message.usage,output_tokens:0}}});
  message.content.forEach((block,index)=>{
    emit('content_block_start',{index,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}});
    emit('content_block_delta',{index,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}});
    emit('content_block_stop',{index});
  });
  emit('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:message.usage.output_tokens}});
  emit('message_stop',{});
  return events.join('');
}
