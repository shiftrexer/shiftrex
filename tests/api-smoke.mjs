import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest} from '../functions/api/[[path]].js';
import assert from 'node:assert/strict';

const native=new DatabaseSync(':memory:');
for(const v of ['001_initial_schema.sql','002_production.sql'])native.exec(readFileSync(new URL('../database/'+v,import.meta.url),'utf8'));
const db={
 prepare(sql){const values=[];const stmt={bind(...args){values.push(...args);return stmt;},async first(){const v=native.prepare(sql).get(...values);return v||null;},async all(){return {results:native.prepare(sql).all(...values)};},async run(){const v=native.prepare(sql).run(...values);return {meta:{changes:v.changes}};}};return stmt;},
 async batch(list){native.exec('BEGIN');try{const result=[];for(const stmt of list)result.push(await stmt.run());native.exec('COMMIT');return result;}catch(e){native.exec('ROLLBACK');throw e;}}
};
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{if(String(url).includes('api.resend.com'))throw Error('Email service must never be called');if(String(url).includes('api.line.me/oauth2/v2.1/token'))return Response.json({id_token:'testing'});if(String(url).includes('api.line.me/oauth2/v2.1/verify'))return Response.json({sub:'LINE-USER-1',aud:'1234567',iss:'https://access.line.me',nonce:new URLSearchParams(options.body).get('nonce')});return realFetch(url,options)};
const env={DB:db,SETUP_TOKEN:'x'.repeat(40),PASSWORD_PEPPER:'p'.repeat(40),LINE_CHANNEL_ID:'1234567',LINE_CHANNEL_SECRET:'mock'};
async function derivePassword(password,salt){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const r=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:210000},k,256);return Buffer.from(r).toString('hex')}
async function request(path,body,cookie='',method='POST'){
 const headers={'origin':'https://shiftrex.pages.dev','content-type':'application/json'};if(cookie)headers.cookie=cookie;
 const req=new Request('https://shiftrex.pages.dev/api/'+path,{method,headers,body:method==='POST'?JSON.stringify(body||{}):undefined});
 const response=await onRequest({request:req,env});let obj;try{obj=await response.clone().json();}catch(e){obj={};}
 return {response,obj,location:response.headers.get('location'),cookie:response.headers.get('set-cookie')};
}
let r=await request('auth/me',{},'','GET');assert.equal(r.obj.adminConfigured,false);
const passwordSalt='0'.repeat(64);const passwordVerifier=await derivePassword('longlonglongpassword',passwordSalt);r=await request('setup/owner',{setupToken:'x'.repeat(40),name:'オーナー',email:'owner@example.com',passwordSalt,passwordVerifier});assert.equal(r.response.status,200,JSON.stringify(r.obj));
r=await request('setup/owner',{setupToken:'x'.repeat(40),name:'オーナー',email:'owner@example.com',passwordSalt,passwordVerifier});assert.equal(r.response.status,409);
r=await request('auth/admin/salt',{email:'owner@example.com'});assert.equal(r.obj.salt,passwordSalt);r=await request('auth/admin/login',{email:'owner@example.com',passwordVerifier});assert.equal(r.response.status,200,JSON.stringify(r.obj));
const challengeId=r.obj.challengeId;assert.equal(r.obj.mode,'totp');assert.match(r.obj.setup?.secret||'',/^[A-Z2-7]{32}$/);
function base32Decode(secret){let b=0,n=0,a=[];for(const c of secret){n=(n<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);b+=5;if(b>=8)a.push((n>>>(b-=8))&255);}return new Uint8Array(a);}
async function authenticatorCode(seed){const k=await crypto.subtle.importKey('raw',base32Decode(seed),{name:'HMAC',hash:'SHA-1'},false,['sign']);const counter=new ArrayBuffer(8);new DataView(counter).setUint32(4,Math.floor(Date.now()/30000),false);const mac=new Uint8Array(await crypto.subtle.sign('HMAC',k,counter));const o=mac[19]&15;return String(((((mac[o]&127)<<24)|((mac[o+1]&255)<<16)|((mac[o+2]&255)<<8)|(mac[o+3]&255))%1000000)).padStart(6,'0');}
const code=await authenticatorCode(r.obj.setup.secret);
r=await request('auth/admin/verify',{challengeId,code});assert.equal(r.response.status,200,JSON.stringify(r.obj));const staffCookie=r.cookie.split(';')[0];
let reused=await request('auth/admin/login',{email:'owner@example.com',passwordVerifier});assert.equal(reused.response.status,200,JSON.stringify(reused.obj));assert.equal(reused.obj.setup,null,'TOTP secret must not be revealed after enrollment');
reused=await request('auth/admin/verify',{challengeId:reused.obj.challengeId,code});assert.equal(reused.response.status,401,JSON.stringify(reused.obj));
r=await request('admin/members',{name:'テスト会員',kana:'テストカイイン'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const mid=r.obj.id;
r=await request('admin/menus',{name:'8回券',price:52800,count:8,days:70,monthRequired:false},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const menuId=r.obj.id;
r=await request('admin/purchases',{memberId:mid,menuId,price:52800,date:'2026-11-20'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const purchaseId=r.obj.id;
r=await request('admin/payments',{purchaseId,amount:52800,method:'現金',date:'2026-11-20'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));
r=await request('admin/slots',{date:'2026-11-25',time:'10:00',mode:'instant'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const slot=r.obj.id;
r=await request('admin/slots',{date:'2026-11-25',time:'10:30',mode:'instant'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const conflictSlot=r.obj.id;
r=await request('admin/publish',{month:'2026-11'},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));
r=await request('admin/invites',{memberId:mid},staffCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));const invite=new URL(r.obj.inviteUrl).searchParams.get('invite');
const startReq=new Request('https://shiftrex.pages.dev/api/auth/line/start?invite='+invite);
const started=await onRequest({request:startReq,env});assert.equal(started.status,302);const oauthState=new URL(started.headers.get('location')).searchParams.get('state');const oauthCookie=started.headers.get('set-cookie').split(';')[0];
const callbackReq=new Request('https://shiftrex.pages.dev/api/auth/line/callback?code=test&state='+oauthState,{headers:{cookie:oauthCookie}});
const callback=await onRequest({request:callbackReq,env});assert.equal(callback.status,302);const memberCookie=callback.headers.get('set-cookie').split(';')[0];
r=await request('member/state',{},memberCookie,'GET');assert.equal(r.response.status,200,JSON.stringify(r.obj));assert.equal(r.obj.tickets.length,1);
r=await request('member/bookings',{slotId:slot},memberCookie);assert.equal(r.response.status,200,JSON.stringify(r.obj));assert.equal(r.obj.status,'confirmed');
r=await request('member/bookings',{slotId:conflictSlot},memberCookie);assert.equal(r.response.status,409,JSON.stringify(r.obj));
assert.equal(native.prepare('SELECT available_count FROM tickets').get().available_count,7);
const firstBooking=native.prepare("SELECT id FROM booking_requests WHERE status='confirmed'").get().id;
r=await request('admin/cancel-booking',{id:firstBooking,returnTicket:true},staffCookie);
assert.equal(r.response.status,200,JSON.stringify(r.obj));
assert.equal(native.prepare('SELECT available_count FROM tickets').get().available_count,8);
r=await request('admin/cancel-booking',{id:firstBooking,returnTicket:true},staffCookie);
assert.equal(r.response.status,409,JSON.stringify(r.obj));
assert.equal(native.prepare('SELECT available_count FROM tickets').get().available_count,8);
console.log('PASS owner setup / offline TOTP / member create / ticket issuance / LINE invite + callback / booking lock / exactly-once cancel refund');
