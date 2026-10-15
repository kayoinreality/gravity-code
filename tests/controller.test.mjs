import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{EngineTurn,argumentsFor}=require('../src/engine-controller.cjs');
const {allowedNavigation}=require('../src/provider/account-surface.cjs');
const {RequestBudget}=require('../src/request-budget.cjs');
test('all model attempts share a hard request budget',()=>{const budget=new RequestBudget(8);for(let i=1;i<=8;i++)assert.equal(budget.consume().used,i);assert.throws(()=>budget.consume(),/Limite de 8/);assert.equal(budget.used,8);});
test('native launcher preserves permissions and blocks ambient MCP and customizations',()=>{
  const args=argumentsFor({id:'id',model:'gemini-3.8-flash'});for(const flag of ['--restricted','--safe-mode','--strict-mcp-config','--permission-prompt-tool'])assert.ok(args.includes(flag));assert.ok(!args.includes('--dangerously-skip-permissions'));assert.ok(args.includes('manual'));assert.throws(()=>argumentsFor({model:'arbitrary'}));
});
test('Google login navigation requires exact HTTPS hosts',()=>{
  assert.equal(allowedNavigation('https://accounts.google.com/AccountChooser'),true);for(const url of ['http://accounts.google.com','https://accounts.google.com.evil.example','https://accounts.google.com@evil.example','file:///index.html','https://accounts.google.com:444/'])assert.equal(allowedNavigation(url),false);
});
test('native control protocol waits for initialization and permission approval',async()=>{
  let native,options,permission;const written=[];let ended;
  const turn=new EngineTurn({engine:'claude.exe',providerDirectory:'provider with spaces',projectPath:'project with spaces',configPath:'config',pipe:'pipe',token:'test-token',id:'id',model:'gemini-3.8-flash',text:'hello',onPermission:value=>permission=value,onEnd:error=>ended=error,
    spawnProcess:(_file,_args,opts)=>{options=opts;native=new EventEmitter();native.stdin=new PassThrough();native.stdout=new PassThrough();native.stderr=new PassThrough();native.kill=()=>{};native.stdin.on('data',chunk=>written.push(JSON.parse(chunk)));return native;}});
  assert.equal(options.env.BUN_OPTIONS,'--preload=./preload.mjs');assert.equal(written.length,1);assert.equal(written[0].request.subtype,'initialize');
  native.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:written[0].request_id,response:{}}})+'\n');await new Promise(resolve=>setImmediate(resolve));assert.equal(written[1].type,'user');
  native.stdout.write(JSON.stringify({type:'control_request',request_id:'permission',request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'a.txt',content:'text'}}})+'\n');await new Promise(resolve=>setImmediate(resolve));assert.equal(permission.toolName,'Write');assert.equal(written.length,2);
  assert.equal(turn.decide('permission',false),true);assert.equal(written[2].response.response.behavior,'deny');assert.equal(turn.decide('permission',true),false);turn.cancel();assert.equal(ended,'Operação interrompida.');
});
test('main result waits for background agents and their final turn',async()=>{
  let native;let completed=0;
  const turn=new EngineTurn({engine:'claude.exe',providerDirectory:'provider',projectPath:'project',configPath:'config',id:'id',model:'gemini-3.8-flash',text:'hello',onEnd:()=>completed++,spawnProcess:()=>{native=new EventEmitter();native.stdin=new PassThrough();native.stdout=new PassThrough();native.stderr=new PassThrough();native.kill=()=>{};return native;}});
  const emit=async message=>{native.stdout.write(JSON.stringify(message)+'\n');await new Promise(resolve=>setImmediate(resolve));};
  await emit({type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'child'}]});await emit({type:'result',is_error:false});assert.equal(completed,0);
  await emit({type:'system',subtype:'background_tasks_changed',tasks:[]});assert.equal(completed,0);await emit({type:'result',is_error:false});assert.equal(completed,1);native.emit('close',0);
});
