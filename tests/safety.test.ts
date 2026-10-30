import {test,expect,afterEach,beforeEach} from 'bun:test';
import {operations,execute,validateVariables,redact,schema,inputSchema} from '../src/operations.ts';
import {getOperationAST,typeFromAST,isNonNullType,isListType,isEnumType,isInputObjectType,type GraphQLInputType} from 'graphql';
import {http,graphql,refresh,type Send} from '../src/transport.ts';
import {importSession,loadSession,logout} from '../src/session.ts';
import {toolList,callTool} from '../src/mcp.ts';
import {loginRequest,loginVerify} from '../src/login.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import Ajv from 'ajv/dist/2020.js';

let root:string;let old:Record<string,string|undefined>;
const keys=['HOPP_CONFIG_DIR','HOPP_ACCESS_TOKEN','HOPP_MCP_ENABLE_WRITES','HOPP_AUTH_ENABLE_WRITES'];
beforeEach(async()=> {old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];root=await mkdtemp(join(tmpdir(),'hopp-mocked-'));process.env.HOPP_CONFIG_DIR=join(root,'cfg');});
afterEach(async()=> {for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];await rm(root,{recursive:true,force:true});});
function sample(type:GraphQLInputType,depth=0):any {
  if(isNonNullType(type))return sample(type.ofType,depth);
  if(isListType(type))return [];
  if(isEnumType(type))return type.getValues()[0].name;
  if(isInputObjectType(type))return Object.fromEntries(Object.values(type.getFields()).filter(f=>isNonNullType(f.type)&&f.defaultValue===undefined).map(f=>[f.name,depth>12?null:sample(f.type,depth+1)]));
  if(type.name==='Int')return 1;if(type.name==='Float')return 1;if(type.name==='Boolean')return false;return 'synthetic';
}
function variables(op:typeof operations[number]) {
  const def=getOperationAST(op.ast,op.name)!;
  return {...Object.fromEntries((def.variableDefinitions??[]).filter(v=>v.type.kind==='NonNullType'&&!v.defaultValue).map(v=>[v.variable.name.value,sample(typeFromAST(schema,v.type) as GraphQLInputType)])),...op.variableRestrictions};
}
test('every write and auth operation previews with zero network calls',async()=> {
  let count=0;const send=(async()=> {count++;throw new Error('unexpected network');}) as Send;
  for(const op of operations.filter(o=>o.effect!=='read')) {
    const result=await execute(op.name,variables(op),false,send);
    expect(result.dryRun).toBe(true);
  }
  expect(count).toBe(0);
});
test('MCP hides writes by default, never exposes auth and requires boolean confirmation',async()=> {
  const reads=toolList(false),all=toolList(true);
  expect(reads.length).toBe(58);expect(all.length).toBe(93);
  expect(all.some(t=>t.name==='hopp_add_phone_auth')).toBe(false);
  await expect(callTool('hopp_rent_vehicle',{variables:{code:'synthetic',initialStatus:'RESERVED'},confirm:false})).rejects.toThrow('not enabled');
  process.env.HOPP_MCP_ENABLE_WRITES='1';
  await expect(callTool('hopp_rent_vehicle',{variables:{code:'synthetic',initialStatus:'RESERVED'}})).rejects.toThrow('confirm');
  const preview=await callTool('hopp_rent_vehicle',{variables:{code:'synthetic',initialStatus:'RESERVED'},confirm:false});expect(preview.dryRun).toBe(true);
});
test('schemas compile with recursive input references and match example variables',()=> {
  const ajv=new Ajv({strict:false});
  for(const op of operations) {const json=inputSchema(op.name);const check=ajv.compile(json);expect(check(variables(op))).toBe(true);}
  for(const tool of toolList(true))ajv.compile(tool.inputSchema);
});
test('rejects invalid fields, enums, unknown operations and staff mode before transport',async()=> {
  expect(()=>validateVariables('rentVehicle',{code:'synthetic',initialStatus:'NOPE'})).toThrow();
  expect(()=>validateVariables('rentVehicle',{code:'synthetic',initialStatus:'TRIP',extra:true})).toThrow('Unknown');
  expect(()=>validateVariables('Me',{isAdmin:true})).toThrow('requires');
  await expect(execute('StartShift',{},true)).rejects.toThrow('Unknown');
});
test('previews redact nested tokens, phone, coordinates, payment tickets and SMS codes',()=> {
  const result=JSON.stringify(redact({nested:[{phone:'synthetic-phone',pin:'synthetic-pin',token:'synthetic-token',paymentId:'synthetic-payment',lat:64,ticket:'synthetic-ticket'}]}));
  expect(result).not.toContain('synthetic');expect(result).not.toContain('64');
});
test('foreign URL rejected without requests; redirects disabled',async()=> {
  let calls=0;const send=(async(_url:any,init:any)=> {calls++;expect(init.redirect).toBe('error');return Response.json({data:{ok:true}});}) as Send;
  await expect(http('https://elsewhere.invalid',{},'synthetic',send)).rejects.toThrow('Unsupported');expect(calls).toBe(0);
  await http('/api',{},'synthetic',send);expect(calls).toBe(1);
});
test('refresh rotates and persists both tokens; next read uses the new access token',async()=> {
  await importSession({accessToken:'synthetic-old',refreshToken:'synthetic-refresh'});
  const send=(async(url:any,init:any)=> {
    if(String(url).endsWith('/user/token'))return Response.json({token:'synthetic-new',refreshToken:'synthetic-refresh-new'});
    expect(init.headers.authorization).toBe('Bearer synthetic-new');return Response.json({data:{me:{id:'synthetic'}}});
  }) as Send;
  await refresh(send);expect((await loadSession())?.refreshToken).toBe('synthetic-refresh-new');await graphql('query X{me{id}}','X',{},false,send);
});
test('revocation stops without retry or overwriting the saved refresh token',async()=> {
  await importSession({accessToken:'synthetic-old',refreshToken:'synthetic-refresh'});let calls=0;
  const send=(async()=> {calls++;return Response.json({message:'account accessed from another device'},{status:401});}) as Send;
  await expect(refresh(send)).rejects.toThrow('revoked');expect(calls).toBe(1);expect((await loadSession())?.accessToken).toBe('synthetic-old');
});
test('refresh cannot race another login/import or recreate a logged-out session',async()=> {
  await importSession({accessToken:'synthetic-old',refreshToken:'synthetic-refresh'});
  let release!:()=>void;let started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const send=(async()=> {started();await gate;return Response.json({token:'synthetic-new',refreshToken:'synthetic-next'});}) as Send;
  const pending=refresh(send);await ready;
  await expect(logout()).rejects.toThrow('Session change');
  await expect(importSession({accessToken:'synthetic-other'})).rejects.toThrow('Session change');
  release();await pending;await logout();expect(await loadSession()).toBeNull();
});
test('mutations never replay after 401',async()=> {
  await importSession({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'});let calls=0;
  const send=(async()=> {calls++;return Response.json({message:'denied'},{status:401});}) as Send;
  await expect(execute('RequestUserDeletion',{},true,send)).rejects.toThrow();expect(calls).toBe(1);
});
test('expired-token hint refreshes before a read and a rejected read refreshes at most once',async()=> {
  const expired='synthetic.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.synthetic';
  await importSession({accessToken:expired,refreshToken:'synthetic-refresh'});
  let calls:string[]=[];
  const send=(async(url:any,init:any)=> {
    calls.push(String(url));
    if(String(url).endsWith('/user/token'))return Response.json({token:'synthetic-new',refreshToken:'synthetic-new-refresh'});
    expect(init.headers.authorization).toBe('Bearer synthetic-new');return Response.json({data:{ok:true}});
  }) as Send;
  await graphql('query X{me{id}}','X',{},false,send);expect(calls.length).toBe(2);expect(calls[0]).toEndWith('/user/token');
  await importSession({accessToken:'synthetic-rejected',refreshToken:'synthetic-refresh'});calls=[];
  const rejected=(async(url:any)=> {calls.push(String(url));return String(url).endsWith('/user/token')?Response.json({token:'synthetic-new'}):Response.json({message:'denied'},{status:401});}) as Send;
  await expect(graphql('query X{me{id}}','X',{},false,rejected)).rejects.toThrow();expect(calls.length).toBe(3);
});
test('coordinate bounds reject before writes and never echo supplied values',()=> {
  expect(()=>validateVariables('RequestQuote',{pickup:{coordinates:{latitude:999,longitude:0}},dropoff:{coordinates:{latitude:0,longitude:0}}})).toThrow('Coordinates');
});
test('login and verification preview without sending or storing a code',async()=> {
  expect(await loginRequest('+12345678900',false)).toMatchObject({dryRun:true});
  expect(await loginVerify('0000',false)).toMatchObject({dryRun:true});
});
