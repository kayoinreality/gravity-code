'use strict';
const {app,BrowserWindow,WebContentsView,ipcMain,dialog,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {randomUUID,randomBytes,timingSafeEqual}=require('node:crypto');
const {EngineTurn,MODELS}=require('../src/engine-controller.cjs');
const {RequestBudget}=require('../src/request-budget.cjs');
const manager=require('../src/engine-manager.cjs');
const {createAccountSurface}=require('../src/provider/account-surface.cjs');
const VERSION='0.1.0',REQUEST_LIMIT=8;
if(process.argv.some(value=>value.startsWith('--smoke-test=')))app.disableHardwareAcceleration();
app.setName('Gravity Code');
const root=path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'GravityCodeStandalone');
app.setPath('userData',root);
if(!app.requestSingleInstanceLock())app.quit();
let window,mainView,google,account,clientPromise,engine,providerDirectory,preparing=false,saveTimer;
const turns=new Map(),channels=new Map();
const state={version:VERSION,activeId:null,sessions:[],models:[{id:MODELS[0],label:'Gemini Flash'},{id:MODELS[1],label:'Gemini Argon'}],
  connection:{connected:false,message:'Entre na sua conta Google. A conexão não gera respostas.'},
  engine:{ready:false,message:'Prepare o motor oficial para começar.',progress:0}};
function emit(event){if(mainView&&!mainView.webContents.isDestroyed())mainView.webContents.send('gravity-event',event);}
function changed(){emit({type:'state',state});clearTimeout(saveTimer);saveTimer=setTimeout(save,250);}
async function save(){await fs.mkdir(root,{recursive:true});const file=path.join(root,'conversations.json');await fs.writeFile(file+'.pending',JSON.stringify({activeId:state.activeId,sessions:state.sessions.map(s=>({...s,busy:false}))}));await fs.rename(file+'.pending',file).catch(()=>{});}
function find(id){const s=state.sessions.find(s=>s.id===id);if(!s)throw Error('Conversa não encontrada.');return s;}
function createSession(){const id=randomUUID();state.sessions.unshift({id,title:'Nova conversa',model:MODELS[0],projectPath:'',busy:false,messages:[],resume:false});state.activeId=id;changed();return id;}
function addMessage(s,role,text){const m={id:randomUUID(),role,text,tools:[]};s.messages.push(m);return m;}
function getGoogleSession(){if(!google){google=session.fromPartition('persist:gravity-google');google.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));}return google;}
async function cookies(){const stored=await getGoogleSession().cookies.get({url:'https://gemini.google.com/app'});if(!stored.some(c=>c.name==='__Secure-1PSID')){const e=Error('Conecte sua conta Google no Gravity Code.');e.code='GRAVITY_AUTH_REQUIRED';throw e;}return stored.map(c=>`${c.name}=${c.value}`).join('; ');}
async function client(){if(!clientPromise)clientPromise=(async()=>{const {GeminiWeb}=await import('../src/provider/gemini-web.mjs');const auth={cookieHeader:()=>cookiesHeader,clear(){cookiesHeader='';}};let cookiesHeader=await cookies();return new GeminiWeb(auth,(input,init)=>getGoogleSession().fetch(input,{...init,credentials:'include'})).initialize();})().catch(error=>{clientPromise=undefined;throw error;});return clientPromise;}
async function channelFor(s){
  const pipe='\\\\.\\pipe\\gravity-code-'+randomUUID(),token=randomBytes(32).toString('hex');
  const context={pipe,token,budget:new RequestBudget(REQUEST_LIMIT),cancelled:false};
  const server=net.createServer(socket=>{
    let data='';socket.setTimeout(15000,()=>socket.destroy());socket.on('error',()=>{});
    socket.on('data',async chunk=>{
      data+=chunk;if(data.length>4096){socket.destroy();return;}if(!data.includes('\n'))return;socket.removeAllListeners('data');
      try{
        const request=JSON.parse(data.trim());data='';const got=Buffer.from(request.token||''),want=Buffer.from(token);
        if(got.length!==want.length||!timingSafeEqual(got,want)){socket.destroy();return;}
        if(context.cancelled)throw Error('Operação interrompida.');
        if(request.action?.kind==='consume'){
          const usage=context.budget.consume();s.requests=usage.used;s.estimatedInputTokens=(s.estimatedInputTokens||0)+Math.max(0,Number(request.action.metrics?.estimatedInputTokens)||0);changed();
          socket.end(JSON.stringify({ok:true,remaining:usage.remaining}));
        }else if(request.action==='read')socket.end(JSON.stringify({cookieHeader:await cookies()}));
        else if(request.action==='require-login'){state.connection={connected:false,message:'Entre novamente na sua conta Google.'};changed();account.open();socket.end(JSON.stringify({ok:true}));}
        else throw Error('Operação de sessão desconhecida.');
      }catch(error){socket.end(JSON.stringify({error:error.message}));}
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
  context.close=()=>{context.cancelled=true;server.close();};channels.set(s.id,context);return context;
}
async function copyProvider(){const target=path.join(root,'provider',VERSION);await fs.mkdir(target,{recursive:true});for(const name of ['preload.mjs','engine-session.mjs','gemini-web.mjs','protocol.mjs','session-common.mjs'])await fs.copyFile(path.join(__dirname,'../src/provider',name),path.join(target,name));return target;}
function engineProgress(message,progress){state.engine={ready:false,message,progress,busy:true};changed();}
async function prepare(){if(preparing)return{ok:false,message:'A preparação já está em andamento.'};preparing=true;try{engine=await manager.prepareEngine(root,engineProgress);state.engine={ready:true,message:'Motor pronto.',progress:100};changed();return{ok:true};}catch(error){state.engine={ready:false,message:error.message,error:true,progress:0};changed();return{ok:false,message:error.message};}finally{preparing=false;}}
async function send({sessionId,text,model}={}){
  const s=find(sessionId);if(s.busy)throw Error('Esta conversa já está em andamento.');
  if(typeof text!=='string'||!text.trim()||text.length>200000)throw Error('Escreva uma mensagem de até 200.000 caracteres.');
  if(!MODELS.includes(model))throw Error('Modelo inválido.');if(!engine)throw Error('Prepare o motor antes de enviar.');
  if(!state.connection.connected)throw Error('Conecte sua conta Google antes de enviar.');
  if(!s.projectPath)throw Error('Escolha uma pasta para o projeto antes de enviar.');
  await fs.access(s.projectPath);const channel=await channelFor(s);
  s.busy=true;s.model=model;s.requests=0;s.estimatedInputTokens=0;if(s.title==='Nova conversa')s.title=text.trim().slice(0,60);
  addMessage(s,'user',text.trim());let assistant=addMessage(s,'assistant','');changed();
  const turn=new EngineTurn({engine,providerDirectory,projectPath:s.projectPath,configPath:path.join(root,'harness'),pipe:channel.pipe,token:channel.token,id:s.id,resume:s.resume,model,text,
    onPermission:permission=>emit({type:'permission',permission}),
    onMessage:message=>{
      if(message.type==='assistant'){
        const parts=message.message?.content||[];const texts=parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
        if(texts){if(assistant.text)assistant=addMessage(s,'assistant','');assistant.text=texts;}
        for(const tool of parts.filter(p=>p.type==='tool_use'))assistant.tools.push({id:tool.id,name:tool.name,status:'Solicitada',detail:JSON.stringify(tool.input,null,2)});
      }else if(message.type==='user'){
        for(const item of message.message?.content||[])if(item.type==='tool_result')for(const m of s.messages)for(const tool of m.tools||[])if(tool.id===item.tool_use_id)tool.status=item.is_error?'Falhou':'Concluída';
      }else if(message.type==='result'){
        s.resume=true;if(!assistant.text&&message.result)assistant.text=message.result;
      }
      changed();
    },
    onEnd:error=>{channel.close();channels.delete(s.id);turns.delete(s.id);s.busy=false;if(error)addMessage(s,'system',error);changed();}
  });turns.set(s.id,turn);return{ok:true};
}
function register(name,handler){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==mainView?.webContents||event.senderFrame!==mainView.webContents.mainFrame)throw Error('Origem recusada.');return handler(...args);});}
app.whenReady().then(async()=>{
  await fs.mkdir(root,{recursive:true});
  try{const old=JSON.parse(await fs.readFile(path.join(root,'conversations.json'),'utf8'));if(Array.isArray(old.sessions))state.sessions=old.sessions.filter(s=>typeof s.id==='string'&&Array.isArray(s.messages)).map(s=>({...s,busy:false}));state.activeId=old.activeId;}catch{}
  if(!state.sessions.length)createSession();
  providerDirectory=await copyProvider();engine=await manager.verifiedEngine(root);if(engine)state.engine={ready:true,message:'Motor pronto.',progress:100};
  const preferences={preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false};
  const smokeMode=process.argv.some(value=>value.startsWith('--smoke-test='));
  window=new BrowserWindow({width:1320,height:920,minWidth:980,minHeight:700,title:'Gravity Code',backgroundColor:'#15191b',autoHideMenuBar:true,webPreferences:smokeMode?{...preferences,offscreen:true}:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  mainView=smokeMode?{webContents:window.webContents}:new WebContentsView({webPreferences:preferences});
  if(!smokeMode){mainView.setBackgroundColor('#15191b');window.contentView.addChildView(mainView);const layout=()=>{const {width,height}=window.getContentBounds();mainView.setBounds({x:0,y:0,width,height});};layout();window.on('resize',layout);window.on('closed',()=>{if(!mainView.webContents.isDestroyed())mainView.webContents.close();});}
  mainView.webContents.setWindowOpenHandler(()=>({action:'deny'}));mainView.webContents.on('will-navigate',event=>event.preventDefault());
  mainView.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  account=createAccountSurface({getWindow:()=>window,getGoogleSession,validate:()=>{clientPromise=undefined;return client();},onReady:()=>{state.connection={connected:true,message:'Conta conectada. Flash é o padrão; Argon pode ser escolhido por conversa.'};changed();}});
  register('gravity-state',()=>state);register('gravity-create-session',createSession);register('gravity-prepare-engine',prepare);
  register('gravity-select-folder',async id=>{const s=find(id);if(s.busy||s.resume)throw Error('Crie uma nova conversa para trocar a pasta.');const result=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'Escolha a pasta do projeto'});if(!result.canceled){s.projectPath=result.filePaths[0];changed();}return{canceled:result.canceled,path:result.filePaths[0]};});
  register('gravity-connect',()=>{account.open();return{ok:true};});register('gravity-send',send);
  register('gravity-cancel',id=>{turns.get(id)?.cancel();return{ok:true};});
  register('gravity-permission',({id,allow}={})=>{if(typeof allow!=='boolean')throw Error('Decisão inválida.');for(const turn of turns.values())if(turn.decide(id,allow))return{ok:true};return{ok:false,message:'Esta permissão não está mais pendente.'};});
  await mainView.webContents.loadFile(path.join(__dirname,'index.html'));
  window.hide();window.show();
  // A hidden Windows launch can retain a stale compositor surface until resize.
  const openingBounds=window.getBounds();window.setSize(openingBounds.width+1,openingBounds.height);
  setTimeout(()=>{if(!window.isDestroyed())window.setSize(openingBounds.width,openingBounds.height);},80);
  app.on('second-instance',()=>{window?.show();window?.focus();});
  const smoke=process.argv.find(value=>value.startsWith('--smoke-test='));
  if(smoke){await new Promise(resolve=>setTimeout(resolve,2000));const target=smoke.slice(13);const dom=await window.webContents.executeJavaScript('({url:location.href,title:document.title,text:document.body.innerText.slice(0,5000),api:typeof window.gravity,width:innerWidth,height:innerHeight})');await fs.writeFile(target+'.json',JSON.stringify({title:window.getTitle(),ready:true,engineReady:!!engine,generations:0,standalone:true,dom}));const picture=await window.webContents.capturePage();await fs.writeFile(target,picture.toPNG());app.quit();}
}).catch(async error=>{const smoke=process.argv.find(value=>value.startsWith('--smoke-test='));if(smoke)await fs.writeFile(smoke.slice(13)+'.error.txt',error.stack);else dialog.showErrorBox('Gravity Code',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{for(const turn of turns.values())turn.cancel();for(const channel of channels.values())channel.close();});
