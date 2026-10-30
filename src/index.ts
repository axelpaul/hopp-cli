#!/usr/bin/env bun
import {version} from '../package.json';
import {operations,execute,inputSchema} from './operations.ts';
import {sessionStatus,logout,importSession} from './session.ts';
import {graphql,refresh} from './transport.ts';
import {loginRequest,loginVerify} from './login.ts';
import {cars} from './cars.ts';
import {serve} from './mcp.ts';

function options(args:string[]) {
  const out:Record<string,string|boolean>={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];if(!['--json','--yes','--variables','--phone','--region','--model'].includes(key))throw new Error('Unknown argument: '+key);
    if(key in out)throw new Error('Duplicate argument: '+key);
    if(['--yes','--json'].includes(key))out[key]=true;
    else {const value=args[++i];if(!value||value.startsWith('--'))throw new Error('Missing value for '+key);out[key]=value;}
  }
  return out;
}
async function main() {
  const [command='help',...args]=process.argv.slice(2);
  if(command==='serve'){if(args.length)throw new Error('serve takes no arguments');await serve();return;}
  if(command==='--version'||command==='version'){console.log('hopp '+version);return;}
  if(command==='help'||command==='--help') {
    console.log(`hopp ${version}\nCommands: doctor, cars [--model buzz] [--region 1], operations, schema NAME, login --phone +... [--yes], verify [--yes] (code on stdin), refresh [--yes], logout, import-session (JSON on stdin), serve\nEvery customer operation: hopp OPERATION [--variables JSON|@file] [--yes] [--json]\nWrites preview unless --yes. Auth requires HOPP_AUTH_ENABLE_WRITES=1. MCP writes require HOPP_MCP_ENABLE_WRITES=1 and confirm.\nCredentials: private OS config hopp-cli/auth.json, outside source.\nUse operations for the complete operation list.`);return;
  }
  if(command==='schema') {if(args.length!==1)throw new Error('schema requires one operation name');console.log(JSON.stringify(inputSchema(args[0]),null,2));return;}
  const opts=options(args);let result:unknown;
  if(command==='operations')result=operations.map(op=>({name:op.name,effect:op.effect,tool:op.effect==='auth'?null:op.toolName}));
  else if(command==='doctor') {
    const local=await sessionStatus();
    try {const data=await graphql('query Doctor {me {id}}','Doctor',{},false);result={version,...local,authenticated:!!data.me};}
    catch(error) {result={version,...local,authenticated:false,error:(error as Error).message};process.exitCode=1;}
  }
  else if(command==='cars')result=await cars(opts['--region']?Number(opts['--region']):1,String(opts['--model']??''));
  else if(command==='login')result=await loginRequest(String(opts['--phone']??''),opts['--yes']===true);
  else if(command==='verify')result=await loginVerify((await Bun.stdin.text()).trim(),opts['--yes']===true);
  else if(command==='refresh') {if(opts['--yes']!==true)result={dryRun:true,action:'refresh session'};else {await refresh();result={stored:true};}}
  else if(command==='logout')result=await logout();
  else if(command==='import-session')result=await importSession(JSON.parse(await Bun.stdin.text()));
  else {
    const raw=String(opts['--variables']??'{}');const variables=JSON.parse(raw.startsWith('@')?await Bun.file(raw.slice(1)).text():raw);
    if(!variables||typeof variables!=='object'||Array.isArray(variables))throw new Error('variables must be a JSON object');
    result=await execute(command,variables,opts['--yes']===true);
  }
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error instanceof SyntaxError?'Invalid JSON; input omitted for privacy':error instanceof Error?error.message:'Command failed');process.exitCode=1;});
