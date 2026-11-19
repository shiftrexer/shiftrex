/* SHIFTREX API — Cloudflare Pages Functions + D1. No demo/localStorage writes. */
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
const fail=(message,status=400)=>json({error:message},status);
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const bytes=n=>crypto.getRandomValues(new Uint8Array(n));
const hex=a=>Array.from(a).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>hex(bytes(32));
const sha=async s=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const formBytes=s=>new TextEncoder().encode(s);
const b64url=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const validMonth=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const jstDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const expAt=hours=>new Date(Date.now()+hours*3600000).toISOString();
const cookie=(token,days=14)=>`sr_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${days*86400}`;
const clearCookie='sr_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
const oauthCookie=(token)=>`sr_oauth=${token}; Path=/api/auth/line; Secure; HttpOnly; SameSite=Lax; Max-Age=600`;
const expireOAuth='sr_oauth=; Path=/api/auth/line; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
const readCookie=(req,name)=>req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const field=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const money=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
const audit=(db,actor,action,type,id,details={})=>db.prepare('INSERT INTO audit_log(id,actor_id,actor_type,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid(),actor.id,actor.type,action,type,id,JSON.stringify(details),now());
const query=(db,sql,...args)=>args.length?db.prepare(sql).bind(...args):db.prepare(sql);
const list=async(db,sql,...args)=>(await query(db,sql,...args).all()).results||[];
const one=async(db,sql,...args)=>query(db,sql,...args).first();
const matches=async(a,b)=>{const ha=await sha(String(a));const hb=await sha(String(b));let diff=0;for(let i=0;i<ha.length;i++)diff|=ha.charCodeAt(i)^hb.charCodeAt(i);return diff===0;};
const passwordPepper=async(pepper,salt,verifier)=>{
 const key=await crypto.subtle.importKey('raw',formBytes(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const value=await crypto.subtle.sign('HMAC',key,formBytes(salt+':'+verifier));
 return hex(new Uint8Array(value));
};
// RFC 6238 TOTP; no email provider. Encrypt seeds with a key derived from PASSWORD_PEPPER.
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const toB32=buf=>{let n=0,b=0,out='';for(const x of buf){n=(n<<8)|x;b+=8;while(b>=5)out+=B32[(n>>>(b-=5))&31];}if(b)out+=B32[(n<<(5-b))&31];return out;};
const fromB32=str=>{let n=0,b=0,out=[];for(const c of str){const k=B32.indexOf(c);if(k<0)throw Error('bad_seed');n=(n<<5)|k;b+=5;if(b>=8)out.push((n>>>(b-=8))&255);}return new Uint8Array(out);};
const decodeUrl=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const seedKey=async pepper=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',formBytes('SHIFTREX/TOTP/v1/'+pepper)),{name:'AES-GCM'},false,['encrypt','decrypt']);
const sealSeed=async(pepper,seed)=>{const iv=bytes(12);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await seedKey(pepper),formBytes(seed)));return 'v1.'+b64url(iv)+'.'+b64url(cipher);};
const openSeed=async(pepper,value)=>{const a=value.split('.');if(a.length!==3||a[0]!=='v1')throw Error('invalid_seed');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decodeUrl(a[1])},await seedKey(pepper),decodeUrl(a[2])));};
const generateCode=async(seed,step)=>{const k=await crypto.subtle.importKey('raw',fromB32(seed),{name:'HMAC',hash:'SHA-1'},false,['sign']);const a=new ArrayBuffer(8);new DataView(a).setUint32(4,step,false);const mac=new Uint8Array(await crypto.subtle.sign('HMAC',k,a));const o=mac[19]&15;return String(((((mac[o]&127)<<24)|((mac[o+1]&255)<<16)|((mac[o+2]&255)<<8)|(mac[o+3]&255))%1000000)).padStart(6,'0');};
const checkTOTP=async(seed,code,used)=>{if(!/^\d{6}$/.test(code))return null;const step=Math.floor(Date.now()/30000);for(const n of [step-1,step,step+1])if(n>used&&await matches(await generateCode(seed,n),code))return n;return null;};
const otpKey=id=>'staff_totp:'+id;
const otpRow=async(db,id)=>{const row=await one(db,'SELECT value_json FROM system_settings WHERE key=?',otpKey(id));return row?{raw:row.value_json,...JSON.parse(row.value_json)}:null;};
const failAuth=async(db,email)=>{const row=await one(db,'SELECT failures FROM login_throttles WHERE email=?',email);const count=(row?.failures||0)+1;await query(db,"INSERT INTO login_throttles(email,failures,blocked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at",email,count,count>=5?expAt(.25):null,now()).run();};
const requireOwner=a=>a?.type==='staff'&&a.role==='owner';
const requireAdmin=a=>a?.type==='staff'&&['owner','manager','staff'].includes(a.role);
const requireManager=a=>a?.type==='staff'&&['owner','manager'].includes(a.role);
const redirect=(location,headers={})=>new Response(null,{status:302,headers:{location,'cache-control':'no-store',...headers}});

async function session(ctx){
 const token=readCookie(ctx.request,'sr_session');if(!/^[0-9a-f]{64}$/.test(token))return null;
 const tok=await sha(token);
 const row=await one(ctx.env.DB,`SELECT s.user_id,s.user_type,s.expires_at,st.role,st.display_name AS staff_name,st.status AS staff_status,m.display_name AS member_name,m.status AS member_status
   FROM auth_sessions s LEFT JOIN staff_accounts st ON s.user_type='staff' AND s.user_id=st.id
   LEFT JOIN members m ON s.user_type='member' AND s.user_id=m.id
   WHERE s.token_hash=? AND s.expires_at>?`,tok,now());
 if(!row)return null;
 if(row.user_type==='staff'&&row.staff_status==='active')return{id:row.user_id,type:'staff',role:row.role,name:row.staff_name};
 if(row.user_type==='member'&&row.member_status!=='left'&&row.member_name)return{id:row.user_id,type:'member',name:row.member_name};
 return null;
}
async function newSession(db,type,id,days){const token=random();await query(db,'INSERT INTO auth_sessions(token_hash,user_type,user_id,expires_at,created_at) VALUES(?,?,?,?,?)',await sha(token),type,id,expAt(days*24),now()).run();return token;}
async function issueTicket(db,purchaseId){
 const p=await one(db,`SELECT p.*,m.ticket_count,m.validity_days FROM purchases p JOIN menus m ON m.id=p.menu_id WHERE p.id=?`,purchaseId);
 if(!p||p.canceled_at||p.ticket_count<=0)return;
 const total=await one(db,'SELECT COALESCE(SUM(amount_yen),0) AS amount FROM payments WHERE purchase_id=? AND deleted_at IS NULL',purchaseId);
 if(total.amount<p.actual_price_yen)return;
 const expiry=p.validity_days?new Date(Date.parse(p.purchased_on+'T00:00:00Z')+(p.validity_days-1)*86400000).toISOString().slice(0,10):null;
 await query(db,`INSERT OR IGNORE INTO tickets(id,member_id,purchase_id,initial_count,available_count,valid_from,expires_on,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?)`,uid(),p.member_id,p.id,p.ticket_count,p.ticket_count,p.purchased_on,expiry,now(),now()).run();
}
async function availableTicket(db,memberId,slotId){return one(db,`SELECT t.id FROM tickets t JOIN booking_slots s ON s.id=?
 WHERE t.member_id=? AND t.available_count>0 AND t.disabled_at IS NULL
 AND t.valid_from<=substr(s.starts_at,1,10) AND (t.expires_on IS NULL OR t.expires_on>=substr(s.starts_at,1,10))
 ORDER BY COALESCE(t.expires_on,'9999-12-31'),t.created_at LIMIT 1`,slotId,memberId);}
async function slotAllowed(db,slotId,memberId){
 const slot=await one(db,`SELECT s.*,m.status,m.paused_from,m.paused_through FROM booking_slots s JOIN members m ON m.id=? WHERE s.id=?`,memberId,slotId);
 if(!slot||!slot.enabled||slot.status!=='active')return null;
 const day=slot.starts_at.slice(0,10),month=day.slice(0,7);
 // The stored slot is JST wall time; convert explicitly to UTC for cutoff checks.
 const utcMs=Date.parse(slot.starts_at+':00+09:00');
 const cutoff=await one(db,"SELECT value_json FROM system_settings WHERE key='booking_cutoff_hours'");
 const cutoffHours=cutoff?Number(JSON.parse(cutoff.value_json)):3;
 if(!Number.isFinite(utcMs)||utcMs<Date.now()+Math.max(0,Math.min(168,cutoffHours))*3600000)return null;
 if(slot.paused_from&&slot.paused_through&&day>=slot.paused_from&&day<=slot.paused_through)return null;
 if(!await one(db,'SELECT month_key FROM published_months WHERE month_key=?',month))return null;
 return slot;
}
async function adminState(db){
 await ensureBodyRecords(db);
 const [members,slots,requests,tickets,menus,purchases,payments,notices,records]=await Promise.all([
 list(db,'SELECT id,display_name,name_kana,phone,email,joined_on,status,paused_from,paused_through,leave_on,CASE WHEN line_subject IS NULL THEN 0 ELSE 1 END AS line_linked FROM members ORDER BY created_at DESC LIMIT 300'),
 list(db,'SELECT id,starts_at,ends_at,mode,enabled FROM booking_slots WHERE starts_at>=? ORDER BY starts_at LIMIT 600',jstDay()),
 list(db,`SELECT r.id,r.slot_id,r.member_id,r.status,r.ticket_id,r.created_at,r.decline_reason,s.starts_at,m.display_name AS member_name FROM booking_requests r JOIN booking_slots s ON s.id=r.slot_id JOIN members m ON m.id=r.member_id WHERE s.starts_at>=? ORDER BY s.starts_at LIMIT 500`,jstDay()),
 list(db,'SELECT * FROM tickets ORDER BY created_at DESC LIMIT 500'),
 list(db,'SELECT id,name,standard_price_yen,ticket_count,validity_days,target_month_required,hidden FROM menus WHERE deleted_at IS NULL ORDER BY created_at LIMIT 100'),
 list(db,'SELECT id,member_id,menu_id,menu_name_at_sale,purchased_on,target_month,actual_price_yen,canceled_at FROM purchases ORDER BY created_at DESC LIMIT 300'),
 list(db,'SELECT id,purchase_id,paid_on,amount_yen,method_name_snapshot FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500'),
 list(db,'SELECT id,title,body,published_at FROM notices WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50'),
 list(db,'SELECT r.id,r.member_id,m.display_name,r.record_date,r.weight_kg,r.body_fat_pct,r.updated_at FROM body_records r JOIN members m ON m.id=r.member_id ORDER BY r.record_date DESC LIMIT 1000')
 ]);
 return{members,slots,requests,tickets,menus,purchases,payments,notices,records};
}
async function ensureBodyRecords(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS body_records (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
 record_date TEXT NOT NULL,
 weight_kg REAL NOT NULL CHECK(weight_kg>=20 AND weight_kg<=300),
 body_fat_pct REAL NOT NULL CHECK(body_fat_pct>=1 AND body_fat_pct<=70),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(member_id,record_date)
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS body_records_member_date_idx ON body_records(member_id,record_date DESC)').run();
}
async function memberState(db,actor){
 await ensureBodyRecords(db);
 const [slots,bookings,tickets,notices,records]=await Promise.all([
 list(db,`SELECT s.id,s.starts_at,s.ends_at,s.mode,s.enabled,CASE WHEN EXISTS(SELECT 1 FROM booking_locks l WHERE l.block_start=substr(s.starts_at,1,16)) THEN 1 ELSE 0 END AS booked
 FROM booking_slots s JOIN published_months p ON p.month_key=substr(s.starts_at,1,7)
 WHERE s.starts_at>=? AND s.starts_at<? ORDER BY s.starts_at LIMIT 1000`,jstDay(),new Date(Date.now()+95*86400000).toISOString().slice(0,10)),
 list(db,`SELECT r.id,r.status,r.slot_id,r.decline_reason,r.created_at,s.starts_at FROM booking_requests r JOIN booking_slots s ON s.id=r.slot_id WHERE r.member_id=? ORDER BY r.created_at DESC,s.starts_at DESC,r.id DESC LIMIT 150`,actor.id),
 list(db,`SELECT t.id,t.initial_count,t.available_count,t.valid_from,t.expires_on FROM tickets t WHERE t.member_id=? AND t.disabled_at IS NULL ORDER BY COALESCE(t.expires_on,'9999') LIMIT 100`,actor.id),
 list(db,`SELECT id,title,body,published_at FROM notices WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at<=? AND (audience='all' OR id IN(SELECT notice_id FROM notice_recipients WHERE member_id=?)) ORDER BY published_at DESC LIMIT 30`,now(),actor.id),
 list(db,'SELECT id,member_id,record_date,weight_kg,body_fat_pct,created_at,updated_at FROM body_records WHERE member_id=? ORDER BY record_date DESC LIMIT 365',actor.id)
 ]);
 return{member:{id:actor.id,name:actor.name},slots,bookings,tickets,notices,records};
}

async function route(ctx,path,data){
 const db=ctx.env.DB,req=ctx.request,method=req.method;
 if(path==='health'&&method==='GET')return json({status:'ready',database:'connected',mode:'production-api'});
 const actor=await session(ctx);
 if(path==='auth/me'&&method==='GET')return json({authenticated:!!actor,user:actor,adminConfigured:!!await one(db,"SELECT id FROM staff_accounts WHERE role='owner' AND status='active' LIMIT 1")});
 if(path==='revision'&&method==='GET'){
   if(!actor)return fail('ログインが必要です',401);
   const latest=await one(db,'SELECT id FROM audit_log ORDER BY rowid DESC LIMIT 1');
   return json({revision:latest?.id||null});
 }

 if(path==='auth/logout'&&method==='POST'){
   const token=readCookie(req,'sr_session');if(token)await query(db,'DELETE FROM auth_sessions WHERE token_hash=?',await sha(token)).run();
   return json({ok:true},200,{'set-cookie':clearCookie});
 }
 if(path==='setup/owner'&&method==='POST'){
   if(!ctx.env.SETUP_TOKEN||ctx.env.SETUP_TOKEN.length<32||!ctx.env.PASSWORD_PEPPER||ctx.env.PASSWORD_PEPPER.length<32)return fail('初期設定用のシークレットが未設定です',503);
   if(await one(db,"SELECT id FROM staff_accounts WHERE role='owner' AND status='active' LIMIT 1"))return fail('初期設定は完了しています',409);
   if(!(await matches(data.setupToken,ctx.env.SETUP_TOKEN)))return fail('初期設定キーが違います',403);
   const email=field(data.email,254).toLowerCase(),salt=field(data.passwordSalt,64),verifier=field(data.passwordVerifier,64),name=field(data.name,80)||'オーナー';
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!(/^[0-9a-f]{64}$/.test(salt))||!(/^[0-9a-f]{64}$/.test(verifier)))return fail('メールアドレスとパスワードの設定内容が不正です');
   const hash=await passwordPepper(ctx.env.PASSWORD_PEPPER,salt,verifier),id=uid();
   const result=await query(db,`INSERT INTO staff_accounts(id,email,display_name,role,status,password_salt,password_hash,created_at,updated_at)
 SELECT ?,?,?,'owner','active',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE role='owner')`,id,email,name,salt,hash,now(),now()).run();
   if(!result.meta?.changes)return fail('オーナーはすでに登録されています',409);
   return json({ok:true,message:'登録しました。ログインして認証アプリを設定してください。'});
 }
 if(path==='auth/admin/salt'&&method==='POST'){
   const email=field(data.email,254).toLowerCase();
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return fail('メールアドレスを確認してください');
   const staff=await one(db,"SELECT password_salt FROM staff_accounts WHERE email=? AND status='active'",email);
   return json({salt:staff?.password_salt||random()});
 }
 if(path==='auth/admin/login'&&method==='POST'){
   if(!ctx.env.PASSWORD_PEPPER||ctx.env.PASSWORD_PEPPER.length<32)return fail('管理者認証の秘密情報が未設定です',503);
   const email=field(data.email,254).toLowerCase(),verifier=field(data.passwordVerifier,64);
   const blocked=await one(db,'SELECT blocked_until FROM login_throttles WHERE email=?',email);
   if(blocked?.blocked_until&&blocked.blocked_until>now())return fail('一定時間後に再度お試しください',429);
   const staff=await one(db,"SELECT * FROM staff_accounts WHERE email=? AND status='active'",email);
   const salt=staff?.password_salt||random();
   const hash=/^[0-9a-f]{64}$/.test(verifier)?await passwordPepper(ctx.env.PASSWORD_PEPPER,salt,verifier):random();
   if(!(staff?.password_hash&&await matches(hash,staff.password_hash))){await failAuth(db,email);return fail('ログインIDまたはパスワードが違います',401);}
   let otp=await otpRow(db,staff.id);
   if(!otp){
     const seed=toB32(bytes(20)),cipher=await sealSeed(ctx.env.PASSWORD_PEPPER,seed);
     await query(db,'INSERT OR IGNORE INTO system_settings(key,value_json,updated_at) VALUES(?,?,?)',otpKey(staff.id),JSON.stringify({cipher,enabled:false,lastStep:-1}),now()).run();
     otp=await otpRow(db,staff.id);
   }
   const id=uid();
   await query(db,'INSERT INTO login_challenges(id,staff_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)',id,staff.id,await sha(random()),expAt(5/60),now()).run();
   const setup=otp.enabled?null:{secret:await openSeed(ctx.env.PASSWORD_PEPPER,otp.cipher)};
   return json({challengeId:id,mode:'totp',setup});
 }
 if(path==='auth/admin/verify'&&method==='POST'){
   if(!ctx.env.PASSWORD_PEPPER)return fail('認証設定が未完了です',503);
   const challenge=await one(db,'SELECT * FROM login_challenges WHERE id=?',field(data.challengeId,64));
   if(!challenge||challenge.expires_at<now()||challenge.consumed_at||challenge.attempts>=5)return fail('認証期限切れ、または試行回数超過です。再ログインしてください',401);
   const staff=await one(db,"SELECT id,email FROM staff_accounts WHERE id=? AND status='active'",challenge.staff_id);
   if(!staff)return fail('認証できません',401);
   const blocked=await one(db,'SELECT blocked_until FROM login_throttles WHERE email=?',staff.email);
   if(blocked?.blocked_until&&blocked.blocked_until>now())return fail('一定時間後に再度お試しください',429);
   await query(db,'UPDATE login_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5',challenge.id).run();
   const otp=await otpRow(db,staff.id);
   if(!otp)return fail('認証アプリの登録が必要です',401);
   const secret=await openSeed(ctx.env.PASSWORD_PEPPER,otp.cipher);
   const step=await checkTOTP(secret,field(data.code,6),Number(otp.lastStep??-1));
   if(step===null){await failAuth(db,staff.email);return fail('認証アプリの確認コードが違います',401);}
   const next=JSON.stringify({cipher:otp.cipher,enabled:true,lastStep:step});
   const updated=await query(db,'UPDATE system_settings SET value_json=?,updated_at=? WHERE key=? AND value_json=?',next,now(),otpKey(staff.id),otp.raw).run();
   if(!updated.meta?.changes)return fail('同じコードは再使用できません。次のコードでお試しください',409);
   const done=await query(db,'UPDATE login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<=5',now(),challenge.id,now()).run();
   if(!done.meta?.changes)return fail('もう一度ログインしてください',401);
   await query(db,'DELETE FROM login_throttles WHERE email=?',staff.email).run();
   const token=await newSession(db,'staff',staff.id,14);
   return json({ok:true},200,{'set-cookie':cookie(token,14)});
 }
 if(path==='member/state'&&method==='GET'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   return json(await memberState(db,actor));
 }
 if(path==='member/records/update'&&method==='POST'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   await ensureBodyRecords(db);
   const recordId=field(data.recordId,80),day=field(data.recordDate,10),weight=Number(data.weightKg),fat=Number(data.bodyFatPct);
   if(!recordId||!validDay(day)||day>jstDay()||!Number.isFinite(weight)||weight<20||weight>300||!Number.isFinite(fat)||fat<1||fat>70)return fail('記録日・体重・体脂肪率を確認してください');
   const existing=await one(db,'SELECT id,record_date,weight_kg,body_fat_pct FROM body_records WHERE id=? AND member_id=?',recordId,actor.id);
   if(!existing)return fail('修正する記録が見つかりません',404);
   const duplicate=await one(db,'SELECT id FROM body_records WHERE member_id=? AND record_date=? AND id<>?',actor.id,day,recordId);
   if(duplicate)return fail('その日付には既に記録があります。既存の記録を修正してください',409);
   await db.batch([query(db,'UPDATE body_records SET record_date=?,weight_kg=?,body_fat_pct=?,updated_at=? WHERE id=? AND member_id=?',day,weight,fat,now(),recordId,actor.id),audit(db,actor,'update_body_record','body_record',recordId,{recordDate:day,weightKg:weight,bodyFatPct:fat,previousRecordDate:existing.record_date})]);
   return json({ok:true,id:recordId});
 }
 if(path==='member/records'&&method==='POST'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   await ensureBodyRecords(db);
   const day=field(data.recordDate,10),weight=Number(data.weightKg),fat=Number(data.bodyFatPct);
   if(!validDay(day)||day>jstDay()||!Number.isFinite(weight)||weight<20||weight>300||!Number.isFinite(fat)||fat<1||fat>70)return fail('記録日・体重・体脂肪率を確認してください');
   const existing=await one(db,'SELECT id FROM body_records WHERE member_id=? AND record_date=?',actor.id,day),id=existing?.id||uid();
   await db.batch([query(db,`INSERT INTO body_records(id,member_id,record_date,weight_kg,body_fat_pct,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(member_id,record_date) DO UPDATE SET weight_kg=excluded.weight_kg,body_fat_pct=excluded.body_fat_pct,updated_at=excluded.updated_at`,id,actor.id,day,weight,fat,now(),now()),audit(db,actor,'save_body_record','body_record',id,{recordDate:day,weightKg:weight,bodyFatPct:fat})]);
   return json({ok:true,id});
 }
 if(path==='member/bookings'&&method==='POST'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   const slotId=field(data.slotId,80),slot=await slotAllowed(db,slotId,actor.id);
   if(!slot)return fail('予約できない枠です',409);
   if(await one(db,`SELECT id FROM booking_requests WHERE member_id=? AND slot_id=? AND status IN ('pending','confirmed','done','absent')`,actor.id,slotId))return fail('申請済みの枠です',409);
   const t=await availableTicket(db,actor.id,slotId);if(!t)return fail('予約日に有効なチケットがありません',409);
   const status=slot.mode==='approval'?'pending':'confirmed',id=uid();
   await db.batch([query(db,`INSERT INTO booking_requests(id,slot_id,member_id,status,ticket_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,id,slotId,actor.id,status,status==='confirmed'?t.id:null,now(),now()),audit(db,actor,'create_booking','booking',id,{status})]);
   return json({ok:true,id,status});
 }
 if(path==='member/withdraw'&&method==='POST'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   const id=field(data.id,100),r=await query(db,"UPDATE booking_requests SET status='withdrawn',updated_at=? WHERE id=? AND member_id=? AND status='pending'",now(),id,actor.id).run();
   if(!r.meta?.changes)return fail('取消できる申請がありません',409);
   await audit(db,actor,'withdraw_booking','booking',id).run();return json({ok:true});
 }
 if(path==='member/contact-change'&&method==='POST'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   const phone=field(data.phone,30),email=field(data.email,254);
   if(!phone&&!email)return fail('連絡先を入力してください');
   await db.batch([query(db,`UPDATE member_change_requests SET status='withdrawn',updated_at=? WHERE member_id=? AND status='pending'`,now(),actor.id),query(db,`INSERT INTO member_change_requests(id,member_id,requested_phone,requested_email,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)`,uid(),actor.id,phone||null,email||null,now(),now())]);
   return json({ok:true});
 }
 if(path==='admin/state'&&method==='GET'){
   if(!requireAdmin(actor))return fail('管理者ログインが必要です',401);
   return json({user:actor,...await adminState(db)});
 }
 if(path==='admin/members'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const name=field(data.name,100),kana=field(data.kana,100),email=field(data.email,254),phone=field(data.phone,30);
   if(!name)return fail('氏名を入力してください');
   const id='SR-'+uid().slice(0,8).toUpperCase();
   await db.batch([query(db,`INSERT INTO members(id,display_name,name_kana,email,phone,joined_on,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)`,id,name,kana,email||null,phone||null,jstDay(),now(),now()),audit(db,actor,'create_member','member',id)]);
   return json({ok:true,id});
 }
 if(path==='admin/invites'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const mid=field(data.memberId,100),m=await one(db,"SELECT id,line_subject,status FROM members WHERE id=?",mid);
   if(!m||m.status==='left'||m.line_subject)return fail('招待対象の会員ではありません',409);
   const token=random(),hash=await sha(token),id=uid();
   await db.batch([query(db,`UPDATE member_invites SET revoked_at=? WHERE member_id=? AND consumed_at IS NULL AND revoked_at IS NULL`,now(),mid),query(db,`INSERT INTO member_invites(id,member_id,token_sha256,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)`,id,mid,hash,expAt(72),actor.id,now()),audit(db,actor,'issue_invite','member',mid)]);
   return json({ok:true,inviteUrl:new URL('/?invite='+token,req.url).href,expiresAt:expAt(72)});
 }
 if(path==='admin/line-unlink'&&method==='POST'){
   if(!requireOwner(actor))return fail('オーナーのみ操作できます',403);
   const mid=field(data.memberId,100);
   if(data.confirm!=='LINE連携解除')return fail('確認操作が完了していません',400);
   const member=await one(db,'SELECT id,line_subject FROM members WHERE id=?',mid);
   if(!member||!member.line_subject)return fail('LINE連携済みの会員が見つかりません',409);
   const when=now();
   await db.batch([
     query(db,'UPDATE members SET line_subject=NULL,updated_at=? WHERE id=? AND line_subject=?',when,mid,member.line_subject),
     query(db,"DELETE FROM auth_sessions WHERE user_type='member' AND user_id=?",mid),
     query(db,"UPDATE member_invites SET revoked_at=? WHERE member_id=? AND consumed_at IS NULL AND revoked_at IS NULL",when,mid),
     audit(db,actor,'unlink_line_login','member',mid)
   ]);
   return json({ok:true});
 }
 if(path==='admin/slots'&&method==='POST'){
   if(!requireAdmin(actor))return fail('操作権限がありません',403);
   const day=field(data.date,10),time=field(data.time,5),mode=field(data.mode,15);
   if(!validDay(day)||!/^([01]\d|2[0-3]):(00|30)$/.test(time)||!['instant','approval'].includes(mode))return fail('日時または予約方式が不正です');
   const start=day+'T'+time,ends=new Date(Date.parse(start+':00+09:00')+3600000).toLocaleString('sv-SE',{timeZone:'Asia/Tokyo',hour12:false}).replace(' ','T').slice(0,16);
   if(start.slice(0,10)<jstDay())return fail('過去の日付は登録できません');
   const id=uid();await db.batch([query(db,`INSERT INTO booking_slots(id,starts_at,ends_at,mode,enabled,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`,id,start,ends,mode,now(),now()),audit(db,actor,'create_slot','slot',id)]);return json({ok:true,id});
 }
 if(path==='admin/publish'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const month=field(data.month,7);if(!validMonth(month))return fail('対象月が不正です');
   await db.batch([query(db,`INSERT OR IGNORE INTO published_months(month_key,published_at,published_by) VALUES(?,?,?)`,month,now(),actor.id),audit(db,actor,'publish_month','month',month)]);return json({ok:true});
 }
 if(path==='admin/decision'&&method==='POST'){
   if(!requireAdmin(actor))return fail('操作権限がありません',403);
   const id=field(data.id,100),decision=field(data.decision,15);
   const r=await one(db,`SELECT r.*,s.starts_at,s.ends_at FROM booking_requests r JOIN booking_slots s ON s.id=r.slot_id WHERE r.id=?`,id);
   if(!r||r.status!=='pending')return fail('承認待ちの申請ではありません',409);
   if(decision==='decline'){
     const res=await query(db,`UPDATE booking_requests SET status='declined',decline_reason=?,updated_at=? WHERE id=? AND status='pending'`,field(data.reason,250)||null,now(),id).run();if(!res.meta?.changes)return fail('申請状態が変更されています',409);
   }else if(decision==='approve'){
     const ticket=await availableTicket(db,r.member_id,r.slot_id);if(!ticket)return fail('実施日に有効なチケットがありません',409);
     await db.batch([
       query(db,`UPDATE booking_requests SET status='confirmed',ticket_id=?,updated_at=? WHERE id=? AND status='pending'`,ticket.id,now(),id),
       query(db,`UPDATE booking_requests SET status='declined',updated_at=? WHERE id<>? AND status='pending' AND slot_id IN(SELECT id FROM booking_slots WHERE starts_at<? AND ends_at>?)`,now(),id,r.ends_at,r.starts_at)
     ]);
   }else return fail('承認・却下を選択してください');
   await audit(db,actor,decision+'booking','booking',id).run();return json({ok:true});
 }
 if(path==='admin/cancel-booking'&&method==='POST'){
   if(!requireAdmin(actor))return fail('操作権限がありません',403);
   const id=field(data.id,100),r=await one(db,"SELECT * FROM booking_requests WHERE id=? AND status='confirmed'",id);
   if(!r)return fail('取消できる予約ではありません',409);
   const giveBack=data.returnTicket===true;
   await db.batch([query(db,'INSERT INTO booking_cancellations(booking_id,return_ticket,canceled_by,created_at) VALUES(?,?,?,?)',id,giveBack?1:0,actor.id,now()),audit(db,actor,'cancel_booking','booking',id,{giveBack})]);
   return json({ok:true});
 }
 if(path==='admin/menus'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const name=field(data.name,100),price=Number(data.price),count=Number(data.count),days=data.days==null?null:Number(data.days),monthReq=data.monthRequired===true;
   if(!name||!money(price)||!Number.isInteger(count)||count<0||count>1000||(days!=null&&(!Number.isInteger(days)||days<1||days>3650)))return fail('メニュー入力を確認してください');
   const id=uid();await db.batch([query(db,`INSERT INTO menus(id,name,standard_price_yen,ticket_count,validity_days,target_month_required,hidden,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)`,id,name,price,count,days,monthReq?1:0,now(),now()),audit(db,actor,'create_menu','menu',id)]);return json({ok:true,id});
 }
 if(path==='admin/purchase-payment'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const memberId=field(data.memberId,100),menuId=field(data.menuId,100),price=Number(data.price),day=field(data.date,10),target=field(data.targetMonth,7);
   const amount=Number(data.amount),paidDate=field(data.paidDate,10),paymentMethod=field(data.method,100);
   const menu=await one(db,'SELECT * FROM menus WHERE id=? AND hidden=0 AND deleted_at IS NULL',menuId);
   const mem=await one(db,"SELECT id FROM members WHERE id=? AND status<>'left'",memberId);
   if(!mem||!menu||!money(price)||!validDay(day)||(menu.target_month_required&&!validMonth(target))||!Number.isFinite(amount)||amount<0||(amount>0&&(!validDay(paidDate)||!paymentMethod)))return fail('購入・入金内容を確認してください');
   const id=uid(),actions=[query(db,`INSERT INTO purchases(id,member_id,menu_id,menu_name_at_sale,purchased_on,target_month,actual_price_yen,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,memberId,menuId,menu.name,day,target||null,price,now(),now()),audit(db,actor,'create_purchase','purchase',id,{price})];
   if(amount>0){actions.push(query(db,`INSERT INTO payments(id,purchase_id,paid_on,amount_yen,method_name_snapshot,created_at) VALUES(?,?,?,?,?,?)`,uid(),id,paidDate,amount,paymentMethod,now()),audit(db,actor,'register_payment','purchase',id,{amount}));}
   await db.batch(actions);
   if(price===0||amount>0)await issueTicket(db,id);
   return json({ok:true,id});
 }
 if(path==='admin/purchases'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const memberId=field(data.memberId,100),menuId=field(data.menuId,100),price=Number(data.price),day=field(data.date,10),target=field(data.targetMonth,7);
   const menu=await one(db,'SELECT * FROM menus WHERE id=? AND hidden=0 AND deleted_at IS NULL',menuId);
   const mem=await one(db,"SELECT id FROM members WHERE id=? AND status<>'left'",memberId);
   if(!mem||!menu||!money(price)||!validDay(day)||(menu.target_month_required&&!validMonth(target)))return fail('購入登録内容を確認してください');
   const id=uid();await db.batch([query(db,`INSERT INTO purchases(id,member_id,menu_id,menu_name_at_sale,purchased_on,target_month,actual_price_yen,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,memberId,menuId,menu.name,day,target||null,price,now(),now()),audit(db,actor,'create_purchase','purchase',id,{price})]);
   if(price===0)await issueTicket(db,id);return json({ok:true,id});
 }
 if(path==='admin/payments'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const id=field(data.purchaseId,100),date=field(data.date,10),method=field(data.method,100),amount=Number(data.amount);
   const p=await one(db,'SELECT id FROM purchases WHERE id=? AND canceled_at IS NULL',id);
   if(!p||!money(amount)||amount===0||!validDay(date)||!method)return fail('入金情報を確認してください');
   await db.batch([query(db,`INSERT INTO payments(id,purchase_id,paid_on,amount_yen,method_name_snapshot,created_at) VALUES(?,?,?,?,?,?)`,uid(),id,date,amount,method,now()),audit(db,actor,'register_payment','purchase',id,{amount})]);
   await issueTicket(db,id);return json({ok:true});
 }
 if(path==='admin/manual-ticket'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const member=field(data.memberId,100),count=Number(data.count),from=field(data.start,10),end=field(data.end,10);
   if(!await one(db,"SELECT id FROM members WHERE id=? AND status<>'left'",member)||!Number.isInteger(count)||count<1||count>200||!validDay(from)||(end&&(!validDay(end)||end<from)))return fail('チケット内容を確認してください');
   const id=uid();await db.batch([query(db,`INSERT INTO tickets(id,member_id,purchase_id,initial_count,available_count,valid_from,expires_on,created_at,updated_at) VALUES(?,?,NULL,?,?,?,?,?,?)`,id,member,count,count,from,end||null,now(),now()),audit(db,actor,'grant_ticket','ticket',id,{count})]);return json({ok:true,id});
 }
 if(path==='admin/change-requests'&&method==='GET'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   return json({requests:await list(db,`SELECT c.*,m.display_name FROM member_change_requests c JOIN members m ON c.member_id=m.id WHERE c.status='pending' ORDER BY c.created_at DESC LIMIT 100`)});
 }
 if(path==='admin/change-decision'&&method==='POST'){
   if(!requireManager(actor))return fail('操作権限がありません',403);
   const id=field(data.id,100),decision=field(data.decision,15),change=await one(db,"SELECT * FROM member_change_requests WHERE id=? AND status='pending'",id);
   if(!change||!['approve','decline'].includes(decision))return fail('処理できない申請です',409);
   const actions=[query(db,`UPDATE member_change_requests SET status=?,reviewed_by=?,updated_at=? WHERE id=? AND status='pending'`,decision==='approve'?'approved':'declined',actor.id,now(),id)];
   if(decision==='approve')actions.push(query(db,'UPDATE members SET phone=COALESCE(?,phone),email=COALESCE(?,email),updated_at=? WHERE id=?',change.requested_phone,change.requested_email,now(),change.member_id));
   actions.push(audit(db,actor,decision+'_contact','member',change.member_id));await db.batch(actions);return json({ok:true});
 }
 return fail('指定されたAPIはありません',404);
}

async function oauthStart(ctx){
 const req=ctx.request,env=ctx.env,db=env.DB;
 if(!env.LINE_CHANNEL_ID||!env.LINE_CHANNEL_SECRET)return fail('LINEログインが未設定です',503);
 const invite=new URL(req.url).searchParams.get('invite')||'';
 if(invite&&!/^[0-9a-f]{64}$/.test(invite))return fail('招待リンクが無効です');
 const state=random(),verifier=b64url(bytes(32)),nonce=random(),challenge=b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',formBytes(verifier))));
 const inviteHash=invite?await sha(invite):null;
 await query(db,`INSERT INTO oauth_states(state_hash,pkce_verifier,nonce,invite_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)`,await sha(state),verifier,nonce,inviteHash,expAt(10/60),now()).run();
 const callback=new URL('/api/auth/line/callback',req.url).href;
 const url=new URL('https://access.line.me/oauth2/v2.1/authorize');
 url.search=new URLSearchParams({response_type:'code',client_id:env.LINE_CHANNEL_ID,redirect_uri:callback,state,scope:'openid profile',nonce,code_challenge_method:'S256',code_challenge:challenge}).toString();
 return redirect(url.toString(),{'set-cookie':oauthCookie(state)});
}
async function oauthCallback(ctx){
 const req=ctx.request,db=ctx.env.DB,env=ctx.env,params=new URL(req.url).searchParams;
 const state=params.get('state')||'',code=params.get('code')||'';
 if(!/^[0-9a-f]{64}$/.test(state)||!code||readCookie(req,'sr_oauth')!==state)return redirect('/?login=failed',{'set-cookie':expireOAuth});
 const h=await sha(state);const row=await one(db,'SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?',h,now());
 if(!row)return redirect('/?login=expired',{'set-cookie':expireOAuth});
 const consumed=await query(db,'DELETE FROM oauth_states WHERE state_hash=?',h).run();if(!consumed.meta?.changes)return redirect('/?login=invalid',{'set-cookie':expireOAuth});
 const redirectUri=new URL('/api/auth/line/callback',req.url).href;
 const tokenRes=await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:env.LINE_CHANNEL_ID,client_secret:env.LINE_CHANNEL_SECRET,code_verifier:row.pkce_verifier})});
 if(!tokenRes.ok)return redirect('/?login=failed',{'set-cookie':expireOAuth});
 const tokens=await tokenRes.json();if(!tokens.id_token)return redirect('/?login=failed',{'set-cookie':expireOAuth});
 const verify=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:tokens.id_token,client_id:env.LINE_CHANNEL_ID,nonce:row.nonce})});
 if(!verify.ok)return redirect('/?login=failed',{'set-cookie':expireOAuth});
 const profile=await verify.json();if(!profile.sub||profile.aud!==env.LINE_CHANNEL_ID||profile.iss!=='https://access.line.me'||profile.nonce!==row.nonce)return redirect('/?login=failed',{'set-cookie':expireOAuth});
 let member=await one(db,"SELECT id,status FROM members WHERE line_subject=?",profile.sub);
 if(!member&&row.invite_hash){
   const invite=await one(db,`SELECT i.* FROM member_invites i JOIN members m ON m.id=i.member_id WHERE i.token_sha256=? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND m.line_subject IS NULL AND m.status='active'`,row.invite_hash,now());
   if(!invite)return redirect('/?login=invite-invalid',{'set-cookie':expireOAuth});
   try{await db.batch([query(db,"UPDATE members SET line_subject=?,updated_at=? WHERE id=? AND line_subject IS NULL",profile.sub,now(),invite.member_id),query(db,'UPDATE member_invites SET consumed_at=? WHERE id=? AND consumed_at IS NULL',now(),invite.id)]);}catch(e){return redirect('/?login=failed',{'set-cookie':expireOAuth});}
   member=await one(db,'SELECT id,status FROM members WHERE line_subject=?',profile.sub);
 }
 if(!member||member.status==='left')return redirect('/?login=not-member',{'set-cookie':expireOAuth});
 const token=await newSession(db,'member',member.id,30);
 const headers=new Headers({'location':'/','cache-control':'no-store'});headers.append('set-cookie',cookie(token,30));headers.append('set-cookie',expireOAuth);
 return new Response(null,{status:302,headers});
}

// Fixed statements from database/001_initial_schema.sql and 002_production.sql.
const bootstrapStatements = [
  `CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  name_kana TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  birth_date TEXT,
  joined_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left')),
  leave_on TEXT,
  paused_from TEXT,
  paused_through TEXT,
  line_subject TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS member_invites (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  auth_provider_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS staff_permission_overrides (
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  PRIMARY KEY(staff_id, permission)
);`,
  `CREATE TABLE IF NOT EXISTS staff_invites (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS operating_rules (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  opens_at TEXT,
  closes_at TEXT,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1))
);`,
  `CREATE TABLE IF NOT EXISTS operating_overrides (
  work_date TEXT PRIMARY KEY,
  opens_at TEXT,
  closes_at TEXT,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1))
);`,
  `CREATE TABLE IF NOT EXISTS published_months (
  month_key TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS booking_slots (
  id TEXT PRIMARY KEY,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('instant','approval')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  staff_id TEXT REFERENCES staff_accounts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(starts_at, staff_id)
);`,
  `CREATE INDEX IF NOT EXISTS booking_slots_start_idx ON booking_slots(starts_at);`,
  `CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  standard_price_yen INTEGER NOT NULL CHECK (standard_price_yen >= 0),
  ticket_count INTEGER NOT NULL CHECK (ticket_count >= 0),
  validity_days INTEGER,
  target_month_required INTEGER NOT NULL DEFAULT 0 CHECK (target_month_required IN (0,1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE RESTRICT,
  menu_name_at_sale TEXT NOT NULL,
  purchased_on TEXT NOT NULL,
  target_month TEXT,
  actual_price_yen INTEGER NOT NULL CHECK (actual_price_yen >= 0),
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS purchases_member_idx ON purchases(member_id, purchased_on);`,
  `CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  paid_on TEXT NOT NULL,
  amount_yen INTEGER NOT NULL CHECK (amount_yen > 0),
  method_name_snapshot TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  deleted_at TEXT
);`,
  `CREATE TABLE IF NOT EXISTS held_credit_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('hold','apply','refund','adjust')),
  amount_delta_yen INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purchase_id TEXT UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
  initial_count INTEGER NOT NULL CHECK (initial_count > 0),
  available_count INTEGER NOT NULL CHECK (available_count >= 0),
  valid_from TEXT NOT NULL,
  expires_on TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','declined','withdrawn','canceled','done','absent')),
  ticket_id TEXT REFERENCES tickets(id) ON DELETE RESTRICT,
  decline_reason TEXT,
  member_notice_required INTEGER NOT NULL DEFAULT 0 CHECK (member_notice_required IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS booking_requests_slot_idx ON booking_requests(slot_id, status);`,
  `CREATE INDEX IF NOT EXISTS booking_requests_member_idx ON booking_requests(member_id, status);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot ON booking_requests(slot_id) WHERE status IN ('confirmed','done','absent');`,
  `CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  booking_id TEXT REFERENCES booking_requests(id) ON DELETE RESTRICT,
  amount_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS member_change_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  requested_phone TEXT,
  requested_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','declined','withdrawn')),
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all','selected')),
  publish_on TEXT,
  published_at TEXT,
  deleted_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS notice_recipients (
  notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  PRIMARY KEY(notice_id,member_id)
);`,
  `CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('member','staff')),
  recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  seen_at TEXT,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member','staff','system')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type,entity_id,created_at);`,
  `CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `ALTER TABLE staff_accounts ADD COLUMN password_salt TEXT;`,
  `ALTER TABLE staff_accounts ADD COLUMN password_hash TEXT;`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','member')),
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);`,
  `CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_accounts(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS login_throttles (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  pkce_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  invite_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS booking_locks (
  block_start TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES booking_requests(id)
);`,
  `CREATE TRIGGER IF NOT EXISTS booking_confirm_insert
AFTER INSERT ON booking_requests
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT CASE WHEN NEW.ticket_id IS NULL THEN RAISE(ABORT,'ticket_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.id=NEW.ticket_id AND t.member_id=NEW.member_id
      AND t.disabled_at IS NULL AND t.available_count>0
      AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ) THEN RAISE(ABORT,'ticket_invalid_or_expired') END;
  UPDATE tickets SET available_count=available_count-1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ticket_id;
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT substr(starts_at,1,16) FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT strftime('%Y-%m-%dT%H:%M',starts_at,'+30 minutes') FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.ticket_id,NEW.id,-1,'booking_confirmed','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;`,
  `CREATE TRIGGER IF NOT EXISTS booking_confirm_update
AFTER UPDATE OF status ON booking_requests
WHEN NEW.status='confirmed' AND OLD.status='pending'
BEGIN
  SELECT CASE WHEN NEW.ticket_id IS NULL THEN RAISE(ABORT,'ticket_required') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.id=NEW.ticket_id AND t.member_id=NEW.member_id
      AND t.disabled_at IS NULL AND t.available_count>0
      AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ) THEN RAISE(ABORT,'ticket_invalid_or_expired') END;
  UPDATE tickets SET available_count=available_count-1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.ticket_id;
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT substr(starts_at,1,16) FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO booking_locks (block_start,booking_id)
    VALUES ((SELECT strftime('%Y-%m-%dT%H:%M',starts_at,'+30 minutes') FROM booking_slots WHERE id=NEW.slot_id), NEW.id);
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    VALUES(lower(hex(randomblob(16))),NEW.ticket_id,NEW.id,-1,'booking_approved','system',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;`,
  `CREATE TRIGGER IF NOT EXISTS booking_release_locks
AFTER UPDATE OF status ON booking_requests
WHEN OLD.status IN ('confirmed','done','absent') AND NEW.status IN ('canceled','declined')
BEGIN
  DELETE FROM booking_locks WHERE booking_id=NEW.id;
END;`,
  `CREATE TRIGGER IF NOT EXISTS pending_ticket_limit
BEFORE INSERT ON booking_requests
WHEN NEW.status='pending'
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM booking_requests r
    WHERE r.member_id=NEW.member_id AND r.status='pending'
  ) >= COALESCE((
    SELECT SUM(t.available_count) FROM tickets t JOIN booking_slots s ON s.id=NEW.slot_id
    WHERE t.member_id=NEW.member_id AND t.disabled_at IS NULL
      AND s.starts_at IS NOT NULL AND substr(s.starts_at,1,10)>=t.valid_from
      AND (t.expires_on IS NULL OR substr(s.starts_at,1,10)<=t.expires_on)
  ),0) THEN RAISE(ABORT,'pending_ticket_limit') END;
END;`,
  `CREATE TABLE IF NOT EXISTS booking_cancellations (
  booking_id TEXT PRIMARY KEY REFERENCES booking_requests(id),
  return_ticket INTEGER NOT NULL CHECK (return_ticket IN (0,1)),
  canceled_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE TRIGGER IF NOT EXISTS booking_cancel_once
AFTER INSERT ON booking_cancellations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM booking_requests WHERE id=NEW.booking_id AND status='confirmed'
  ) THEN RAISE(ABORT,'already_canceled') END;
  UPDATE booking_requests SET status='canceled',updated_at=NEW.created_at
    WHERE id=NEW.booking_id AND status='confirmed';
  UPDATE tickets SET available_count=available_count+1,updated_at=NEW.created_at
    WHERE id=(SELECT ticket_id FROM booking_requests WHERE id=NEW.booking_id)
      AND NEW.return_ticket=1;
  INSERT INTO ticket_events(id,ticket_id,booking_id,amount_delta,reason,created_by,created_at)
    SELECT lower(hex(randomblob(16))),ticket_id,NEW.booking_id,1,'booking_canceled',NEW.canceled_by,NEW.created_at
    FROM booking_requests WHERE id=NEW.booking_id AND NEW.return_ticket=1 AND ticket_id IS NOT NULL;
END;`
];

async function ensureProductionSchema(db) {
  const marker = "SELECT name FROM sqlite_master WHERE type='table' AND name='shiftrex_schema_002_complete'";
  if (await db.prepare(marker).first()) return;
  const {results} = await db.prepare("PRAGMA table_info(staff_accounts)").all();
  const columns = new Set(results.map(column => column.name));
  const pending = bootstrapStatements.filter(sql => {
    const addition = /^ALTER TABLE staff_accounts ADD COLUMN (\w+)/.exec(sql);
    return !addition || !columns.has(addition[1]);
  });
  pending.push("CREATE TABLE IF NOT EXISTS shiftrex_schema_002_complete (version INTEGER PRIMARY KEY)");
  try {
    await db.batch(pending.map(sql => db.prepare(sql)));
  } catch (error) {
    // Concurrent first requests can race on ADD COLUMN. Only accept a completed batch.
    if (!(await db.prepare(marker).first())) throw error;
  }
}

export async function onRequest(ctx){
 const {request:req,env}=ctx;const path=new URL(req.url).pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
 if(req.method==='OPTIONS')return fail('not allowed',405);
 if(!env.DB)return fail('D1データベース未接続：Cloudflare PagesのDBバインディングを設定してください',503);
 try{
   await ensureProductionSchema(env.DB);
 }catch(e){return fail('データベース初期化が未完了です。D1の接続設定とログを確認してください',503);}
 try{
   if(path==='auth/line/start'&&req.method==='GET')return await oauthStart(ctx);
   if(path==='auth/line/callback'&&req.method==='GET')return await oauthCallback(ctx);
   if(req.method==='POST'){
     const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)return fail('リクエスト元を確認できません',403);
     if(!(req.headers.get('content-type')||'').startsWith('application/json'))return fail('JSON形式が必要です',415);
     const length=Number(req.headers.get('content-length')||0);if(length>25000)return fail('入力が大きすぎます',413);
   }
   let data={};if(req.method==='POST'){
     try{const text=await req.text();if(text.length>25000)return fail('入力が大きすぎます',413);data=text?JSON.parse(text):{};if(!data||Array.isArray(data)||typeof data!=='object')return fail('入力形式が不正です');}
     catch(e){return fail('JSON形式が不正です');}
   }
   if(!['GET','POST'].includes(req.method))return fail('操作できないHTTPメソッドです',405);
   return await route(ctx,path,data);
 }catch(e){
   console.error('SHIFTREX API request failed',path,e?.message||e);
   if(String(e?.message||e).includes('UNIQUE constraint')||String(e?.message||e).includes('booking_locks')||String(e?.message||e).includes('ticket_invalid_or_expired')||String(e?.message||e).includes('pending_ticket_limit')||String(e?.message||e).includes('already_canceled'))return fail('予約枠・チケットの状態が変更されました。更新してお試しください',409);
   return fail('サーバーで処理できませんでした',500);
 }
}
