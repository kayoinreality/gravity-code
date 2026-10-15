import {createConnection} from 'node:net';
const pipe=process.env.GRAVITY_SESSION_PIPE,token=process.env.GRAVITY_SESSION_TOKEN;
export const desktopSessionAvailable=Boolean(pipe&&token);
delete process.env.GRAVITY_SESSION_PIPE;
delete process.env.GRAVITY_SESSION_TOKEN;
async function requestSession(action){
 if(!pipe||!token)throw new Error('A sessão deve ser iniciada pelo Gravity Code desktop.');
 const reply=await new Promise((resolve,reject)=>{
  const socket=createConnection(pipe);let data='';
  socket.setTimeout(15000,()=>{socket.destroy();reject(new Error('A sessão desktop não respondeu.'));});
  socket.on('connect',()=>socket.write(JSON.stringify({token,action})+'\n'));
  socket.on('error',reject);socket.on('data',chunk=>{data+=chunk;if(data.length>131072){socket.destroy();reject(new Error('Resposta de sessão inválida.'));}});
  socket.on('end',()=>{try{const value=JSON.parse(data);data='';if(value.error)reject(new Error(value.error));else resolve(value);}catch{reject(new Error('A sessão desktop retornou dados inválidos.'));}});
 });
 return reply;
}
export async function notifyDesktopAuthRequired(){if(desktopSessionAvailable)await requestSession('require-login');}
export async function loadDesktopSession(){
 let header=(await requestSession('read')).cookieHeader;
 return {async consume(metrics){await requestSession({kind:'consume',metrics});},async refresh(){header=(await requestSession('read')).cookieHeader;},cookieHeader(url){const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='gemini.google.com')throw new Error('Domínio de autenticação recusado.');return header;},clear(){header='';}};
}
