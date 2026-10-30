import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
for (const writes of [false,true]) {
  const env=Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string]=>e[1]!==undefined));
  env.HOPP_MCP_ENABLE_WRITES=writes?'1':'0';
  const client=new Client({name:'hopp-verification',version:'1'});
  await client.connect(new StdioClientTransport({command:resolve(import.meta.dir,'../hopp'),args:['serve'],env}));
  const listed=await client.listTools();
  if(listed.tools.length!==(writes?93:58))throw new Error('Unexpected tool count');
  if(writes) {
    const result=await client.callTool({name:'hopp_rent_vehicle',arguments:{variables:{code:'synthetic',initialStatus:'RESERVED'},confirm:false}});
    const content=result.content as {type:string;text?:string}[];
    if(result.isError||JSON.parse(content.find(c=>c.type==='text')!.text!).dryRun!==true)throw new Error('Preview failed');
  }
  await client.close();
  console.log(JSON.stringify({compiled:true,writes,tools:listed.tools.length,previewVerified:writes}));
}
