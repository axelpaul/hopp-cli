import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
const env=Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string]=>e[1]!==undefined));env.HOPP_MCP_ENABLE_WRITES='1';
const client=new Client({name:'catalogue',version:'1'});
await client.connect(new StdioClientTransport({command:resolve(import.meta.dir,'../hopp'),args:['serve'],env}));
const result=await client.listTools();await Bun.write('docs/listed-tools.json',JSON.stringify(result.tools.map(t=>({name:t.name,write:t.annotations?.readOnlyHint!==true&&t.name!=='hopp_cars',description:t.description})),null,2));await client.close();
