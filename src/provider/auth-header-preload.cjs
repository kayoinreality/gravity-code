const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('gravityAccount',{
 back:()=>ipcRenderer.send('gravity-account-action','back'),
 onStatus:callback=>ipcRenderer.on('gravity-account-status',(_event,value)=>callback(value)),
});
