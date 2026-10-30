import {mkdtemp,rm,readFile,stat,realpath,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import metadata from '../package.json';
import catalog from '../mcp-catalog.json';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
async function listServerTools(writes:boolean,command:string,args:string[]) {
 const client=new Client({name:'install-check',version:'1'});
 try {await client.connect(new StdioClientTransport({command,args,env:{...env,HOPP_MCP_ENABLE_WRITES:writes?'1':'0'}}));return (await client.listTools()).tools;}finally{await client.close();}
}
const root=await mkdtemp(join(tmpdir(),'hopp-source-install-'));
const bin=join(root,'bin');
const env:Record<string,string>={PATH:process.env.PATH??'',HOME:root,BUN_INSTALL_GLOBAL_DIR:join(root,'global'),BUN_INSTALL_BIN:bin,BUN_INSTALL_CACHE_DIR:join(root,'cache'),HOPP_CONFIG_DIR:join(root,'config')};
async function run(args:string[]){const p=Bun.spawn([process.execPath,...args],{cwd:root,env,stdout:'pipe',stderr:'pipe'});const [stdout,stderr,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(exit!==0)throw new Error(`Isolated Bun command failed (${args[0]}): ${stderr}`);return stdout.trim();}
let installed=false;
await mkdir(join(root,'global'),{recursive:true});
await writeFile(join(root,'global/package.json'),JSON.stringify({private:true,dependencies:{}}));
try{
 if(await run(['pm','bin','--global'])!==bin)throw new Error('Refusing to touch a non-isolated global bin directory');
 await run(['add','-g','--no-cache','github:axelpaul/hopp-cli']);installed=true;
 const command=join(bin,'hopp');const file=await realpath(command);if(!file.startsWith(root+'/'))throw new Error('Installed command escaped sandbox');
 if(!(await readFile(file,'utf8')).startsWith('#!/usr/bin/env bun'))throw new Error('Missing Bun shebang');
 if(!((await stat(file)).mode&0o111))throw new Error('Installed entry is not executable');
 const p=Bun.spawn([command,'--version'],{cwd:root,env,stdout:'pipe',stderr:'pipe'});const [version,exit]=await Promise.all([new Response(p.stdout).text(),p.exited]);if(exit!==0||version.trim()!==('hopp '+metadata.version))throw new Error('Installed version mismatch');
 const tools=await listServerTools(true,command,['serve']);
 const names=tools.map(tool=>tool.name).sort();if(JSON.stringify(names)!==JSON.stringify(catalog.tools.map(tool=>tool.name).sort()))throw new Error('Installed MCP catalogue mismatch');
 console.log(JSON.stringify({githubInstall:true,executableEntry:true,version:version.trim(),installedMcpTools:tools.length}));
}finally{
 try{if(installed){await run(['remove','-g',metadata.name]);const present=await stat(join(bin,'hopp')).then(()=>true,()=>false);if(present)throw new Error('Uninstall left the command installed');console.log(JSON.stringify({uninstalled:true,originalGlobalInstallationUntouched:true}));}}
 finally{await rm(root,{recursive:true,force:true});}
}
