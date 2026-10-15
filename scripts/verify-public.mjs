import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const excluded=new Set(['node_modules','dist','.git']);
const forbidden=/\.(?:exe|dll|node|asar|zip|zst|pem|pfx|key|log)$/i;
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/AIza[0-9A-Za-z_-]{30,}/,/sk-(?:ant-|proj-)[A-Za-z0-9_-]{20,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/C:[\\/]+Users[\\/]+[^\\/\s]+[\\/]/i];
let count=0;const issues=[];
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(excluded.has(entry.name))continue;const file=path.join(dir,entry.name),name=path.relative(root,file).replaceAll('\\','/');if(entry.isSymbolicLink()){issues.push(name+': symlink');continue;}if(entry.isDirectory()){await walk(file);continue;}count++;if(forbidden.test(name)||['Cookies','Local State','Preferences','.env','oauth_creds.json','.credentials.json','provider.jsonl'].includes(entry.name))issues.push(name+': excluded artifact');const bytes=await fs.readFile(file);if(bytes.length>2*1024*1024)issues.push(name+': oversized source');if(patterns.some(pattern=>pattern.test(bytes.toString('utf8'))))issues.push(name+': sensitive pattern');}}
await walk(root);if(issues.length){console.error(issues.join('\n'));process.exitCode=1;}else console.log(`Public source verified: ${count} files, no private artifacts or credential patterns.`);
