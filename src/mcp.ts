import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {operations,inputSchema,execute,getOperation} from './operations.ts';
import {cars} from './cars.ts';
import {version} from '../package.json';
export function toolList(writes=process.env.HOPP_MCP_ENABLE_WRITES==='1') {
  return [{name:'hopp_cars',description:'List currently listed rental cars across a region, optionally filtered by model. Does not reserve.',inputSchema:{type:'object' as const,properties:{region:{type:'integer',minimum:1,default:1},model:{type:'string'}},additionalProperties:false}},
    ...operations.filter(op=>op.effect==='read'||(writes&&op.effect==='write')).map(op=> {
      const variables=inputSchema(op.name);const {$defs,...variableSchema}=variables;
      return ({
      name:op.toolName,description:`${op.name}: ${op.effect==='write'?'changes service state; confirm=false previews only':'read-only service operation'}`,
      inputSchema:{type:'object' as const,properties:{variables:variableSchema,...(op.effect==='write'?{confirm:{type:'boolean',description:'Explicitly true to execute; false previews'}}:{})},required:['variables',...(op.effect==='write'?['confirm']:[])],additionalProperties:false,...($defs?{$defs}:{})},
      annotations:{readOnlyHint:op.effect==='read',destructiveHint:op.effect==='write',idempotentHint:false,openWorldHint:true}
    });})];
}
export async function callTool(name:string,args:Record<string,any>) {
  if(name==='hopp_cars') {
    if(Object.keys(args).some(k=>!['region','model'].includes(k)))throw new Error('Unknown car-list argument');
    if(args.model!==undefined&&typeof args.model!=='string')throw new Error('model must be a string');
    return cars(args.region??1,args.model??'');
  }
  const op=getOperation(name);
  if(op.effect==='auth'||(op.effect==='write'&&process.env.HOPP_MCP_ENABLE_WRITES!=='1'))throw new Error('Tool not enabled');
  if(Object.keys(args).some(k=>!['variables',...(op.effect==='write'?['confirm']:[])].includes(k)))throw new Error('Unknown argument');
  if(op.effect==='write'&&typeof args.confirm!=='boolean')throw new Error('Explicit boolean confirm is required');
  if(!args.variables||typeof args.variables!=='object'||Array.isArray(args.variables))throw new Error('variables must be an object');
  return execute(op.name,args.variables,args.confirm===true);
}
export async function serve() {
  const server=new Server({name:'hopp-cli',version},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolList()}));
  server.setRequestHandler(CallToolRequestSchema,async(request)=> {
    try {const result=await callTool(request.params.name,request.params.arguments??{});return {content:[{type:'text',text:JSON.stringify(result)}]};}
    catch(error) {return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Operation failed'}]};}
  });
  await server.connect(new StdioServerTransport());
}
