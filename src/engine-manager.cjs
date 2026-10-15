'use strict';
const fs = require('node:fs/promises');
const {createReadStream, existsSync} = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {zstdDecompressSync} = require('node:zlib');
const compatibility = require('./compatibility.json');
async function sha256(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function enginePath(root) {return path.join(root,'engine',compatibility.engineVersion,'claude.exe');}
async function verifiedEngine(root) {
  const target=enginePath(root);
  return existsSync(target)&&await sha256(target)===compatibility.engineSha256?target:null;
}
async function prepareEngine(root,progress=()=>{}) {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Esta versão requer Windows x64.');
  const prior=await verifiedEngine(root);if(prior)return prior;
  const target=enginePath(root);await fs.mkdir(path.dirname(target),{recursive:true});
  progress('Baixando o motor do servidor oficial da Anthropic…',5);
  const response=await fetch(compatibility.engineUrl,{signal:AbortSignal.timeout(300000),redirect:'error'});
  if(!response.ok)throw Error(`O download oficial retornou HTTP ${response.status}.`);
  const chunks=[];let size=0;const total=Number(response.headers.get('content-length'));
  for await(const chunk of response.body){size+=chunk.length;if(size>300*1024*1024)throw Error('Download maior que o esperado.');chunks.push(Buffer.from(chunk));progress('Baixando o motor do servidor oficial…',total?Math.min(80,5+75*size/total):undefined);}
  const compressed=Buffer.concat(chunks);
  if(createHash('sha256').update(compressed).digest('hex')!==compatibility.engineCompressedSha256)throw Error('O download não corresponde ao hash publicado.');
  progress('Conferindo os arquivos…',85);
  const bytes=zstdDecompressSync(compressed,{maxOutputLength:600*1024*1024});
  if(createHash('sha256').update(bytes).digest('hex')!==compatibility.engineSha256)throw Error('O motor não corresponde ao hash publicado.');
  const pending=target+'.pending';await fs.writeFile(pending,bytes);await fs.rename(pending,target);
  return target;
}
module.exports={sha256,compatibility,enginePath,verifiedEngine,prepareEngine};
