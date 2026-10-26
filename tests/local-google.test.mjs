import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalGoogleMiddleware, GOOGLE_SCOPE } from '../scripts/local-google/server.mjs';

async function fixture(t, options={}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stockfolio-oauth-test-'));
  const calls = { exchanges:0, requests:[], verifier:null, failure:null, scope:GOOGLE_SCOPE };
  const factory = () => ({
    credentials:{},
    async generateCodeVerifierAsync(){return {codeVerifier:'test-verifier',codeChallenge:'test-challenge'}},
    generateAuthUrl(args){const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [k,v] of Object.entries(args))url.searchParams.set(k,String(v));return url.href},
    async getToken(args){calls.exchanges++;calls.verifier=args.codeVerifier;return {tokens:{access_token:'test-access-token',refresh_token:'test-refresh-token',scope:calls.scope}}},
    setCredentials(tokens){this.credentials=tokens},
    async request(args){calls.requests.push(args);if(calls.wait)await calls.wait;if(calls.failure)throw calls.failure;this.credentials.access_token='refreshed-access-token';return {data:{range:"'庫存總覽'!A1:Q1000",values:[['股票代號'],['0050']]}}},
  });
  let middleware;
  const server=http.createServer((req,res)=>{Promise.resolve(middleware(req,res,()=>{res.statusCode=404;res.end()})).catch(()=>{res.statusCode=500;res.end()})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const env={GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-client-secret',GOOGLE_REDIRECT_URI:origin+'/api/auth/google/callback',...options.env};
  const initialize=()=>createLocalGoogleMiddleware({root,env,clientFactory:factory,...(options.now?{now:options.now}:{})});
  middleware=initialize();
  const request=(url,init={})=>fetch(origin+url,{redirect:'manual',...init});
  const post=(source,cookie='',headers={})=>request('/api/portfolio',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify({source})});
  async function start(){const response=await request('/api/auth/google/start');return {cookie:response.headers.getSetCookie()[0].split(';')[0],url:new URL(response.headers.get('location'))}}
  async function login(){const flow=await start();const response=await request('/api/auth/google/callback?state='+flow.url.searchParams.get('state')+'&code=test-code',{headers:{Cookie:flow.cookie}});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/?google_auth=connected');return response.headers.getSetCookie().find(c=>c.startsWith('stockfolio_google_session=')).split(';')[0]}
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})});
  return {root,calls,origin,request,post,start,login,restart(){middleware=initialize()}};
}

test('missing configuration and anonymous reads fail without exposing secrets',async t=>{
 const f=await fixture(t,{env:{GOOGLE_CLIENT_SECRET:''}});
 const status=await (await f.request('/api/auth/google/status')).json();assert.equal(status.configured,false);assert.deepEqual(status.missing,['GOOGLE_CLIENT_SECRET']);
 const response=await f.post('holdings');assert.equal(response.status,503);assert.equal((await response.json()).status,'configuration_required');assert.equal(f.calls.requests.length,0);
});
test('OAuth uses browser-bound state, PKCE and read-only scope; replay is denied',async t=>{
 const f=await fixture(t);const flow=await f.start();assert.equal(flow.url.searchParams.get('scope'),GOOGLE_SCOPE);assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');assert.equal(flow.url.searchParams.get('access_type'),'offline');
 assert.equal(flow.cookie.includes('test-client-secret'),false);
 const mismatch=await f.request('/api/auth/google/callback?state=wrong&code=test',{headers:{Cookie:flow.cookie}});assert.equal(mismatch.headers.get('location'),'/?google_auth=expired');assert.equal(f.calls.exchanges,0);
 const ok=await f.start();const callback='/api/auth/google/callback?state='+ok.url.searchParams.get('state')+'&code=test';
 const unbound=await f.request(callback);assert.equal(unbound.headers.get('location'),'/?google_auth=expired');assert.equal(f.calls.exchanges,0);
 const response=await f.request(callback,{headers:{Cookie:ok.cookie}});assert.equal(response.headers.get('location'),'/?google_auth=connected');assert.equal(f.calls.verifier,'test-verifier');
 const replay=await f.request(callback,{headers:{Cookie:ok.cookie}});assert.equal(replay.headers.get('location'),'/?google_auth=expired');assert.equal(f.calls.exchanges,1);
});
test('expired state and denied scope cannot establish sessions',async t=>{
 let now=Date.now();const f=await fixture(t,{now:()=>now});const flow=await f.start();now+=11*60*1000;
 const expired=await f.request('/api/auth/google/callback?state='+flow.url.searchParams.get('state')+'&code=test',{headers:{Cookie:flow.cookie}});assert.equal(expired.headers.get('location'),'/?google_auth=expired');assert.equal(f.calls.exchanges,0);
 f.calls.scope='openid';const next=await f.start();const denied=await f.request('/api/auth/google/callback?state='+next.url.searchParams.get('state')+'&code=test',{headers:{Cookie:next.cookie}});assert.equal(denied.headers.get('location'),'/?google_auth=scope');assert.equal(denied.headers.getSetCookie().some(c=>c.startsWith('stockfolio_google_session=')),false);
});
test('authenticated reads are fixed to the stock sheet; sessions survive restart and tokens stay server-side',async t=>{
 const f=await fixture(t);const cookie=await f.login();
 const response=await f.post('holdings',cookie);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.text();assert.ok(body.includes('0050'));assert.ok(!body.includes('test-access-token'));assert.ok(!body.includes('test-client-secret'));assert.equal(f.calls.requests[0].url.includes('1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70'),true);assert.equal(f.calls.requests[0].params.valueRenderOption,'UNFORMATTED_VALUE');
 const unknown=await f.post('__proto__',cookie);assert.equal(unknown.status,400);
 const files=await readdir(path.join(f.root,'.sites-runtime/google-oauth'));assert.equal(files.length,1);assert.equal((await stat(path.join(f.root,'.sites-runtime/google-oauth',files[0]))).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(path.join(f.root,'.sites-runtime/google-oauth',files[0]),'utf8')).tokens.access_token,'refreshed-access-token');
 f.restart();assert.equal((await (await f.request('/api/auth/google/status',{headers:{Cookie:cookie}})).json()).connected,true);assert.equal((await f.post('holdings',cookie)).status,200);
});
test('cross-origin requests, forged sessions and revoked grants are rejected',async t=>{
 const f=await fixture(t);assert.equal((await f.post('holdings')).status,401);assert.equal((await f.post('holdings','stockfolio_google_session='+'a'.repeat(43))).status,401);
 assert.equal((await f.post('holdings','',{Origin:'https://example.com'})).status,403);
 const crossLogin=await f.request('/api/auth/google/start',{headers:{Origin:'https://example.com'}});assert.equal(crossLogin.status,403);
 const invalidHost=await new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api/auth/google/status',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()});assert.equal(invalidHost,403);
 const cookie=await f.login();f.calls.failure={response:{status:401,data:{error:'invalid_grant'}}};assert.equal((await f.post('holdings',cookie)).status,401);assert.equal((await (await f.request('/api/auth/google/status',{headers:{Cookie:cookie}})).json()).connected,false);
});
test('logout requires same origin, deletes local session and prevents further reads',async t=>{
 const f=await fixture(t);const cookie=await f.login();
 const denied=await f.request('/api/auth/google/logout',{method:'POST',headers:{Origin:'https://example.com',Cookie:cookie}});assert.equal(denied.status,403);
 const response=await f.request('/api/auth/google/logout',{method:'POST',headers:{Origin:f.origin,Cookie:cookie}});assert.equal((await response.json()).status,'success');assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));assert.equal((await f.post('holdings',cookie)).status,401);
});

test('logout during an in-flight read cannot restore a deleted session or return portfolio data',async t=>{
 const f=await fixture(t);const cookie=await f.login();let release;f.calls.wait=new Promise(resolve=>{release=resolve});
 const pending=f.post('holdings',cookie);while(!f.calls.requests.length)await new Promise(resolve=>setTimeout(resolve,1));
 await f.request('/api/auth/google/logout',{method:'POST',headers:{Origin:f.origin,Cookie:cookie}});release();
 const response=await pending;assert.equal(response.status,401);assert.equal((await readdir(path.join(f.root,'.sites-runtime/google-oauth'))).length,0);
 f.restart();assert.equal((await (await f.request('/api/auth/google/status',{headers:{Cookie:cookie}})).json()).connected,false);
});

test('a loopback redirect may carry cross-site navigation metadata; cross-site background requests stay denied',async t=>{
 const f=await fixture(t);
 async function raw(headers){return new Promise((resolve,reject)=>{const req=http.request(f.origin+'/api/auth/google/start',{headers},res=>{res.resume();resolve({status:res.statusCode,location:res.headers.location})});req.on('error',reject);req.end()})}
 const navigate=await raw({'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'});assert.equal(navigate.status,303);assert.ok(navigate.location.startsWith('https://accounts.google.com/'));
 assert.equal((await raw({'sec-fetch-site':'cross-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty'})).status,403);
 assert.equal((await raw({'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'})).status,403);
 assert.equal((await raw({'purpose':'prefetch'})).status,204);
});
