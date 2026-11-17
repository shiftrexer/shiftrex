/* SHIFTREX production frontend; all data is fetched from authenticated Pages Functions. */
(()=>{'use strict';
const root=document.getElementById('app');const admin=document.body.dataset.app==='admin';
const view={tab:'home',busy:false,auth:null,data:null,error:'',success:'',challenge:'',totpSetup:null,invite:'',selectedDay:'',monthView:'',pendingId:'',modal:null,modalError:'',calendarMode:'month'};
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=iso=>iso?String(iso).replace('T',' ').slice(0,16):'—';
const d=iso=>iso?String(iso).slice(0,10):'—';
const money=n=>'¥'+Number(n||0).toLocaleString('ja-JP');
const hex=a=>Array.from(a).map(n=>n.toString(16).padStart(2,'0')).join('');
const derivePassword=async(password,salt)=>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:210000},key,256);
 return hex(new Uint8Array(bits));
};
const today=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${obj.year}-${obj.month}-${obj.day}`;};
const monthOffset=(m,n)=>{const t=new Date(m+'-01T12:00:00Z');t.setUTCMonth(t.getUTCMonth()+n);return t.toISOString().slice(0,7)};
const btn=(label,action,cls='')=>`<button class="button ${cls}" data-action="${action}">${h(label)}</button>`;
const stat=(name)=>`<span class="status status-${h(name)}">${h(({pending:'承認待ち',confirmed:'確定',declined:'却下',withdrawn:'取下げ',canceled:'キャンセル',done:'実施済み',absent:'欠席'})[name]||name)}</span>`;
const badge=(t)=>`<span class="label">${h(t)}</span>`;
const nav=admin?[['home','⌂','ホーム'],['booking','▣','予約管理'],['members','♙','会員管理'],['tickets','▤','チケット管理'],['settings','⚙','設定']]:[['home','⌂','ホーム'],['booking','▣','予約'],['tickets','▤','チケット'],['profile','◉','マイページ']];
function content(html,subtitle=''){
 const title=admin?'MANAGEMENT':'MEMBERSHIP';
 const memberAuthed=!admin&&!!view.auth?.authenticated;
 const refreshButton=view.auth?.authenticated?'<button type="button" class="refresh-button" data-action="refresh-now" aria-label="最新情報に更新" title="最新情報に更新"><span class="refresh-glyph" aria-hidden="true">↻</span><span>更新</span></button>':'';
 const bellButton='<button type="button" class="bell-button" data-action="view-notices" aria-label="お知らせを表示" title="お知らせ"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></button>';
 const mastBody=memberAuthed?`<h1 class="mast-page-title">${h(nav.find(([tab])=>tab===view.tab)?.[2]||'ホーム')}</h1><div class="member-header-actions">${refreshButton}${bellButton}</div>`:`<span class="logo-mark">SR</span><div class="brand"><strong>SHIFTREX</strong><small>${title}</small></div>${refreshButton}<span class="secure-tag">${view.auth?.authenticated?'● 接続中':'● セキュア'}</span>`;
 const greeting=(!admin&&view.tab==='booking')?'':(subtitle?`<div class="eyebrow">${h(subtitle)}</div>`:'');
 root.innerHTML=`<div class="app"><header class="mast ${memberAuthed?'mast-member':''}">${mastBody}</header><main class="surface"><div class="greeting">${greeting}</div>${view.error?`<div class="alert alert-error" role="alert">${h(view.error)}</div>`:''}${view.success?`<div class="alert alert-good" role="status">${h(view.success)}</div>`:''}${html}${admin?'<footer class="foot">© SHIFTREX · CLOUD DATABASE</footer>':''}</main>${view.auth?.authenticated?`<div class="nav-shell">${!admin?'<div class="nav-shield" aria-hidden="true"></div>':''}<nav class="tabbar" "><span class="tab-indicator" aria-hidden="true" style="transform:translateX(${Math.max(0,nav.findIndex(([id])=>id===view.tab))*100}%)"></span>${nav.map(([id,ico,label])=>`<button class="tab ${view.tab===id?'active':''}" data-tab="${id}"><span class="tabicon">${ico}</span><span>${label}</span></button>`).join('')}</nav></div>`:''}${view.modal?`<div class="overlay"><div class="modal" role="dialog" aria-modal="true">${view.modalError?`<div class="alert alert-error" role="alert">${h(view.modalError)}</div>`:''}${view.modal}</div></div>`:''}</div>`;
 renderTotpSetup();
}
const errText=e=>e instanceof Error?e.message:String(e);
async function api(path,body){
 const options={credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}};
 if(body!==undefined){options.method='POST';options.headers['content-type']='application/json';options.body=JSON.stringify(body);}
 let response;try{response=await fetch('/api/'+path,options)}catch(e){throw Error('通信に失敗しました。通信環境を確認してください');}
 let data;try{data=await response.json()}catch(e){throw Error('サーバーから正しい応答を受信できませんでした');}
 if(!response.ok){const error=Error(data.error||'操作できませんでした');error.status=response.status;throw error;}return data;
}
const notice=(msg,isError=false)=>{if(isError){view.error=msg;view.success='';}else{view.success=msg;view.error='';}render();};
function disabled(error){content(`<section class="auth-card"><span class="logo-large">SR</span><h1>サービス準備中</h1><p>SHIFTREXの本番用データベース、または認証設定が未完了です。</p><div class="alert alert-error">${h(error||'Cloudflareの設定を確認してください')}</div><p class="muted small">安全のため、実際の会員情報や予約を入力できない状態にしています。設定はCloudflare管理画面から行います。</p>${btn('接続を再確認','refresh')}</section>`);}
function renderTotpSetup(){
 if(!admin||!view.challenge||!view.totpSetup)return;
 const form=root.querySelector('form[data-form="otp"]');if(!form)return;
 const box=document.createElement('div');box.className='alert alert-good';
 const title=document.createElement('strong');title.textContent='初回のみ：認証アプリの設定';box.appendChild(title);
 const desc=document.createElement('p');desc.textContent='iPhoneの「パスワード」アプリや無料の認証アプリに、下の設定キーを手動で追加してください。アカウント名はSHIFTREXです。';box.appendChild(desc);
 const label=document.createElement('p');label.textContent='設定キー（第三者に共有しないでください）';box.appendChild(label);
 const key=document.createElement('code');key.textContent=view.totpSetup.secret;
 Object.assign(key.style,{display:'block',overflowWrap:'anywhere',userSelect:'all',fontSize:'16px',letterSpacing:'.08em',padding:'12px',border:'1px solid currentColor',borderRadius:'10px'});
 box.appendChild(key);
 const copy=document.createElement('button');copy.type='button';copy.className='button ghost';copy.dataset.action='copy-totp';copy.textContent='設定キーをコピー';box.appendChild(copy);
 const note=document.createElement('p');note.textContent='登録後、認証アプリに表示された6桁コードを入力してください。設定キーは安全な場所に保管してください。';box.appendChild(note);
 form.before(box);
}
function loginScreen(){
 if(admin){const configured=view.auth?.adminConfigured;
 content(`<section class="auth-card"><span class="logo-large">SR</span><h1>管理者ログイン</h1><p class="muted">${configured?'メール形式のログインID・パスワードと認証アプリの6桁コードを使用します。メール送信は行いません。':'初回のみ、Cloudflareに設定した初期設定キーでオーナーを登録します。'}</p>${view.challenge?`<form data-form="otp"><label>認証アプリの6桁コード<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button class="button main" type="submit">本人確認を完了</button></form><button class="button ghost" data-action="cancel-otp">戻る</button>`:configured?`<form data-form="login"><label>メールアドレス<input name="email" type="email" autocomplete="username" required></label><label>パスワード<input name="password" type="password" autocomplete="current-password" required></label><button class="button main" type="submit">ログイン</button></form>`:`<form data-form="setup"><label>Cloudflare初期設定キー<input name="setupToken" type="password" required></label><label>オーナー名<input name="name" required maxlength="80"></label><label>メールアドレス<input type="email" name="email" required></label><label>パスワード（14文字以上）<input type="password" name="password" minlength="14" maxlength="128" autocomplete="new-password" required></label><button class="button main" type="submit">オーナーを登録</button></form>`}</section>`);
 }else{
 content(`<section class="auth-card"><span class="logo-large">SR</span><h1>SHIFTREXへようこそ</h1><p>予約とチケット情報はLINEログインで確認できます。</p>${view.invite?`<div class="alert alert-good">招待リンクを確認しました。LINEで会員登録を完了してください。</div>`:''}<a class="button main" href="/api/auth/line/start${view.invite?'?invite='+encodeURIComponent(view.invite):''}">LINEでログインする</a><p class="muted small">会員登録はジム管理者が行います。初回利用には専用招待リンクが必要です。</p></section>`);
 }
}
function heading(title,subtitle){if(!admin)return subtitle?`<div class="heading member-intro"><p>${h(subtitle)}</p></div>`:'';return `<div class="heading"><div class="eyebrow">SHIFTREX MANAGEMENT</div><h1>${h(title)}</h1>${subtitle?`<p>${h(subtitle)}</p>`:''}</div>`;}
function block(title,body,other=''){return `<section class="panel"><div class="panel-head"><h2>${h(title)}</h2>${other}</div>${body}</section>`;}
const rRow=(title,subtitle,right)=>`<div class="line-item"><div class="line-text"><strong>${h(title)}</strong>${subtitle?`<small>${h(subtitle)}</small>`:''}</div>${right||''}</div>`;
function homeMember(){const s=view.data;const next=s.bookings.filter(b=>b.status==='confirmed'&&b.starts_at>=today()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))[0];const count=s.tickets.reduce((x,t)=>x+t.available_count,0);
 content(`<div class="member-welcome"><strong>${h(s.member.name)} 様</strong></div><div class="metrics"><div class="metric"><small>チケット残数</small><strong>${count}<span>回</span></strong></div><div class="metric"><small>次回予約</small><strong class="smaller">${next?h(next.starts_at.slice(5,16).replace('T',' ')):'予約なし'}</strong></div></div>`);
}
const dateShift=(day,delta)=>{const t=new Date(day+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+delta);return t.toISOString().slice(0,10);};
const sundayOf=day=>{const dow=new Date(day+'T12:00:00Z').getUTCDay();return dateShift(day,-dow);};
function memberBookings(){
 const s=view.data;
 if(!view.selectedDay)view.selectedDay=today();
 if(!view.monthView)view.monthView=view.selectedDay.slice(0,7);
 const history=block('予約履歴',s.bookings.length?s.bookings.map(b=>rRow(fmt(b.starts_at),b.status==='pending'?'承認をお待ちください':'60分',`${stat(b.status)}${b.status==='pending'?`<button class="button slim ghost" data-action="withdraw" data-id="${h(b.id)}">取消</button>`:''}`)).join(''):'<div class="empty">予約履歴はありません。</div>');
 const cutoffMs=Date.now()+3*3600000;
 const canBook=slot=>!!slot&&!!slot.enabled&&!slot.booked&&Date.parse(slot.starts_at+':00+09:00')>=cutoffMs;
 if(view.calendarMode!=='week'){
   const days=Array.from({length:new Date(+view.monthView.slice(0,4),+view.monthView.slice(5,7),0).getDate()},(_,i)=>view.monthView+'-'+String(i+1).padStart(2,'0'));
   const startDay=new Date(days[0]+'T12:00:00Z').getUTCDay();
   const cells=Array.from({length:startDay},()=>'<span class="month-spacer" aria-hidden="true"></span>').concat(days.map(day=>{
     const available=s.slots.some(slot=>slot.starts_at.slice(0,10)===day&&canBook(slot));
     const dow=new Date(day+'T12:00:00Z').getUTCDay();
     const classes=[day===today()?'today':'',day===view.selectedDay?'picked':'',available?'available':'',dow===0?'sunday':dow===6?'saturday':''].filter(Boolean).join(' ');
     return `<button type="button" class="day ${classes}" data-day="${day}" aria-label="${h(day)}の週を表示">${Number(day.slice(-2))}${available?'<span class="month-dot"></span>':''}</button>`;
   })).join('');
   const calendar=`<div class="calendar-head"><button type="button" data-action="prev-month" aria-label="前月">‹</button><strong>${h(view.monthView.slice(0,4))}年 ${Number(view.monthView.slice(5,7))}月</strong><button type="button" data-action="next-month" aria-label="翌月">›</button></div><p class="calendar-hint">日付を押すと、その週の空き状況が表示されます。</p><div class="calendar-grid"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>${cells}</div><div class="booking-legend"><span><b>●</b> 予約可能日</span></div>`;
   content(heading('予約','月間カレンダーから日付を選択してください')+block('月間カレンダー',calendar)+history,'会員専用予約');
   return;
 }
 const weekStart=sundayOf(view.selectedDay);
 const weekDays=Array.from({length:7},(_,i)=>dateShift(weekStart,i));
 const weekEnd=weekDays[6];
 const weekSlots=s.slots.filter(slot=>slot.starts_at.slice(0,10)>=weekStart&&slot.starts_at.slice(0,10)<=weekEnd);
 const timeSlots=weekSlots.map(slot=>slot.starts_at.slice(11,16));
 const times=[];
 if(timeSlots.length){
   const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
   const min=Math.min(...timeSlots.map(minutes)),max=Math.max(...timeSlots.map(minutes));
   for(let m=min;m<=max;m+=30)times.push(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
 }
 const slotMap=new Map();
 for(const slot of weekSlots){
   const key=slot.starts_at.slice(0,16);
   if(!slotMap.has(key)||(!canBook(slotMap.get(key))&&canBook(slot)))slotMap.set(key,slot);
 }
 const ownBooking=new Map(s.bookings.filter(b=>['pending','confirmed','done','absent'].includes(b.status)).map(b=>[b.slot_id,b]));
 const headingDays=weekDays.map((day,index)=>`<div class="week-date ${index===0?'sun':index===6?'sat':''} ${day===view.selectedDay?'selected':''} ${day===today()?'current':''}" role="columnheader"><button type="button" data-week-day="${day}" aria-label="${h(day)}を選択" ${day===view.selectedDay?'aria-current="date"':''}><span>${['日','月','火','水','木','金','土'][index]}</span><strong>${Number(day.slice(-2))}</strong></button></div>`).join('');
 const rows=times.map(time=>{
   const cells=weekDays.map(day=>{
     const slot=slotMap.get(day+'T'+time),own=slot?ownBooking.get(slot.id):null;
     const cls=`week-cell ${day===view.selectedDay?'selected':''}`;
     if(own)return `<div class="${cls}"><span class="week-state own ${own.status==='pending'?'pending':''}" title="${own.status==='pending'?'申請中':'予約済み'}">${own.status==='pending'?'申':'済'}</span></div>`;
     if(!slot)return `<div class="${cls}"><span class="week-state none">―</span></div>`;
     if(!canBook(slot))return `<div class="${cls}"><span class="week-state closed">×</span></div>`;
     return `<div class="${cls}"><button type="button" class="week-state bookable ${slot.mode==='approval'?'approval':'instant'}" data-action="book" data-id="${h(slot.id)}" aria-label="${h(day)} ${time} ${slot.mode==='approval'?'承認制で申請':'即時予約'}">${slot.mode==='approval'?'△':'○'}</button></div>`;
   }).join('');
   return `<div class="week-time" role="rowheader">${time}</div>${cells}`;
 }).join('');
 const controls=`<div class="booking-week-controls"><button type="button" class="button ghost" data-action="month-view">‹ 月間へ</button><div class="week-mover"><button type="button" data-action="prev-week" aria-label="前週">‹</button><strong>${h(weekStart.slice(5))}〜${h(weekEnd.slice(5))}</strong><button type="button" data-action="next-week" aria-label="翌週">›</button></div></div>`;
 const legend='<div class="booking-legend"><span><b class="legend-instant">○</b> 即時</span><span><b class="legend-approval">△</b> 承認制</span><span>× 受付不可</span><span>― 枠なし</span><span>済 予約済み</span><span>申 申請中</span></div>';
 const grid=times.length?`<div class="week-scroll" aria-label="1週間の予約表"><div class="week-grid" role="table" aria-label="週間予約表"><div class="week-time week-corner" role="columnheader">時間</div>${headingDays}${rows}</div></div>`:'<div class="empty">この週には公開中の予約枠がありません。前週・翌週も確認できます。</div>';
 content(heading('予約','週間の空き状況から時間を選択してください')+block('週間予約表',controls+grid+legend)+history,'会員専用予約');
}
function ticketsMember(){const s=view.data;content(heading('チケット','残数と有効期限を確認できます')+block('保有チケット',s.tickets.length?s.tickets.map(t=>`<div class="ticket-card"><small>SESSION TICKETS</small><strong>${t.available_count}<span> / ${t.initial_count} 回</span></strong><p>有効期間 ${h(t.valid_from)} 〜 ${h(t.expires_on||'期限なし')}</p></div>`).join(''):'<div class="empty">チケットがありません。</div>'),'残り回数');}
function profileMember(){const s=view.data;content(heading('マイページ',s.member.name+' 様')+block('会員情報',rRow('会員ID',s.member.id)+rRow('氏名',s.member.name))+block('連絡先変更申請',`<p class="muted small">電話番号・メールアドレスの変更は管理者の承認後に反映されます。</p><form data-form="contact"><label>電話番号<input name="phone" autocomplete="tel" maxlength="30"></label><label>メールアドレス<input name="email" type="email" maxlength="254"></label><button class="button main" type="submit">変更を申請する</button></form>`)+block('ログアウト',btn('ログアウト','logout','ghost')));
}
function homeAdmin(){const s=view.data;let pending=s.requests.filter(r=>r.status==='pending');let confirmed=s.requests.filter(r=>r.status==='confirmed');content(heading('ダッシュボード',`${s.user.name} 様`)+`<div class="metrics three"><div class="metric"><small>在籍会員</small><strong>${s.members.filter(x=>x.status==='active').length}</strong></div><div class="metric"><small>承認待ち</small><strong>${pending.length}</strong></div><div class="metric"><small>確定予約</small><strong>${confirmed.length}</strong></div></div>`+
 block('承認待ちの予約',pending.length?pending.slice(0,10).map(r=>rRow(r.member_name,fmt(r.starts_at),`<button class="button slim" data-action="approve" data-id="${h(r.id)}">承認</button><button class="button slim ghost" data-action="decline" data-id="${h(r.id)}">却下</button>`)).join(''):'<div class="empty">承認待ちはありません。</div>')+
 block('最近の予約',s.requests.slice(0,8).map(r=>rRow(r.member_name,fmt(r.starts_at),stat(r.status))).join('')||'<div class="empty">予約なし</div>'),'管理者');}
function bookingsAdmin(){const s=view.data;content(heading('予約管理','予約枠の公開・承認・キャンセル')+block('予約枠を追加',`<form data-form="slot" class="form-grid"><label>日付<input type="date" name="date" value="${today()}" required></label><label>開始時刻<select name="time">${Array.from({length:48},(_,i)=>`${String(Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`).filter(x=>x>='06:00'&&x<='23:00').map(x=>`<option>${x}</option>`).join('')}</select></label><label>予約方式<select name="mode"><option value="instant">即時確定</option><option value="approval">承認制</option></select></label><button class="button main" type="submit">予約枠を登録</button></form>`)+block('月ごとに公開',`<form data-form="publish" class="form-grid"><label>対象月<input type="month" name="month" value="${today().slice(0,7)}" required></label><button class="button main" type="submit">この月を公開</button></form>`)+block('予約一覧',s.requests.length?s.requests.map(r=>rRow(r.member_name,fmt(r.starts_at),`${stat(r.status)}${r.status==='pending'?`<button class="button slim" data-action="approve" data-id="${h(r.id)}">承認</button><button class="button slim ghost" data-action="decline" data-id="${h(r.id)}">却下</button>`:''}${r.status==='confirmed'?`<button class="button slim ghost" data-action="cancel-booking" data-id="${h(r.id)}">キャンセル</button>`:''}`)).join(''):'<div class="empty">まだ予約がありません。</div>')+block('登録済み予約枠',s.slots.length?s.slots.slice(0,35).map(z=>rRow(fmt(z.starts_at),z.mode==='approval'?'承認制':'即時確定',badge(z.enabled?'公開対象':'無効'))).join(''):'<div class="empty">予約枠がありません。</div>'),'1対1の予約');}
function membersAdmin(){const s=view.data;const authorized=s.user.role!=='staff';content(heading('会員管理','会員登録とLINEログイン招待')+(authorized?block('新規会員登録',`<form data-form="member"><label>氏名<input name="name" required maxlength="100"></label><label>フリガナ<input name="kana" maxlength="100"></label><label>電話番号<input name="phone" maxlength="30"></label><label>メール<input name="email" type="email"></label><button class="button main" type="submit">会員登録</button></form>`):'')+block('会員一覧',s.members.length?s.members.map(m=>rRow(m.display_name,m.id+' · '+({'active':'在籍','paused':'休会','left':'退会'}[m.status]||m.status),authorized&&m.status!=='left'?(m.line_linked?`${badge('LINE連携済み')}${s.user.role==='owner'?`<button class="button slim ghost" data-action="unlink-line" data-id="${h(m.id)}">LINE連携解除</button>`:''}`:`<button class="button slim ghost" data-action="invite" data-id="${h(m.id)}">LINE招待URL</button>`):'' )).join(''):'<div class="empty">会員が登録されていません。</div>')+ (authorized?`<div class="foot-action">${btn('連絡先の変更申請を確認','changes','ghost')}</div>`:''),'会員情報');}
function ticketsAdmin(){const s=view.data;if(s.user.role==='staff'){content(heading('チケット管理')+'<div class="empty">チケット管理権限がありません。</div>');return;}
 content(heading('チケット管理','メニュー・購入・入金・残数の管理')+block('チケットを手動付与',`<form data-form="manual-ticket"><label>会員<select name="memberId" required>${s.members.map(m=>`<option value="${h(m.id)}">${h(m.display_name)}</option>`).join('')}</select></label><label>付与回数<input name="count" type="number" min="1" max="200" value="1" required></label><label>有効開始日<input type="date" name="start" value="${today()}" required></label><label>有効期限（任意）<input type="date" name="end"></label><button class="button main" type="submit">チケットを付与</button></form>`)+block('メニュー登録',`<form data-form="menu"><label>メニュー名<input name="name" required></label><label>定価（税込円）<input name="price" type="number" min="0" value="8000" required></label><label>発行回数（0も可）<input name="count" type="number" min="0" value="1" required></label><label>有効日数（任意）<input name="days" type="number" min="1" placeholder="70"></label><label class="inline-checkbox"><input name="monthRequired" type="checkbox"> 対象月の入力必須</label><button class="button main" type="submit">メニューを追加</button></form>`)+block('購入登録',`<form data-form="purchase"><label>会員<select name="memberId">${s.members.map(m=>`<option value="${h(m.id)}">${h(m.display_name)}</option>`).join('')}</select></label><label>メニュー<select name="menuId" required>${s.menus.map(m=>`<option value="${h(m.id)}">${h(m.name)} / ${money(m.standard_price_yen)}</option>`).join('')}</select></label><label>販売金額<input name="price" type="number" min="0" required value="${s.menus[0]?.standard_price_yen||0}"></label><label>購入日<input name="date" type="date" required value="${today()}"></label><label>対象月（必要な場合）<input name="targetMonth" type="month"></label><button class="button main" type="submit">購入を登録</button></form>`)+block('入金登録',`<form data-form="payment"><label>購入<select name="purchaseId" required>${s.purchases.filter(p=>!p.canceled_at).map(p=>`<option value="${h(p.id)}">${h(s.members.find(m=>m.id===p.member_id)?.display_name||p.member_id)} ・${h(p.menu_name_at_sale)} ${money(p.actual_price_yen)}</option>`).join('')}</select></label><label>入金額<input type="number" min="1" name="amount" required></label><label>入金日<input type="date" name="date" value="${today()}" required></label><label>支払方法<input name="method" value="現金" required></label><button class="button main" type="submit">入金を登録</button></form>`)+block('チケット一覧',s.tickets.map(t=>rRow(s.members.find(m=>m.id===t.member_id)?.display_name||t.member_id,t.valid_from+'〜'+(t.expires_on||'期限なし'),badge(`${t.available_count} / ${t.initial_count} 回`))).join('')||'<div class="empty">まだありません</div>'),'チケット・会計');}
function settingsAdmin(){const user=view.data.user;content(heading('設定','セキュリティと運用状況')+block('ログイン情報',rRow('担当者',user.name)+rRow('権限',user.role)+btn('ログアウト','logout','ghost'))+block('本番構成',rRow('認証','パスワード・認証アプリ（メール送信なし）',badge('有効'))+rRow('データベース','Cloudflare D1で共有',badge('接続中'))+rRow('LINEログイン','LINE Developersのチャネル設定が必要')+`<p class="muted small">プッシュ通知、バックアップの自動実行・種類別復元、スタッフ招待、会計例外処理などは今後の開発対象です。実装済みと誤認しないよう、利用できない機能は表示していません。</p>`),'オーナー設定');}
function render(){liveRenderPending=false;if(!view.auth){disabled(view.error||'接続を確認中');return;}if(!view.auth.authenticated){loginScreen();return;}if(admin){({home:homeAdmin,booking:bookingsAdmin,members:membersAdmin,tickets:ticketsAdmin,settings:settingsAdmin}[view.tab]||homeAdmin)();}else{({home:homeMember,booking:memberBookings,tickets:ticketsMember,profile:profileMember}[view.tab]||homeMember)();}}
async function load(){try{const auth=await api('auth/me');const correctRole=auth.authenticated&&auth.user?.type===(admin?'staff':'member');view.auth=correctRole?auth:{...auth,authenticated:false,user:null};if(!(!admin&&new URLSearchParams(location.search).has('login')))view.error='';if(correctRole){view.data=await api(admin?'admin/state':'member/state');}else view.data=null;render();}catch(e){view.auth=null;disabled(errText(e));}}

/* Live data sync: only while the app is visible, with no disruptive page reload. */
let liveSyncPromise=null,liveRenderPending=false,liveRevision=undefined,refreshing=false,refreshToastTimer=null;
const dirtyForms=new WeakSet();
function liveCanRender(){
 if(view.busy||view.modal||view.challenge)return false;
 const active=document.activeElement;
 if(active&&root.contains(active)&&active.closest('form'))return false;
 return !Array.from(root.querySelectorAll('form[data-form]')).some(form=>dirtyForms.has(form));
}
function liveApplyPending(){
 if(!liveRenderPending||!liveCanRender())return;
 const scrollY=window.scrollY;
 render();
 window.scrollTo(0,scrollY);
}
async function liveSync(force=false){
 if((document.hidden&&!force)||view.busy)return false;
 if(liveSyncPromise){
   if(!force)return false;
   try{await liveSyncPromise;}catch{}
 }
 if(view.busy)return false;
 const task=(async()=>{
   try{
     if(!view.auth){await load();return true;}
     if(!view.auth.authenticated||!view.data)return false;
     let revision;
     if(!force){
       revision=await api('revision');
       if(view.busy||!view.auth?.authenticated)return false;
       if(liveRevision===revision.revision)return true;
     }
     const next=await api(admin?'admin/state':'member/state');
     if(view.busy||!view.auth?.authenticated)return false;
     liveRevision=force?undefined:revision.revision;
     if(JSON.stringify(next)!==JSON.stringify(view.data)){
       view.data=next;
       liveRenderPending=true;
       liveApplyPending();
     }
     return true;
   }catch(error){
     if(error.status===401&&!view.busy){await load();return false;}
     if(force)throw error;
     return false;
   }
 })();
 liveSyncPromise=task;
 try{return await task;}finally{if(liveSyncPromise===task)liveSyncPromise=null;}
}
function showRefreshMessage(message,error=false){
 let toast=document.querySelector('.refresh-toast');
 if(!toast){toast=document.createElement('div');toast.className='refresh-toast';toast.setAttribute('role','status');document.body.appendChild(toast);}
 toast.textContent=message;
 toast.classList.toggle('error',error);
 if(refreshToastTimer)clearTimeout(refreshToastTimer);
 refreshToastTimer=setTimeout(()=>toast.remove(),2400);
}
function updateRefreshButton(){
 const button=root.querySelector('[data-action="refresh-now"]');
 if(!button)return;
 button.disabled=refreshing;
 button.classList.toggle('is-refreshing',refreshing);
 button.setAttribute('aria-busy',String(refreshing));
}
async function refreshNow(){
 if(refreshing||view.busy)return;
 refreshing=true;
 updateRefreshButton();
 try{
   const ok=await liveSync(true);
   showRefreshMessage(ok?'最新情報に更新しました':'更新できませんでした。再度お試しください',!ok);
 }catch(error){showRefreshMessage(errText(error),true);}
 finally{refreshing=false;updateRefreshButton();}
}
const startLiveSync=()=>{liveSync().catch(()=>{});};
setInterval(startLiveSync,10000);
window.addEventListener('focus',startLiveSync);
window.addEventListener('pageshow',startLiveSync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)startLiveSync();});
window.addEventListener('online',startLiveSync);
document.addEventListener('input',event=>{const form=event.target.closest?.('form[data-form]');if(form)dirtyForms.add(form);});
document.addEventListener('change',event=>{const form=event.target.closest?.('form[data-form]');if(form)dirtyForms.add(form);});
document.addEventListener('focusout',()=>{setTimeout(liveApplyPending,0);});
async function mutate(path,data,msg){view.error='';view.success='';view.modalError='';try{await api(path,data);view.modal=null;await load();if(msg)notice(msg);}catch(e){if(view.modal){view.modalError=errText(e);render();}else notice(errText(e),true);}}
function modal(title,body){view.modalError='';view.modal=`<h2>${h(title)}</h2>${body}<button class="button ghost" data-action="close">閉じる</button>`;render();}
async function action(name,id){
 if(name==='refresh'){await load();return;}
 if(name==='refresh-now'){await refreshNow();return;}
 if(name==='view-notices'&&!admin){
   const notices=view.data?.notices||[];
   const body=notices.length?notices.map(n=>`<article class="notice-entry"><h3>${h(n.title)}</h3>${n.published_at?`<time>${h(fmt(n.published_at))}</time>`:''}<p>${h(n.body)}</p></article>`).join(''):'<div class="empty">新しいお知らせはありません。</div>';
   modal('お知らせ',`<div class="notice-list">${body}</div>`);
   return;
 }
 if(name==='cancel-otp'){view.challenge='';view.totpSetup=null;render();return;}
 if(name==='copy-totp'){try{await navigator.clipboard.writeText(view.totpSetup?.secret||'');notice('設定キーをコピーしました');}catch(e){notice('コピーできません。設定キーを長押ししてコピーしてください',true);}return;}
 if(name==='close'){view.modal=null;render();return;}
 if(name==='logout'){await mutate('auth/logout',{},'ログアウトしました');view.auth={authenticated:false,adminConfigured:true};view.data=null;view.success='';render();return;}
 if(name==='prev-month'||name==='next-month'){view.monthView=monthOffset(view.monthView,name==='prev-month'?-1:1);view.selectedDay=view.monthView+'-01';render();return;}
 if(name==='month-view'){view.calendarMode='month';view.monthView=view.selectedDay.slice(0,7);render();window.scrollTo(0,0);return;}
 if(name==='prev-week'||name==='next-week'){view.selectedDay=dateShift(view.selectedDay,name==='prev-week'?-7:7);view.monthView=view.selectedDay.slice(0,7);render();return;}
 if(name==='book'){const slot=view.data.slots.find(x=>x.id===id);if(!slot)return notice('予約枠の情報が更新されています。更新ボタンを押してください',true);modal('予約内容の確認',`<p class="muted">${h(fmt(slot.starts_at))} から60分</p><p>${slot.mode==='approval'?'承認申請を送信します。':'即時確定で予約します。'} チケットは予約確定時に消化します。</p><button class="button main" data-action="confirm-book" data-id="${h(id)}">${slot.mode==='approval'?'申請する':'予約を確定'}</button>`);return;}
 if(name==='confirm-book'){if(view.busy)return;view.busy=true;const button=document.querySelector('[data-action="confirm-book"]');if(button){button.disabled=true;button.textContent='送信中…';}try{await mutate('member/bookings',{slotId:id},'予約の受付処理が完了しました');}finally{view.busy=false;}return;}
 if(name==='withdraw'){await mutate('member/withdraw',{id},'承認待ち申請を取り消しました');return;}
 if(name==='approve'){if(!window.confirm('この予約を承認し、チケットを消化しますか？'))return;await mutate('admin/decision',{id,decision:'approve'},'予約を承認しました');return;}
 if(name==='decline'){modal('予約申請の却下',`<form data-form="decline" data-id="${h(id)}"><label>理由（任意）<textarea name="reason" maxlength="250" rows="3"></textarea></label><button class="button main" type="submit">申請を却下する</button></form>`);return;}
 if(name==='cancel-booking'){modal('確定予約のキャンセル',`<form data-form="cancel-booking" data-id="${h(id)}"><p>チケットの扱いを選択してください。</p><label><select name="returnTicket"><option value="yes">返却する</option><option value="no">消化したまま</option></select></label><button class="button main" type="submit">キャンセルを確定</button></form>`);return;}
 if(name==='unlink-line'){
   const member=view.data?.members.find(m=>m.id===id);
   if(!member||!member.line_linked)return notice('連携済み会員が見つかりません',true);
   const confirmation=window.prompt(member.display_name+' 様のLINE連携を解除します。会員端末からログアウトされ、元の招待URLも使用できなくなります。続行する場合は「LINE連携解除」と入力してください。');
   if(confirmation!=='LINE連携解除')return;
   await mutate('admin/line-unlink',{memberId:id,confirm:confirmation},'LINE連携を解除しました。必要に応じて新しい招待URLを発行してください');
   return;
 }
 if(name==='invite'){try{const r=await api('admin/invites',{memberId:id});modal('会員用招待リンク',`<p>有効期限は72時間です。本人確認のうえ会員様へ安全に共有してください。</p><div class="copy-text">${h(r.inviteUrl)}</div><button class="button main" data-action="copy-invite" data-value="${h(r.inviteUrl)}">招待URLをコピー</button>`);}catch(e){notice(errText(e),true);}return;}
 if(name==='copy-invite'){const el=document.querySelector('[data-action="copy-invite"]');try{await navigator.clipboard.writeText(el?.dataset.value||'');notice('招待URLをコピーしました');}catch(e){notice('コピーできません。招待URLを選択してください',true);}return;}
 if(name==='changes'){try{const r=await api('admin/change-requests');modal('連絡先変更申請',r.requests.map(c=>`<div class="line-item"><div><strong>${h(c.display_name)}</strong><small>${h(c.requested_phone||'')} / ${h(c.requested_email||'')}</small></div><button class="button slim" data-action="change-approve" data-id="${h(c.id)}">承認</button><button class="button slim ghost" data-action="change-decline" data-id="${h(c.id)}">却下</button></div>`).join('')||'<p>承認待ちはありません。</p>');}catch(e){notice(errText(e),true);}return;}
 if(name==='change-approve'||name==='change-decline'){await mutate('admin/change-decision',{id,decision:name==='change-approve'?'approve':'decline'},'処理しました');return;}
}
async function submit(form){const data=Object.fromEntries(new FormData(form));const name=form.dataset.form;
 if(name==='setup'){if(data.password.length<14)return notice('パスワードは14文字以上にしてください',true);const passwordSalt=hex(crypto.getRandomValues(new Uint8Array(32)));const passwordVerifier=await derivePassword(data.password,passwordSalt);await mutate('setup/owner',{name:data.name,email:data.email,setupToken:data.setupToken,passwordSalt,passwordVerifier},'オーナーを登録しました。次にログインしてください');return;}
 if(name==='login'){try{const salt=(await api('auth/admin/salt',{email:data.email})).salt;const passwordVerifier=await derivePassword(data.password,salt);const r=await api('auth/admin/login',{email:data.email,passwordVerifier});view.challenge=r.challengeId;view.totpSetup=r.setup||null;view.error='';view.success='';render();}catch(e){notice(errText(e),true);}return;}
 if(name==='otp'){try{await api('auth/admin/verify',{challengeId:view.challenge,code:data.code});view.challenge='';view.totpSetup=null;await load();}catch(e){notice(errText(e),true);}return;}
 if(name==='contact'){await mutate('member/contact-change',data,'変更を申請しました');return;}
 if(name==='member'){await mutate('admin/members',data,'会員を登録しました');return;}
 if(name==='slot'){await mutate('admin/slots',data,'予約枠を登録しました');return;}
 if(name==='publish'){await mutate('admin/publish',data,'対象月を公開しました');return;}
 if(name==='manual-ticket'){await mutate('admin/manual-ticket',{memberId:data.memberId,count:Number(data.count),start:data.start,end:data.end},'チケットを付与しました');return;}
 if(name==='menu'){await mutate('admin/menus',{name:data.name,price:Number(data.price),count:Number(data.count),days:data.days?Number(data.days):null,monthRequired:data.monthRequired==='on'},'メニューを登録しました');return;}
 if(name==='purchase'){await mutate('admin/purchases',{memberId:data.memberId,menuId:data.menuId,price:Number(data.price),date:data.date,targetMonth:data.targetMonth},'購入を登録しました');return;}
 if(name==='payment'){await mutate('admin/payments',{purchaseId:data.purchaseId,amount:Number(data.amount),date:data.date,method:data.method},'入金を登録しました');return;}
 if(name==='decline'){await mutate('admin/decision',{id:form.dataset.id,decision:'decline',reason:data.reason},'申請を却下しました');return;}
 if(name==='cancel-booking'){await mutate('admin/cancel-booking',{id:form.dataset.id,returnTicket:data.returnTicket==='yes'},'予約をキャンセルしました');return;}
}
let tabPointer=null,suppressTabClickUntil=0;
const tabIndexAtX=(x,rect)=>Math.max(0,Math.min(nav.length-1,Math.floor(((x-rect.left-6)/Math.max(1,rect.width-12))*nav.length)));
const moveTabIndicator=(bar,x,rect)=>{const position=Math.max(0,Math.min(nav.length-1,((x-rect.left-6)/Math.max(1,rect.width-12))*nav.length-.5));const indicator=bar.querySelector('.tab-indicator');if(indicator)indicator.style.transform='translateX('+position*100+'%)';};
const finishTabPointer=(e,canceled=false)=>{if(!tabPointer||e.pointerId!==tabPointer.pointerId)return;const start=tabPointer;tabPointer=null;start.bar.classList.remove('dragging');try{start.bar.releasePointerCapture(e.pointerId);}catch(_){}const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!canceled&&start.moved&&Math.abs(dx)>Math.abs(dy)){const index=tabIndexAtX(e.clientX,start.rect),next=nav[index]?.[0];suppressTabClickUntil=Date.now()+700;if(next){view.tab=next;if(view.tab==='booking'&&!admin){view.calendarMode='month';view.monthView=view.selectedDay.slice(0,7);}view.modal=null;view.error='';view.success='';render();window.scrollTo(0,0);}}else{const index=Math.max(0,nav.findIndex(([id])=>id===view.tab));const indicator=start.bar.querySelector('.tab-indicator');if(indicator)indicator.style.transform='translateX('+index*100+'%)';}};
document.addEventListener('pointerdown',e=>{const bar=e.target.closest('.tabbar');if(!bar||e.button!==0)return;const rect=bar.getBoundingClientRect();tabPointer={pointerId:e.pointerId,x:e.clientX,y:e.clientY,rect,bar,moved:false};bar.classList.add('dragging');try{bar.setPointerCapture(e.pointerId);}catch(_){}},{passive:true});
document.addEventListener('pointermove',e=>{if(!tabPointer||e.pointerId!==tabPointer.pointerId)return;const dx=e.clientX-tabPointer.x,dy=e.clientY-tabPointer.y;if(Math.abs(dy)>Math.abs(dx)+8)return;if(Math.abs(dx)>6)tabPointer.moved=true;moveTabIndicator(tabPointer.bar,e.clientX,tabPointer.rect);},{passive:true});
document.addEventListener('pointerup',e=>finishTabPointer(e,false),{passive:true});
document.addEventListener('pointercancel',e=>finishTabPointer(e,true),{passive:true});
document.addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab&&Date.now()<suppressTabClickUntil){e.preventDefault();e.stopPropagation();return;}if(tab&&Date.now()<suppressTabClickUntil){e.preventDefault();e.stopPropagation();return;}if(tab){view.tab=tab.dataset.tab;if(view.tab==='booking'&&!admin){view.calendarMode='month';view.monthView=view.selectedDay.slice(0,7);}view.modal=null;view.error='';view.success='';render();window.scrollTo(0,0);return;}const day=e.target.closest('[data-day]');if(day){view.selectedDay=day.dataset.day;view.calendarMode='week';render();window.scrollTo(0,0);return;}const weekDay=e.target.closest('[data-week-day]');if(weekDay){view.selectedDay=weekDay.dataset.weekDay;render();return;}const btn=e.target.closest('[data-action]');if(btn){e.preventDefault();action(btn.dataset.action,btn.dataset.id).catch(err=>notice(errText(err),true));}});
document.addEventListener('submit',e=>{const f=e.target;if(!(f instanceof HTMLFormElement))return;e.preventDefault();if(view.busy)return;view.busy=true;submit(f).catch(err=>notice(errText(err),true)).finally(()=>{view.busy=false;});});
const qp=new URLSearchParams(location.search);const invite=qp.get('invite');if(invite&&/^[0-9a-f]{64}$/.test(invite)){view.invite=invite;history.replaceState(null,'',location.pathname);}if(!admin&&qp.get('login')){view.error='LINEログインが完了しませんでした。招待リンク・登録状況を確認してください。';}

// On iOS Safari (including Home Screen), block two-finger pinch/gesture zoom.
// One-finger vertical and horizontal scrolling remains enabled.
const preventAppZoom=event=>{if(event.cancelable)event.preventDefault();};
for(const kind of ['gesturestart','gesturechange','gestureend'])document.addEventListener(kind,preventAppZoom,{passive:false});
document.addEventListener('touchmove',event=>{if(event.touches.length>1)preventAppZoom(event);},{passive:false});
view.selectedDay=today();view.monthView=today().slice(0,7);load();
})();
