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
const hashPassword=async(password,salt)=>{const key=await crypto.subtle.importKey('raw',formBytes(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:formBytes(salt),iterations:210000},key,256);return hex(new Uint8Array(bits));};
const sendMail=async(env,to,subject,body)=>{
 if(!env.RESEND_API_KEY||!env.AUTH_FROM_EMAIL)throw new Error('email_not_configured');
 const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json'},body:JSON.stringify({from:env.AUTH_FROM_EMAIL,to:[to],subject,text:body})});
 if(!res.ok)throw new Error('email_delivery_failed');
};
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
 const [members,slots,requests,tickets,menus,purchases,payments,notices]=await Promise.all([
 list(db,'SELECT id,display_name,name_kana,phone,email,joined_on,status,paused_from,paused_through,leave_on FROM members ORDER BY created_at DESC LIMIT 300'),
 list(db,'SELECT id,starts_at,ends_at,mode,enabled FROM booking_slots WHERE starts_at>=? ORDER BY starts_at LIMIT 600',jstDay()),
 list(db,`SELECT r.id,r.slot_id,r.member_id,r.status,r.ticket_id,r.created_at,r.decline_reason,s.starts_at,m.display_name AS member_name FROM booking_requests r JOIN booking_slots s ON s.id=r.slot_id JOIN members m ON m.id=r.member_id WHERE s.starts_at>=? ORDER BY s.starts_at LIMIT 500`,jstDay()),
 list(db,'SELECT * FROM tickets ORDER BY created_at DESC LIMIT 500'),
 list(db,'SELECT id,name,standard_price_yen,ticket_count,validity_days,target_month_required,hidden FROM menus WHERE deleted_at IS NULL ORDER BY created_at LIMIT 100'),
 list(db,'SELECT id,member_id,menu_id,menu_name_at_sale,purchased_on,target_month,actual_price_yen,canceled_at FROM purchases ORDER BY created_at DESC LIMIT 300'),
 list(db,'SELECT id,purchase_id,paid_on,amount_yen,method_name_snapshot FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500'),
 list(db,'SELECT id,title,body,published_at FROM notices WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50'),
 ]);
 return{members,slots,requests,tickets,menus,purchases,payments,notices};
}
async function memberState(db,actor){
 const [slots,bookings,tickets,notices]=await Promise.all([
 list(db,`SELECT s.id,s.starts_at,s.ends_at,s.mode,s.enabled,CASE WHEN EXISTS(SELECT 1 FROM booking_locks l WHERE l.block_start=substr(s.starts_at,1,16)) THEN 1 ELSE 0 END AS booked
 FROM booking_slots s JOIN published_months p ON p.month_key=substr(s.starts_at,1,7)
 WHERE s.starts_at>=? AND s.starts_at<? ORDER BY s.starts_at LIMIT 1000`,jstDay(),new Date(Date.now()+95*86400000).toISOString().slice(0,10)),
 list(db,`SELECT r.id,r.status,r.slot_id,r.decline_reason,s.starts_at FROM booking_requests r JOIN booking_slots s ON s.id=r.slot_id WHERE r.member_id=? ORDER BY s.starts_at DESC LIMIT 150`,actor.id),
 list(db,`SELECT t.id,t.initial_count,t.available_count,t.valid_from,t.expires_on FROM tickets t WHERE t.member_id=? AND t.disabled_at IS NULL ORDER BY COALESCE(t.expires_on,'9999') LIMIT 100`,actor.id),
 list(db,`SELECT id,title,body,published_at FROM notices WHERE deleted_at IS NULL AND published_at IS NOT NULL AND published_at<=? AND (audience='all' OR id IN(SELECT notice_id FROM notice_recipients WHERE member_id=?)) ORDER BY published_at DESC LIMIT 30`,now(),actor.id)
 ]);
 return{member:{id:actor.id,name:actor.name},slots,bookings,tickets,notices};
}

async function route(ctx,path,data){
 const db=ctx.env.DB,req=ctx.request,method=req.method;
 if(path==='health'&&method==='GET')return json({status:'ready',database:'connected',mode:'production-api'});
 const actor=await session(ctx);
 if(path==='auth/me'&&method==='GET')return json({authenticated:!!actor,user:actor,adminConfigured:!!await one(db,"SELECT id FROM staff_accounts WHERE role='owner' AND status='active' LIMIT 1")});
 if(path==='auth/logout'&&method==='POST'){
   const token=readCookie(req,'sr_session');if(token)await query(db,'DELETE FROM auth_sessions WHERE token_hash=?',await sha(token)).run();
   return json({ok:true},200,{'set-cookie':clearCookie});
 }
 if(path==='setup/owner'&&method==='POST'){
   if(!ctx.env.SETUP_TOKEN||ctx.env.SETUP_TOKEN.length<32)return fail('初期設定用シークレットが未設定です',503);
   if(await one(db,"SELECT id FROM staff_accounts WHERE role='owner' AND status='active' LIMIT 1"))return fail('初期設定は完了しています',409);
   if(!(await matches(data.setupToken,ctx.env.SETUP_TOKEN)))return fail('初期設定キーが違います',403);
   const email=field(data.email,254).toLowerCase(),password=String(data.password||''),name=field(data.name,80)||'オーナー';
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<14||password.length>128)return fail('メールアドレスと14文字以上のパスワードが必要です');
   const salt=random(),hash=await hashPassword(password,salt),id=uid();
   const result=await query(db,`INSERT INTO staff_accounts(id,email,display_name,role,status,password_salt,password_hash,created_at,updated_at)
 SELECT ?,?,?,'owner','active',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE role='owner')`,id,email,name,salt,hash,now(),now()).run();
   if(!result.meta?.changes)return fail('オーナーはすでに登録されています',409);
   return json({ok:true,message:'登録しました。メールによる追加認証を設定してログインしてください。'});
 }
 if(path==='auth/admin/login'&&method==='POST'){
   if(!ctx.env.RESEND_API_KEY||!ctx.env.AUTH_FROM_EMAIL)return fail('メール二段階認証の送信設定が未完了です',503);
   const email=field(data.email,254).toLowerCase(),password=String(data.password||'');
   const throttle=await one(db,'SELECT * FROM login_throttles WHERE email=?',email);
   if(throttle?.blocked_until&&throttle.blocked_until>now())return fail('一定時間後に再度お試しください',429);
   const staff=await one(db,"SELECT * FROM staff_accounts WHERE email=? AND status='active'",email);
   const given=staff?.password_salt||random();const computed=await hashPassword(password,given);
   const ok=staff?.password_hash&&await matches(computed,staff.password_hash);
   if(!ok){let failures=(throttle?.failures||0)+1,blocked=failures>=5?expAt(.25):null;
     await query(db,`INSERT INTO login_throttles(email,failures,blocked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at`,email,failures,blocked,now()).run();
     return fail('メールアドレスまたはパスワードが違います',401);
   }
   const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');const id=uid();
   await query(db,'INSERT INTO login_challenges(id,staff_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)',id,staff.id,await sha(id+':'+code),expAt(10/60),now()).run();
   try{await sendMail(ctx.env,email,'SHIFTREX ログイン確認コード','ログイン確認コード：'+code+'\n有効期限：10分\n心当たりがなければ無視してください。');}
   catch(e){await query(db,'DELETE FROM login_challenges WHERE id=?',id).run();return fail('確認メールを送信できません。送信設定をご確認ください',503);}
   await query(db,'DELETE FROM login_throttles WHERE email=?',email).run();return json({challengeId:id,message:'確認コードをメールに送信しました'});
 }
 if(path==='auth/admin/verify'&&method==='POST'){
   const challenge=await one(db,'SELECT * FROM login_challenges WHERE id=?',field(data.challengeId,64));
   if(!challenge||challenge.expires_at<now()||challenge.consumed_at||challenge.attempts>=5)return fail('コードの有効期限切れ、または試行回数超過です',401);
   await query(db,'UPDATE login_challenges SET attempts=attempts+1 WHERE id=?',challenge.id).run();
   if(!(await matches(await sha(challenge.id+':'+field(data.code,6)),challenge.code_hash)))return fail('確認コードが違います',401);
   const done=await query(db,'UPDATE login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<=5',now(),challenge.id).run();
   if(!done.meta?.changes)return fail('このコードは使用できません',401);
   const token=await newSession(db,'staff',challenge.staff_id,14);
   return json({ok:true},200,{'set-cookie':cookie(token,14)});
 }
 if(path==='member/state'&&method==='GET'){
   if(actor?.type!=='member')return fail('LINEログインが必要です',401);
   return json(await memberState(db,actor));
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

export async function onRequest(ctx){
 const {request:req,env}=ctx;const path=new URL(req.url).pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
 if(req.method==='OPTIONS')return fail('not allowed',405);
 if(!env.DB)return fail('D1データベース未接続：Cloudflare PagesのDBバインディングを設定してください',503);
 try{
   await env.DB.prepare('SELECT token_hash FROM auth_sessions LIMIT 1').first();
 }catch(e){return fail('データベース初期化が未完了です。SQLマイグレーションを適用してください',503);}
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
