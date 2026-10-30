import {buildClientSchema, parse, validate, getOperationAST, type GraphQLInputType, isNonNullType, isListType, isInputObjectType, isEnumType, typeFromAST} from 'graphql';
import {getVariableValues} from 'graphql';
import documents from './app-documents.json';
import serviceSchema from './service-schema.json';
import {graphql, type Send} from './transport.ts';

export const schema = buildClientSchema(serviceSchema as any);
export const operations = [...new Map(documents.operations.filter(op=>op.exposedByDefault).map(op=>[op.name,op])).values()].map(op=> {
  let document=op.composedDocument;
  // Explicit adaptations to live schema; retained APK documents remain unchanged.
  if(op.name==='OrgInvite') document=document.replace('orgInvite(id:', 'orgInvite(joinId:');
  if(op.name==='RequestTrip') document=document.replace('paymentId: $paymentId','paymentMethod: $paymentId');
  const ast=parse(document); const errors=validate(schema,ast);
  if(errors.length) throw new Error(`Stale operation ${op.name}: ${errors[0].message}`);
  return {...op,document,ast,toolName:'hopp_'+op.name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase()};
});
export function redact(value: unknown, key=''): unknown {
  if (/token|phone|pin|password|secret|ticket|card|payment|email|address|latitude|longitude|^lat$|^lng$|log|location|name|content|description|message|route|code|image|document/i.test(key)) return '[redacted]';
  if(Array.isArray(value)) return value.map(v=>redact(v,key));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
  return value;
}
export function getOperation(name: string) {
  const op=operations.find(o=>o.name===name || o.toolName===name);
  if(!op) throw new Error('Unknown customer operation; use operations');
  return op;
}
export function validateVariables(name: string, variables: Record<string,unknown>) {
  const op=getOperation(name);const definition=getOperationAST(op.ast,op.name)!;
  const known=new Set(definition.variableDefinitions?.map(v=>v.variable.name.value));
  for(const key of Object.keys(variables)) if(!known.has(key)) throw new Error(`Unknown variable: ${key}`);
  for(const [key,value] of Object.entries(op.variableRestrictions)) if(variables[key]!==undefined && variables[key]!==value) throw new Error(`Customer operation requires ${key}=${value}`);
  const result=getVariableValues(schema,definition.variableDefinitions??[],{...variables,...op.variableRestrictions});
  if(result.errors) throw new Error('Variables do not match the recovered service schema; use schema OPERATION. Values omitted for privacy.');
  function coordinates(value: unknown): void {
    if(Array.isArray(value)) {for(const item of value)coordinates(item);return;}
    if(value && typeof value==='object')for(const [key,item] of Object.entries(value)) {
      if(item!==null && item!==undefined && ['latitude','lat','longitude','lng'].includes(key)) {
        const bound=['latitude','lat'].includes(key)?90:180;
        if(typeof item!=='number'||!Number.isFinite(item)||Math.abs(item)>bound)throw new Error('Coordinates out of range');
      }
      coordinates(item);
    }
  }
  coordinates(result.coerced);
  return result.coerced!;
}
export function inputSchema(name: string): Record<string,any> {
  const op=getOperation(name);const def=getOperationAST(op.ast,op.name)!;
  const defs: Record<string,any>={};
  function convert(type: GraphQLInputType): any {
    if(isNonNullType(type)) return nonnull(type.ofType);
    return {anyOf:[nonnull(type),{type:'null'}]};
  }
  function nonnull(type: GraphQLInputType): any {
    if(isNonNullType(type)) return nonnull(type.ofType);
    if(isListType(type)) return {type:'array',items:convert(type.ofType)};
    if(isInputObjectType(type)) {
      if(!defs[type.name]) {
        defs[type.name]={type:'object',properties:{},additionalProperties:false};
        const required:string[]=[];
        for(const field of Object.values(type.getFields())) {defs[type.name].properties[field.name]=convert(field.type);if(isNonNullType(field.type)&&field.defaultValue===undefined)required.push(field.name);}
        if(required.length)defs[type.name].required=required;
      }
      return {$ref:'#/$defs/'+type.name};
    }
    if(isEnumType(type))return {type:'string',enum:type.getValues().map(v=>v.name)};
    if(type.name==='Int')return {type:'integer',minimum:-2147483648,maximum:2147483647};
    if(type.name==='Float')return {type:'number'};
    if(type.name==='Boolean')return {type:'boolean'};
    if(type.name==='ID')return {anyOf:[{type:'string'},{type:'integer'}]};
    if(['JSON','JSONObject','Object','Upload'].includes(type.name))return {description:`Opaque ${type.name} scalar; provider workflow semantics not verified`};
    return {type:'string'};
  }
  const properties: Record<string,any>={};const required:string[]=[];
  for(const variable of def.variableDefinitions??[]) {
    const name=variable.variable.name.value;properties[name]=convert(typeFromAST(schema,variable.type) as GraphQLInputType);
    if(variable.type.kind==='NonNullType'&&!variable.defaultValue)required.push(name);
  }
  return {type:'object',properties,required,additionalProperties:false,...Object.keys(defs).length?{$defs:defs}:{}};
}
export async function execute(name: string,variables: Record<string,unknown>={},confirm=false,send?: Send) {
  const op=getOperation(name);const checked=validateVariables(name,variables);
  if(op.effect!=='read'&&!confirm) return {dryRun:true,operation:op.name,effect:op.effect,variables:redact(checked),schema:'live introspection; provider scalar semantics may be opaque'};
  if(op.effect==='auth'&&process.env.HOPP_AUTH_ENABLE_WRITES!=='1')throw new Error('Auth changes require HOPP_AUTH_ENABLE_WRITES=1');
  return graphql(op.document,op.name,checked,op.effect!=='read',send);
}
