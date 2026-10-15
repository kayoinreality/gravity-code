import { loadDesktopSession,desktopSessionAvailable,notifyDesktopAuthRequired } from './engine-session.mjs';
import { GeminiWeb } from './gemini-web.mjs';
import { inputMetrics, parseReply, anthropicMessage, asSSE } from './protocol.mjs';

// The preload belongs to this client, not to unrelated Bun programs run by tools.
delete process.env.BUN_OPTIONS;
const projectDirectory=process.env.GRAVITY_PROJECT_DIR;
delete process.env.GRAVITY_PROJECT_DIR;
if(projectDirectory)process.chdir(projectDirectory);

const nativeFetch = globalThis.fetch.bind(globalThis);
let clientPromise, session, turn=0;
function trace(event, details={}) {
  if(process.env.GEMINI_NATIVE_TRACE!=='1')return;
  const line=JSON.stringify({timestamp:new Date().toISOString(),event,pid:process.pid,...details});
  console.error(line);
}
async function client() {
  if (!clientPromise) clientPromise = (async()=>{
    if(!desktopSessionAvailable)throw new Error('Inicie esta sessão pelo aplicativo Gravity Code.');
    session = await loadDesktopSession();
    const value = await new GeminiWeb(session,nativeFetch).initialize();
    trace('google_authenticated',{models:value.models.map(m=>({id:m.id,label:m.label}))});
    return value;
  })().catch(async error=>{session?.clear();session=undefined;clientPromise=undefined;if(error.code==='GRAVITY_AUTH_REQUIRED')await notifyDesktopAuthRequired().catch(()=>{});throw error;});
  return clientPromise;
}
process.on('exit',()=>session?.clear());
trace('provider_loaded',{runtime:process.versions.bun,transport:'same-process-fetch',listener:false});
globalThis.fetch = async function(input,init) {
  const url = new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(url.hostname!=='gemini-native.invalid') return nativeFetch(input,init);
  try {
    const rawBody=init?.body??(input instanceof Request?await input.text():undefined);
    const body=typeof rawBody==='string'?JSON.parse(rawBody):{};
    if(url.pathname.endsWith('/messages/count_tokens')) return Response.json({input_tokens:inputMetrics(body).estimatedInputTokens});
    if(!url.pathname.endsWith('/messages')) return Response.json({error:{type:'invalid_request_error',message:'Endpoint não implementado.'}},{status:404});
    const provider=await client();
    await session.refresh?.();
    const selected=provider.resolveModel(body.model);
    const metrics=inputMetrics(body,selected.label);
    await session.consume({model:body.model,estimatedInputTokens:metrics.estimatedInputTokens});
    trace('gemini_request',{requestedModel:body.model,tools:(body.tools??[]).map(tool=>tool.name).filter(Boolean),promptCharacters:metrics.characters,estimatedInputTokens:metrics.estimatedInputTokens,systemCharacters:metrics.systemCharacters,toolsCharacters:metrics.toolsCharacters,messagesCharacters:metrics.messagesCharacters});
    const generated=await provider.generate(metrics.prompt,selected,init?.signal??(input instanceof Request?input.signal:undefined));
    const content=parseReply(generated.text,body.tools);
    const message=anthropicMessage(body,content,metrics);
    trace('gemini_response',{turn:++turn,requestedModel:body.model,modelId:generated.selectedModel.id,label:generated.selectedModel.label,toolCalls:content.filter(c=>c.type==='tool_use').map(c=>c.name)});
    return body.stream?new Response(asSSE(message),{headers:{'Content-Type':'text/event-stream','request-id':message.id}}):Response.json(message,{headers:{'request-id':message.id}});
  }catch(error){
    trace('provider_error',{message:error.message});
    const auth=error.code==='GRAVITY_AUTH_REQUIRED';
    return Response.json({type:'error',error:{type:auth?'authentication_error':'invalid_request_error',message:error.message}},{status:auth?401:400});
  }
};
