import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SCRIPT_SCOPES, createPriceRefreshRunner } from '../scripts/local-google/price-refresh.mjs';
const deploymentId='test-deployment-id-1234567890';
function fixture() {
 const calls=[];
 const client={credentials:{scope:SCRIPT_SCOPES.join(' '),expiry_date:Date.now()+3600_000},async getAccessToken(){},async refreshAccessToken(){calls.push('token-refresh')},async request(options){calls.push(options);return {data:{done:true,response:{result:{status:'success',updated:16,failed:[],updatedAt:'2026-10-26T05:30:00.000Z'}}}}}};
 return {calls,client,run:createPriceRefreshRunner({deploymentId})};
}
test('successful refresh invokes only the fixed function and preserves partial failures',async()=>{
 const f=fixture();f.client.request=async options=>{f.calls.push(options);return {data:{done:true,response:{result:{status:'success',updated:14,failed:['2330','0050'],updatedAt:'2026-10-26T05:30:00.000Z'}}}}};
 const result=await f.run({client:f.client,sessionKey:'session',requestId:randomUUID()});assert.equal(result.updated,14);assert.deepEqual(result.failed,['2330','0050']);assert.equal(f.calls[0].data.function,'stockfolioRefreshCurrentPrices');assert.equal(f.calls[0].retry,false);assert.equal(f.calls[0].timeout,380000);
});
test('same click is deduplicated and different concurrent clicks are rejected',async()=>{
 const f=fixture();let release;const waiting=new Promise(resolve=>{release=resolve});const base=f.client.request;
 f.client.request=async options=>{await waiting;return base(options)};const requestId=randomUUID();const params={client:f.client,sessionKey:'session',requestId};const first=f.run(params);const duplicate=f.run(params);
 await assert.rejects(f.run({...params,requestId:randomUUID()}),error=>error.status==='in_progress');release();assert.deepEqual(await first,await duplicate);assert.equal(f.calls.length,1);await f.run(params);assert.equal(f.calls.length,1);
});
test('uncertain execution is never automatically replayed',async()=>{
 const f=fixture();f.client.request=async options=>{f.calls.push(options);throw new Error('network timeout')};const params={client:f.client,sessionKey:'session',requestId:randomUUID()};
 await assert.rejects(f.run(params),error=>error.status==='execution_unconfirmed');await assert.rejects(f.run(params),error=>error.status==='execution_unconfirmed');assert.equal(f.calls.length,1);
});
test('HTTP success with script errors, unfinished operations, busy or invalid results is not update success',async()=>{
 for(const data of [{done:true,error:{message:'script failed'}},{done:false},{done:true,response:{result:{status:'busy'}}},{done:true,response:{result:{status:'empty'}}},{done:true,response:{result:{status:'success',updated:16,failed:[],updatedAt:'invalid'}}}]){
  const f=fixture();f.client.request=async()=>({data});await assert.rejects(f.run({client:f.client,sessionKey:'session',requestId:randomUUID()}));
 }
});
test('configuration, request IDs and write permissions are validated before execution',async()=>{
 const f=fixture();await assert.rejects(createPriceRefreshRunner({deploymentId:''})({client:f.client,sessionKey:'session',requestId:randomUUID()}),error=>error.status==='configuration_required');
 await assert.rejects(f.run({client:f.client,sessionKey:'session',requestId:'not-a-uuid'}),error=>error.status==='invalid_request');
 f.client.credentials.scope='https://www.googleapis.com/auth/spreadsheets.readonly';await assert.rejects(f.run({client:f.client,sessionKey:'session',requestId:randomUUID()}),error=>error.status==='reauthentication_required');assert.equal(f.calls.length,0);
});
test('an expiring token is refreshed before starting the long-running script',async()=>{
 const f=fixture();f.client.credentials.expiry_date=Date.now()+60_000;await f.run({client:f.client,sessionKey:'session',requestId:randomUUID()});assert.equal(f.calls[0],'token-refresh');assert.equal(f.calls.length,2);
});
test('a token refresh that omits scope retains the previously verified grant',async()=>{
 const f=fixture();f.client.credentials.expiry_date=Date.now()+60_000;
 f.client.refreshAccessToken=async()=>{f.calls.push('token-refresh');f.client.credentials={access_token:'refreshed',expiry_date:Date.now()+3600_000}};
 await f.run({client:f.client,sessionKey:'session',requestId:randomUUID()});
 await f.run({client:f.client,sessionKey:'session',requestId:randomUUID()});assert.equal(f.client.credentials.scope,SCRIPT_SCOPES.join(' '));assert.equal(f.calls.length,3);
});
test('the Apps Script API wrapper opens the fixed spreadsheet and reuses the menu function',async()=>{
 const source=await readFile(new URL('../google-apps-script/stockfolio-api.gs',import.meta.url),'utf8');let target,argument;
 const spreadsheet={getSheetByName(){return {getLastRow(){return 17},getRange(){return {canEdit(){return true}}}}}};const context={SpreadsheetApp:{openById(id){target=id;return spreadsheet}},refreshCurrentPrices(event){argument=event;return {status:'success',updated:16}}};vm.runInNewContext(source,context);
 assert.equal(context.stockfolioRefreshCurrentPrices('other-sheet').updated,16);assert.equal(target,'1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70');assert.equal(argument.source,spreadsheet);
});

test('the fixed Apps Script entry rejects viewers before updating prices',async()=>{
 const source=await readFile(new URL('../google-apps-script/stockfolio-api.gs',import.meta.url),'utf8');let writes=0;
 const context={SpreadsheetApp:{openById(){return {getSheetByName(){return {getLastRow(){return 17},getRange(){return {canEdit(){return false}}}}}}}},refreshCurrentPrices(){writes++}};vm.runInNewContext(source,context);assert.equal(context.stockfolioRefreshCurrentPrices().status,'forbidden');assert.equal(writes,0);
});
