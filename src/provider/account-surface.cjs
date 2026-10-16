const {BrowserWindow,WebContentsView,ipcMain}=require('electron');
const path=require('node:path');
const GOOGLE_HOME='https://gemini.google.com/app';
const GOOGLE_SIGN_IN='https://accounts.google.com/AccountChooser?continue='+encodeURIComponent(GOOGLE_HOME);
const EXACT=new Set(['accounts.youtube.com','myaccount.google.com','gemini.google.com','consent.google.com','oauth-redirect.googleusercontent.com','ssl.gstatic.com','www.gstatic.com','apis.google.com','play.google.com','ogs.google.com']);
// Google finishes sign-in through regional hosts such as accounts.google.com.br/accounts/SetSID.
const GOOGLE_REGIONAL=/^(accounts|www)\.google\.(com|com?\.[a-z]{2}|[a-z]{2})$/;
function allowedNavigation(url){try{const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443'))return false;return EXACT.has(target.hostname)||GOOGLE_REGIONAL.test(target.hostname);}catch{return false;}}
function createAccountSurface({getWindow,getGoogleSession,validate,onReady}){
 let surface,pendingOpen,validationRunning=false,lastValidation=0,connectionValidated=false;
 function status(message,busy=false,origin){if(surface&&!surface.header.webContents.isDestroyed())surface.header.webContents.send('gravity-account-status',{message,busy,origin});}
 function close(){
  clearTimeout(pendingOpen);pendingOpen=undefined;
  if(!surface)return;
  const current=surface;surface=undefined;
  current.window.off('resize',current.layout);current.session.cookies.off('changed',current.onCookie);
  for(const view of [current.header,current.google]){if(!current.window.isDestroyed())current.window.contentView.removeChildView(view);if(!view.webContents.isDestroyed())view.webContents.close();}
 }
 async function verify(){
  if(!surface||validationRunning||Date.now()-lastValidation<2500)return;
  lastValidation=Date.now();
  const cookies=await surface.session.cookies.get({url:GOOGLE_HOME});
  if(!cookies.some(cookie=>cookie.name==='__Secure-1PSID'))return;
  validationRunning=true;status('Conferindo sua conta Gemini…',true);
  try{
   const provider=await validate();connectionValidated=true;
   status('Conta conectada. Voltando ao Gravity Code…',true);
   console.log(JSON.stringify({event:'gravity-account-connected',models:(provider?.models||[]).map(model=>model.label)}));
   await surface?.session.cookies.flushStore();
   setTimeout(()=>{close();Promise.resolve(onReady?.()).catch(()=>{});},600);
  }catch(error){console.error('gravity-account-validation',error);status(`Não foi possível validar a conta: ${error?.message||'erro desconhecido'}`);}
  finally{validationRunning=false;}
 }
 function open(){
  if(surface){surface.window.show();surface.window.focus();return;}
  const window=getWindow();
  if(!window){if(!pendingOpen)pendingOpen=setTimeout(()=>{pendingOpen=undefined;open();},500);return;}
  const session=getGoogleSession();
  const header=new WebContentsView({webPreferences:{preload:path.join(__dirname,'auth-header-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const google=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  header.setBackgroundColor('#0e0f11');google.setBackgroundColor('#ffffff');
  const layout=()=>{if(window.isDestroyed())return;const {width,height}=window.getContentBounds();header.setBounds({x:0,y:0,width,height:64});google.setBounds({x:0,y:64,width,height:Math.max(0,height-64)});};
  const onCookie=(_event,cookie,_cause,removed)=>{if(!removed&&cookie.name==='__Secure-1PSID')setTimeout(verify,1200);};
  surface={window,header,google,layout,session,onCookie};
  window.contentView.addChildView(google);window.contentView.addChildView(header);layout();window.on('resize',layout);window.once('closed',close);session.cookies.on('changed',onCookie);
  const guard=(event,url)=>{if(!allowedNavigation(typeof url==='string'?url:event.url))event.preventDefault();};
  google.webContents.on('will-navigate',guard);google.webContents.on('will-redirect',guard);
  google.webContents.setWindowOpenHandler(({url})=>{if(allowedNavigation(url))google.webContents.loadURL(url).catch(()=>{});return{action:'deny'};});
  const navigated=(_event,url)=>{if(!allowedNavigation(url))return;const target=new URL(url);status('Entre na sua conta Google para conectar o Gemini.',false,target.hostname);if(target.hostname==='gemini.google.com')verify();};
  google.webContents.on('did-navigate',navigated);google.webContents.on('did-navigate-in-page',navigated);
  header.webContents.on('will-navigate',event=>event.preventDefault());header.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  header.webContents.loadFile(path.join(__dirname,'auth-header.html'));
  google.webContents.loadURL(GOOGLE_SIGN_IN).catch(()=>status('Não foi possível abrir a entrada Google. Verifique sua conexão.'));
  session.cookies.get({url:GOOGLE_HOME}).then(stored=>{if(stored.some(cookie=>cookie.name==='__Secure-1PSID'))setTimeout(verify,800);}).catch(()=>{});
  window.show();window.focus();
  console.log(JSON.stringify({event:'gravity-account-surface-opened',mode:'single-window',origin:'accounts.google.com'}));
 }
 ipcMain.on('gravity-account-action',async(event,action)=>{
  if(!surface||event.sender!==surface.header.webContents)return;
  if(action==='back'){close();return;}
 });
 return{open,close,verify,isValidated:()=>connectionValidated};
}
module.exports={createAccountSurface,allowedNavigation,GOOGLE_SIGN_IN};
