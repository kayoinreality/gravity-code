import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPackage} from '@electron/asar';
import {flipFuses,FuseVersion,FuseV1Options} from '@electron/fuses';
const run=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Build requires Windows x64.');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const dist=path.join(root,'dist'),stage=path.join(dist,'.app-source'),output=path.join(dist,'GravityCode');
for(const target of [stage,output]){const relative=path.relative(dist,target);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Invalid build target');await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target,{recursive:true});}
for(const dir of ['app','src'])await fs.cp(path.join(root,dir),path.join(stage,dir),{recursive:true});
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,productName:'Gravity Code',version:pkg.version,main:pkg.main,license:pkg.license}));
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(root,name),path.join(stage,name));
const runtime=path.join(root,'node_modules','electron','dist');
if((await fs.readFile(path.join(runtime,'version'),'utf8')).trim()!==pkg.devDependencies.electron)throw Error('Unexpected Electron runtime');
// A clean runtime is required; never copy another application's resources.
for(const entry of await fs.readdir(runtime))if(entry!=='resources')await fs.cp(path.join(runtime,entry),path.join(output,entry),{recursive:true});
await fs.mkdir(path.join(output,'resources'));await createPackage(stage,path.join(output,'resources','app.asar'));
await fs.rename(path.join(output,'electron.exe'),path.join(output,'GravityCode.exe'));
await flipFuses(path.join(output,'GravityCode.exe'),{version:FuseVersion.V1,[FuseV1Options.RunAsNode]:false,[FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,[FuseV1Options.EnableNodeCliInspectArguments]:false,[FuseV1Options.OnlyLoadAppFromAsar]:true});
await fs.copyFile(path.join(root,'README.md'),path.join(output,'LEIA-ME.md'));
await fs.cp(path.join(root,'docs'),path.join(output,'docs'),{recursive:true});
await fs.copyFile(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(output,'THIRD_PARTY_NOTICES.md'));
await fs.copyFile(path.join(root,'LICENSE'),path.join(output,'GRAVITY-LICENSE.txt'));
for(const entry of await fs.readdir(output,{recursive:true})){const p=path.join(output,entry);const s=await fs.stat(p);if(s.mtime.getFullYear()<1980)await fs.utimes(p,new Date(),new Date());}
const archive=path.join(dist,`GravityCode-${pkg.version}-windows-x64.zip`);await fs.rm(archive,{force:true});
await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Compress-Archive -Path (Join-Path $env:GRAVITY_BUILD_APP "*") -DestinationPath $env:GRAVITY_BUILD_ZIP -CompressionLevel Optimal -Force'],{env:{...process.env,GRAVITY_BUILD_APP:output,GRAVITY_BUILD_ZIP:archive},windowsHide:true,maxBuffer:1024*1024,timeout:120000});
const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
await fs.writeFile(path.join(dist,'SHA256SUMS.txt'),`${hash.digest('hex')}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({archive,bytes:(await fs.stat(archive)).size,engineBundled:false,desktopDependency:false}));
