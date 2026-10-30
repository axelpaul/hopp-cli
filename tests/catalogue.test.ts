import {test,expect} from 'bun:test';
import Ajv from 'ajv/dist/2020.js';
import catalog from '../mcp-catalog.json';
import schema from '../docs/catalog.schema.json';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
test('catalogue validates and matches a real MCP tools/list with writes enabled',async()=> {
  const validate=new Ajv({strict:false,allErrors:true}).compile(schema);
  expect(validate(catalog)).toBe(true);
  const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));env.HOPP_MCP_ENABLE_WRITES='1';
  const client=new Client({name:'catalogue-test',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dir,'../src/index.ts'),'serve'],env}));
    const result=await client.listTools();
    expect(catalog.tools.map(t=>t.name).sort()).toEqual(result.tools.map(t=>t.name).sort());
    for(const tool of result.tools)expect(catalog.tools.find(t=>t.name===tool.name)?.write).toBe(tool.annotations?.readOnlyHint!==true&&tool.name!=='hopp_cars');
  } finally {await client.close();}
},15000);
