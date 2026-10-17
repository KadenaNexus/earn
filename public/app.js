import { EckoWallet } from './wallet.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:6});
const date=s=>new Date(s).toLocaleString();
const short=s=>s?`${s.slice(0,10)}…${s.slice(-6)}`:'';
const state={user:null,csrf:null,config:null,tasks:[],mine:[],work:[],board:[],category:'All',mineFilter:'all',doneFilter:'All',view:'explore',tab:'review',selected:null,cur:null,drawer:false,creating:false,pauseBusy:false,pauseReconciling:false,pausePending:null,pausePaused:false};
let wallet,pauseVersion=0,kpiVersion=0,adminRenderVersion=0;
const AI_REASON={low_confidence:'Low confidence',duplicate:'Same proof as another submission',max_rounds:'Change-request limit reached',daily_limit:'Daily AI payout limit reached',over_task_limit:'Reward above the AI limit',paused:'Payouts paused',switched_off:'Switched off',unclear_request:'Unclear change request',changed_during_review:'Proof changed during review'};
const labels={started:'Started',expired:'Slot expired',reserving:'Confirming reservation',reservation_failed:'Reservation failed',in_review:'In review',changes_requested:'Changes requested',approved:'Approved',rejected:'Rejected',paid:'Paid',payout_failed:'Payout failed',pending:'Pending',sending:'Sending',confirmed:'Confirmed',failed:'Failed',draft:'Draft',funding:'Funding',funding_failed:'Funding failed',open:'Open',ended:'Ended, settling work',settled:'Settled'};
const badge=s=>`<span class="badge ${['paid','confirmed','open'].includes(s)?'ok':['failed','payout_failed','rejected','reservation_failed'].includes(s)?'bad':'warn'}">${esc(labels[s]||s)}</span>`;
function notify(message){$('#notice').className='notice';$('#notice').textContent=message;$('#notice').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#notice').hidden=true,9000);}
function txLink(key){return key&&/^[\w-]{43}$/.test(key)?`<a href="${esc(state.config.explorer+encodeURIComponent(key)+'?chain=1')}" target="_blank" rel="noopener noreferrer" title="${esc(key)}">${esc(short(key))}</a>`:'';}
function link(label,url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;}catch{return '';}}
async function api(path,body,options={}){
 const headers={};if(body!==undefined){headers['content-type']='application/json';if(state.csrf)headers['x-csrf-token']=state.csrf;}
 if(options.money)headers['idempotency-key']=options.key||crypto.randomUUID();
 const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
 const data=await r.json();if(!r.ok){const error=new Error(data.error||'Request failed');error.status=r.status;throw error;}return data;
}
async function action(button,fn){if(button?.disabled)return;const old=button?.textContent;if(button){button.disabled=true;button.textContent='Working…';}try{await fn();}catch(e){notify(e.message);}finally{if(button?.isConnected){button.disabled=false;if(button.textContent==='Working…')button.textContent=old;}}}
function owner(){return state.user?.role==='admin';}
function sessionUI(){
 $('#networkLabel').textContent=(state.config.network==='development'?'Local development chain':state.config.network==='mainnet01'?'Kadena mainnet':'Kadena '+state.config.network)+' · Chain '+state.config.chain;
 $$('[data-go="admin"],[data-go="create"]').forEach(b=>b.hidden=!owner());
 $('#walletBtn').textContent=state.user?short(state.user.account):'Connect Ecko';
 $('#walletAcct').textContent=state.user?.account||'';
 if(!state.user)walletMenu(false);
 fitHeader();
 $('#walletBtn').title=state.user?.account||'Connect your desktop Ecko wallet';
 $('#cRev').value=state.config.admin_account;
 if(!owner()&&['admin','create'].includes(state.view))go('explore');
}
async function connect(){
 wallet=new EckoWallet();const account=await wallet.connect(state.config.network);
 const challenge=await api('/auth/nonce',{account});
 const signed_command=await wallet.sign(challenge.command);
 const session=await api('/auth/verify',{account,nonce:challenge.nonce,signed_command});
 state.user=session.user;state.csrf=session.csrf;sessionUI();await refresh();
 notify('Wallet connected. Sign-in does not send a transaction or spend KDA.');
}
function walletMenu(open){const m=$('#walletMenu');m.hidden=!open;$('#walletBtn').setAttribute('aria-expanded',String(open));}
function fitHeader(){const top=$('header.top'),w=$('header.top .wrap'),n=$('header.top nav.primary');if(!top||!w||!n||typeof w.scrollWidth!=='number')return;const over=()=>w.scrollWidth>w.clientWidth+1||n.scrollWidth>n.clientWidth+1;top.classList.remove('tight','tighter','tightest');const short_=[...document.querySelectorAll?.('nav.primary [data-short]')||[]];short_.forEach(b=>{b.dataset.full??=b.textContent;b.textContent=b.dataset.full;});const btn=$('#walletBtn'),acct=state.user?.account;if(acct)btn.textContent=short(acct);if(over())top.classList.add('tight');if(over())top.classList.add('tighter');if(over()&&acct){btn.textContent=`${acct.slice(0,6)}…${acct.slice(-4)}`;}if(over())short_.forEach(b=>b.textContent=b.dataset.short);if(over())top.classList.add('tightest');}
window.addEventListener?.('resize',fitHeader);
document.fonts?.ready.then(fitHeader);
$('#walletBtn').onclick=e=>{if(state.user){e.stopPropagation();walletMenu($('#walletMenu').hidden);}else action($('#walletBtn'),connect);};
$('#walletOut').onclick=()=>action($('#walletOut'),async()=>{walletMenu(false);await api('/auth/logout',{});state.user=null;state.csrf=null;state.mine=[];sessionUI();closeDrawer();await refresh();});
$('#walletCopy').onclick=async()=>{try{await navigator.clipboard.writeText(state.user?.account||'');notify('Address copied.');}catch{notify(state.user?.account||'');}walletMenu(false);};
document.addEventListener('click',e=>{if(!e.target?.closest?.('.wallet-wrap'))walletMenu(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')walletMenu(false);});
async function go(view){
 if(['admin','create'].includes(view)&&!owner())return;
 state.view=view;$$('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+view));
 $$('[data-go]').forEach(b=>b.dataset.go===view?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
 window.scrollTo({top:0});if(view==='admin')await renderAdmin();
 if(view==='mine')renderMine();
}
$$('[data-go]').forEach(b=>b.onclick=()=>action(null,()=>go(b.dataset.go)));
$('.brand').onclick=e=>{e.preventDefault();go('explore');};
$('#themeBtn').onclick=()=>{const r=document.documentElement;r.dataset.theme=(r.dataset.theme|| (matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'))==='light'?'dark':'light';localStorage.setItem('ke-theme',r.dataset.theme);};
try{const t=localStorage.getItem('ke-theme');if(['dark','light'].includes(t))document.documentElement.dataset.theme=t;}catch{}
const categories=['All','Testing','Ecosystem','Social','Community'];
$('#chips').innerHTML=categories.map(c=>`<button class="chip" aria-pressed="${c==='All'}" data-category="${c}">${c==='All'?'All tasks':c}</button>`).join('');
$('#chips').onclick=e=>{const b=e.target.closest('[data-category]');if(b){state.category=b.dataset.category;$$('#chips button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderTasks();}};
$('#q').oninput=renderTasks;$('#sort').onchange=renderTasks;
function card(t,interactive=true){const pct=t.max?Math.max(0,Math.min(100,t.left/t.max*100)):0;return `<article class="task ${t.featured&&interactive?'featured':''}"><div class="meta"><span class="cat">${esc(t.cat)}</span><span>${esc(t.sponsor)}</span>${t.ai?'<span class="badge ai">Reviewed &amp; paid by AI</span>':''}${t.ends<=7?`<span class="badge warn">Ends in ${t.ends}d</span>`:''}</div><h3>${esc(t.title)}</h3><p>${esc(t.sum)}</p><div class="foot"><div><b class="kda ${t.featured&&interactive?'lg':''}">${fmt(t.reward)}</b><div class="time">${t.mins} min</div></div><div class="escrow" style="min-width:110px;text-align:right">${t.left} of ${t.max} left<div class="track"><i style="width:${pct}%"></i></div></div></div>${interactive?`<button class="stretch" data-task="${esc(t.id)}" aria-label="Open task: ${esc(t.title)}"></button>`:''}</article>`;}
function renderTasks(){const q=$('#q').value.toLowerCase();let tasks=state.tasks.filter(t=>(state.category==='All'||t.cat===state.category)&&(!q||(t.title+t.sum+t.sponsor).toLowerCase().includes(q)));const sort={reward:(a,b)=>Number(b.reward)-Number(a.reward),time:(a,b)=>a.mins-b.mins,ending:(a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline)}[$('#sort').value];if(sort)tasks.sort(sort);$('#grid').innerHTML=tasks.length?tasks.map(t=>card(t)).join(''):'<div class="empty">No funded, open tasks yet. Campaigns appear here after their funding confirms.</div>';}
$('#grid').onclick=e=>{const b=e.target.closest('[data-task]');if(b)action(null,()=>openTask(b.dataset.task));};
async function loadPersonal(){if(!state.user){state.mine=[];for(const id of ['heroEarned','heroPending','tPaid','tApproved','tReview'])$('#'+id).textContent='0';return;}
 const [mine,rewards]=await Promise.all([api('/me/tasks'),api('/me/rewards')]);state.mine=mine;
 for(const [id,key]of [['heroEarned','paid'],['heroPending','review'],['tPaid','paid'],['tApproved','approved'],['tReview','review']])$('#'+id).textContent=fmt(rewards[key]);renderMine();
}
function renderMine(){
 if(!state.user){$('#rows').innerHTML='<li class="empty">Connect your Ecko wallet to view your tasks.</li>';return;}
 const filters={review:['reserving','in_review','changes_requested'],approved:['approved','payout_failed'],paid:['paid']};
 const mine=state.mine.filter(m=>state.mineFilter==='all'||filters[state.mineFilter]?.includes(m.s));
 $('#rows').innerHTML=mine.length?mine.map(m=>`<li><div><button class="ghostbtn" data-mine="${esc(m.campaign_id)}">${esc(m.t)}</button><div class="s">${date(m.when)} ${m.tx?' · '+txLink(m.tx):''}</div>${m.review_note?`<div class="status-note">${/^AI reviewer:/.test(m.review_note)?'':'Reviewer: '}${esc(m.review_note)}</div>`:''}${m.error?`<div class="status-note">${esc(m.error)}</div>`:''}</div>${badge(m.s)}<b class="kda">${fmt(m.r)}</b></li>`).join(''):'<li class="empty">No tasks in this view yet.</li>';
}
$('#mineTabs').onclick=e=>{const b=e.target.closest('[data-f]');if(b){state.mineFilter=b.dataset.f;$$('#mineTabs button').forEach(x=>x.setAttribute('aria-selected',x===b));renderMine();}};
$('#rows').onclick=e=>{const b=e.target.closest('[data-mine]');if(b)action(null,()=>openTask(b.dataset.mine));};
async function openTask(id){state.cur=await api('/tasks/'+id);await loadPersonal();state.drawer=true;renderDrawer();$('#drawer').inert=false;$('#drawer').classList.add('on');$('#scrim').classList.add('on');$('#drawer').setAttribute('aria-hidden','false');$('#dClose').focus();}
function closeDrawer(){state.drawer=false;$('#drawer').inert=true;$('#drawer').classList.remove('on');$('#scrim').classList.remove('on');$('#drawer').setAttribute('aria-hidden','true');}
$('#dClose').onclick=closeDrawer;$('#scrim').onclick=closeDrawer;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();if(e.key==='Tab'&&state.drawer){const elements=$$('#drawer button:not(:disabled),#drawer input,#drawer textarea,#drawer a[href]');const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
function renderDrawer(){
 const t=state.cur,m=state.mine.find(x=>String(x.campaign_id)===String(t.id));
 const submit=m&&(m.s==='started'&&Date.parse(m.expires_at)>Date.now()||m.s==='changes_requested');
 const stage=!m||['expired','reservation_failed'].includes(m.s)?0:submit?1:m.s==='paid'?3:2;
 $('#dFunded').textContent=t.status==='open'?`Escrow funded by ${t.sponsor}`:labels[t.status];
 let body=`<span class="cat">${esc(t.cat)} · ${esc(t.type)}</span><h2 id="dTitle">${esc(t.title)}</h2><div class="rewardrow"><b class="kda xl">${fmt(t.reward)}</b><div class="time">${t.mins} min<br>Deadline: ${date(t.deadline)}</div></div><div class="stepper">${[0,1,2,3].map(i=>`<span class="${i<=stage?'done':''}"></span>`).join('')}</div><div class="stepnames">${['Start','Submit proof','In review','Paid'].map((s,i)=>i===stage?`<b>${s}</b>`:`<span>${s}</span>`).join('')}</div>`;
 let foot='';
 if(stage===0){const s=t.escrow;body+=`<div class="sec"><h3>What to do</h3><ol class="steps">${t.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>${t.ai?'<div class="sec"><p class="ai-line"><span class="badge ai">Reviewed &amp; paid by AI agent</span> An AI agent reviews this task and pays approved proof from escrow, usually within minutes. If it is unsure, a human reviewer decides.</p></div>':''}<div class="sec"><h3>Proof you’ll submit</h3><ul class="proof">${t.proof_schema.map(f=>`<li>${esc(f.label)}${f.private?' · reviewer only':''}</li>`).join('')}</ul></div><div class="sec"><h3>Campaign escrow</h3>${s?`<div class="ledger"><div><span>Funded</span><b class="kda">${fmt(s.funded)}</b></div><div><span>Paid</span><b class="kda">${fmt(s.paid)}</b></div><div><span>Remaining</span><b class="kda">${fmt(s.remaining)}</b></div></div><p class="note">Last checked: ${date(s.checked_at)}. Your slot is held for up to 30 minutes, until the deadline.</p>`:'<p>Escrow status is being checked.</p>'}</div>`;
   foot=`<button class="btn" id="startTask" ${t.status!=='open'||t.left<=0||!state.config.writes_enabled?'disabled':''}>${state.user?'Start task':'Connect Ecko to start'}</button>`;
 }else if(submit){
   body+=`<div class="sec">${m.review_note?`<p class="status-note">${/^AI reviewer:/.test(m.review_note)?'':'Reviewer: '}${esc(m.review_note)}</p>`:''}<h3>Submit your proof</h3><p class="note">${m.s==='changes_requested'?'Your reward remains reserved while you make these changes.':'Slot held until '+date(m.expires_at)+'.'}</p><form id="proofForm" class="form">${t.proof_schema.map(f=>`<div class="field"><label for="proof-${esc(f.key)}">${esc(f.label)}${f.private?' · Private':''}</label>${f.type==='url'?`<input type="url" id="proof-${esc(f.key)}" name="${esc(f.key)}" placeholder="https://" value="${esc(m.proof_json?.[f.key]||'')}" ${f.required?'required':''}>`:`<textarea id="proof-${esc(f.key)}" name="${esc(f.key)}" minlength="${f.min_len}" maxlength="12000" ${f.required?'required':''}>${esc(m.proof_json?.[f.key]||'')}</textarea>`}<small>${f.type==='url'?'Paste a link; file uploads come later.':`At least ${f.min_len} characters.`}</small></div>`).join('')}<label><input type="checkbox" id="publicConsent" ${m.public_consent?'checked':''}> Publish my non-private proof on Completed work if I’m paid.</label></form></div>`;
   foot='<button class="btn" id="submitProof">Submit proof</button>';
 }else{body+=`<div class="sec">${badge(m.s)}<p class="status-note">${esc(m.review_note||({reserving:'Confirming your reward reservation on chain. Your proof enters the review queue after confirmation.',in_review:'Your proof is waiting for the owner’s review.',approved:'Approved. The owner can now send your payout.',payout_failed:'Approved, but the transaction failed. The owner can retry it.',rejected:'This submission was rejected.',paid:'Your reward has been confirmed on chain.'}[m.s]||''))}</p>${m.s==='paid'?`<div><b class="kda xl">${fmt(m.r)}</b></div><p>Paid to ${esc(short(state.user.account))}</p>`:''}${m.tx?`<p>Transaction: ${txLink(m.tx)}</p>`:''}</div>`;foot='<button class="btn ghost" id="closeProof">Back to tasks</button>';}
 $('#dBody').innerHTML=body;$('#dFoot').innerHTML=foot;
 if($('#startTask'))$('#startTask').onclick=()=>action($('#startTask'),async()=>{if(!state.user)await connect();await api('/tasks/'+t.id+'/start',{});await loadPersonal();renderDrawer();});
 if($('#submitProof'))$('#submitProof').onclick=()=>action($('#submitProof'),async()=>{if(!$('#proofForm').reportValidity())return;const proof=Object.fromEntries(new FormData($('#proofForm')));await api('/tasks/'+t.id+'/submit',{proof,public_consent:$('#publicConsent').checked});await loadPersonal();renderDrawer();notify('Proof saved. Confirming its escrow reservation.');});
 if($('#closeProof'))$('#closeProof').onclick=closeDrawer;
}
function renderBoard(){const rows=state.board;$('#podium').innerHTML=rows.slice(0,3).map((r,i)=>`<div><div class="rank">${i+1}</div><div class="n">${esc(r.name)}</div><span class="time">${r.done} paid tasks</span><div style="margin-top:10px"><b class="kda lg">${fmt(r.earned)}</b></div></div>`).join('');$('#lb tbody').innerHTML=rows.length?rows.map((r,i)=>`<tr class="${r.you?'you':''}"><td class="r">${i+1}</td><td>${esc(r.name)}${r.you?' (you)':''}</td><td>${Number(r.done)>=50?'Gold':Number(r.done)>=10?'Silver':'Bronze'}</td><td>${r.done}</td><td><b class="kda">${fmt(r.earned)}</b></td></tr>`).join(''):'<tr><td colspan="5" class="empty">The leaderboard fills after confirmed payouts.</td></tr>';}
$('#doneChips').innerHTML=categories.map(c=>`<button class="chip" aria-pressed="${c==='All'}" data-done="${c}">${c==='All'?'All work':c}</button>`).join('');
$('#doneChips').onclick=e=>{const b=e.target.closest('[data-done]');if(b){state.doneFilter=b.dataset.done;$$('#doneChips button').forEach(x=>x.setAttribute('aria-pressed',x===b));renderWork();}};$('#doneQ').oninput=renderWork;
function renderWork(){const q=$('#doneQ').value.toLowerCase();const rows=state.work.filter(w=>(state.doneFilter==='All'||w.cat===state.doneFilter)&&(!q||(w.t+w.f+w.by+w.sp).toLowerCase().includes(q)));$('#log').innerHTML=rows.length?rows.map(w=>`<li><div class="logdate">${new Date(w.d).toLocaleDateString()}</div><div><h3>${esc(w.t)}</h3><p class="status-note">${esc(w.f)}</p><div class="time">${esc(w.by)} · ${esc(w.sp)} · ${esc(w.cat)}${w.ai?` · <a class="badge ai" href="/ai-receipts/${esc(w.receipt)}" title="See the AI review receipt">Reviewed &amp; paid by AI agent</a>`:''}</div><div>${w.links.map(([label,url])=>link(label,url)).join(' · ')} ${txLink(w.tx)}</div></div><b class="kda">${fmt(w.r)}</b></li>`).join(''):'<li class="empty">Paid work will appear here automatically.</li>';}

const templates=[['Try & Review','Testing'],['Fix the Ecosystem','Ecosystem'],['Discover & List','Ecosystem'],['Create & Share','Social'],['AMA','Community']];
let selectedTemplate=0,steps=['Complete the task described above','Describe your experience and paste supporting links'],fields=[{key:'feedback',label:'Your feedback',type:'text',min_len:40,required:true,private:false},{key:'evidence',label:'Supporting link or screenshot link',type:'url',min_len:0,required:true,private:true}];
$('#tpl').innerHTML=templates.map(([label],i)=>`<button class="chip" aria-pressed="${i===0}" data-template="${i}">${label}</button>`).join('');
$('#tpl').onclick=e=>{const b=e.target.closest('[data-template]');if(b){selectedTemplate=Number(b.dataset.template);$$('#tpl button').forEach(x=>x.setAttribute('aria-pressed',x===b));calc();}};
$('#cProof').onchange=()=>{const choice=$('#cProof').value;fields=choice==='Link to original post'?[{key:'post_text',label:'Original post text',type:'text',min_len:80,required:true,private:false},{key:'post_link',label:'Link to original post',type:'url',min_len:0,required:true,private:false}]:[{key:'finding',label:choice==='Reviewer confirmation'?'Written summary':'Your finding or feedback',type:'text',min_len:40,required:true,private:false},{key:'evidence',label:'Supporting link',type:'url',min_len:0,required:true,private:true}];drawBuilders();calc();};
function drawBuilders(){
 $('#stepsB').innerHTML=`<h4>Instructions <button class="sm" id="addStep">Add step</button></h4>${steps.map((s,i)=>`<div class="qq"><div class="head"><b>${i+1}</b><input data-step="${i}" value="${esc(s)}" aria-label="Instruction ${i+1}"><button class="sm bad" data-del-step="${i}">Remove</button></div></div>`).join('')}`;
 $('#pb').innerHTML=`<h4>Proof fields <button class="sm" id="addField">Add field</button></h4>${fields.map((f,i)=>`<div class="qq"><div class="head"><input data-label="${i}" value="${esc(f.label)}" aria-label="Proof field ${i+1} label"><select data-type="${i}" aria-label="Proof field ${i+1} type"><option value="text" ${f.type==='text'?'selected':''}>Text</option><option value="url" ${f.type==='url'?'selected':''}>Link</option></select><button class="sm bad" data-del-field="${i}">Remove</button></div><div class="two"><label>Minimum characters <input data-min="${i}" type="number" min="0" max="2000" value="${f.min_len}"></label><div><label><input data-private="${i}" type="checkbox" ${f.private?'checked':''}> Private</label> <label><input data-required="${i}" type="checkbox" ${f.required?'checked':''}> Required</label></div></div></div>`).join('')}`;
 $('#addStep').onclick=()=>{if(steps.length<20){steps.push('');drawBuilders();calc();}};
 $('#addField').onclick=()=>{if(fields.length<20){fields.push({key:'field_'+crypto.randomUUID().replaceAll('-','').slice(0,12),label:'',type:'text',min_len:0,required:true,private:false});drawBuilders();calc();}};
 $$('[data-del-step]').forEach(b=>b.onclick=()=>{steps.splice(Number(b.dataset.delStep),1);drawBuilders();calc();});
 $$('[data-del-field]').forEach(b=>b.onclick=()=>{fields.splice(Number(b.dataset.delField),1);drawBuilders();calc();});
 $$('[data-step]').forEach(i=>i.oninput=()=>{steps[Number(i.dataset.step)]=i.value;calc();});
 for(const [attr,key,read] of [['label','label',i=>i.value],['type','type',i=>i.value],['min','min_len',i=>Number(i.value)],['private','private',i=>i.checked],['required','required',i=>i.checked]])$$(`[data-${attr}]`).forEach(i=>i.oninput=()=>{fields[Number(i.dataset[attr])][key]=read(i);calc();});
}
function formCampaign(){const selectedDeadline=new Date($('#cDeadline').value);return {title:$('#cTitle').value.trim(),summary:$('#cDesc').value.trim(),sponsor_name:$('#cSponsor').value.trim(),category:templates[selectedTemplate][1],template:templates[selectedTemplate][0],reward_kda:$('#cReward').value,max_rewards:Number($('#cCount').value),minutes_estimate:Number($('#cMins').value),deadline:Number.isFinite(selectedDeadline.getTime())?selectedDeadline.toISOString():'',steps,proof_schema:fields,ai_review:$('#cAi').checked,...($('#cAi').checked&&$('#cAiCrit').value.trim()?{ai_criteria:$('#cAiCrit').value.trim()}:{})};}
$('#cAi').onchange=()=>{$('#cAiCritWrap').hidden=!$('#cAi').checked;const cap=state.config?.ai_review_max_reward_kda;if($('#cAi').checked&&cap&&Number($('#cReward').value)>Number(cap))notify(`The AI reviewer only pays tasks up to ${cap} KDA. Larger rewards stay in your review queue.`);};
function calc(){
 const input=formCampaign(),pool=Number(input.reward_kda)*input.max_rewards;
 const configuredCap=Number(state.config?.task_reward_cap_kda||$('#cReward').max||5000),rewardCap=Number.isFinite(configuredCap)&&configuredCap>0?configuredCap:5000;
 $('#cReward').max=String(rewardCap);$('#cRewardLimit').textContent=`Maximum ${fmt(rewardCap)} KDA per completed task.`;
 const validReward=/^\d+(?:\.\d{1,6})?$/.test(input.reward_kda)&&Number(input.reward_kda)>0&&Number(input.reward_kda)<=rewardCap;
 const validSlots=Number.isInteger(input.max_rewards)&&input.max_rewards>=1&&input.max_rewards<=10000;
 $('#kPool').textContent=fmt(pool)+' KDA';$('#kTotal').textContent=fmt(pool)+' KDA';
 const t={cat:input.category,title:input.title||'Your task title',sum:input.summary||'What contributors will do',sponsor:input.sponsor_name||'Kadena Earn',reward:input.reward_kda,mins:input.minutes_estimate,left:input.max_rewards,max:input.max_rewards,ends:Math.max(0,Math.ceil((Date.parse(input.deadline)-Date.now())/86400000))};
 $('#preview').innerHTML=card(t,false);
 const valid=input.title.length>=8&&input.summary.length>=20&&input.sponsor_name.length>=2&&validReward&&validSlots&&Date.parse(input.deadline)>Date.now()+60000&&steps.length&&steps.every(s=>s.trim())&&fields.length&&fields.every(f=>f.label.trim());
 $('#fundBtn').disabled=!valid||state.creating||!state.config?.writes_enabled;$('#fundBtn').textContent=`Create & fund ${fmt(pool)} KDA`;
 if(!state.creating)$('#fundState').textContent=!validReward?`Maximum ${fmt(rewardCap)} KDA per completed task. Enter a positive amount with at most six decimal places.`:!validSlots?'Choose between 1 and 10,000 reward slots.':valid?'Your wallet signs funding. The task opens after confirmation.':'Complete the title, description, deadline, steps and proof fields.';
}
$$('#cTitle,#cDesc,#cSponsor,#cReward,#cCount,#cMins,#cDeadline').forEach(i=>i.oninput=calc);
const defaultDeadline=new Date();defaultDeadline.setDate(defaultDeadline.getDate()+7);defaultDeadline.setHours(23,59,0,0);
$('#cDeadline').value=new Date(defaultDeadline.getTime()-defaultDeadline.getTimezoneOffset()*60000).toISOString().slice(0,16);drawBuilders();
async function fundCampaign(id){wallet||=new EckoWallet();const connected=await wallet.connect(state.config.network);if(connected!==state.user.account)throw new Error('Select the signed-in owner account in Ecko.');const prepared=await api('/admin/campaigns/'+id+'/funding-command',{});const signed_command=await wallet.sign(prepared.command);await api('/admin/campaigns/'+id+'/confirm-funding',{signed_command},{money:true});notify('Funding transaction saved. The campaign opens after on-chain confirmation.');await refresh();}
$('#fundBtn').onclick=()=>action($('#fundBtn'),async()=>{state.creating=true;try{const result=await api('/admin/campaigns',formCampaign(),{money:true});$('#fundState').textContent='Draft saved. Confirm the funding transaction in Ecko.';await fundCampaign(result.campaign.id);$('#fundState').textContent='Funding submitted. Track confirmation in Admin → Campaigns.';}finally{state.creating=false;}});

$('#admTabs').onclick=e=>{const b=e.target.closest('[data-a]');if(b){state.tab=b.dataset.a;$$('#admTabs button').forEach(x=>x.setAttribute('aria-selected',x===b));action(null,renderAdmin);}};
function renderPauseControl(){
 $('#pauseBtn').disabled=state.pauseBusy||!!state.pausePending;
 $('#pauseBtn').setAttribute('aria-checked',state.pausePaused);
 $('#pauseLbl').textContent=state.pausePending?'Pause change awaiting confirmation':state.pauseBusy?'Preparing pause change…':state.pausePaused?'Emergency pause active':'Payouts running';
}
async function refreshAdminKpi(){
 if(!owner())return null;
 const request=++kpiVersion,transition=pauseVersion,uncertain=state.pausePending?.uncertain?state.pausePending:null;
 const k=await api('/admin/kpi'+(uncertain?'?pause_request='+encodeURIComponent(uncertain.request_key):''));
 if(request!==kpiVersion||transition!==pauseVersion||!owner())return null;
 $('#kEsc').textContent=fmt(k.escrow_locked);$('#kOut').textContent=fmt(k.paid_all_time);$('#kRev').textContent=k.awaiting_review;$('#kUnpaid').textContent=fmt(k.approved_unpaid);$('#cRevN').textContent=k.awaiting_review;$('#cAiOn').textContent=k.ai_review_enabled?'On':'Off';
 if(uncertain&&k.pause_job?.request_key!==uncertain.request_key){state.pausePending=uncertain;state.pausePaused=true;}
 else{state.pausePending=k.pause_pending||null;state.pausePaused=k.paused;}
 renderPauseControl();
 if(uncertain&&state.pausePending===uncertain&&!state.pauseBusy&&!state.pauseReconciling&&uncertain.retries<3&&Date.now()>=uncertain.retryAt){
   if(await reconcilePause(uncertain))return refreshAdminKpi();
 }
 return {...k,paused:state.pausePaused,pause_pending:state.pausePending};
}
async function reconcilePause(marker){
 if(state.pauseReconciling||state.pausePending!==marker)return false;
 state.pauseReconciling=true;marker.retries++;marker.retryAt=Date.now()+15000*2**marker.retries;
 try{
   // Retry only the exact owner-approved signed command and its original key.
   // No new wallet prompt, signature, nonce or transaction is prepared.
   const saved=await api('/admin/pause',{signed_command:marker.signed_command},{money:true,key:marker.key});
   if(state.pausePending!==marker)return false;
   ++pauseVersion;state.pausePending={id:saved.job_id,request_key:saved.request_key};state.pausePaused=true;return true;
 }catch(e){
   if(state.pausePending===marker&&e.status>=400&&e.status<500){++pauseVersion;state.pausePending=null;return true;}
   return false;
 }finally{state.pauseReconciling=false;renderPauseControl();}
}
// Edit a funded task's text. Reward, slots and deadline are fixed in escrow.
function editCampaign(t){
 if(!t)return;
 const locked=t.in_progress>0,steps=[...t.steps],fields=structuredClone(t.proof_schema);
 const draw=()=>{
   $('#campEdit').innerHTML=`<div class="panel edit-panel"><h3>Edit task</h3><p class="note">Reward (${fmt(t.reward)} KDA per person), ${t.max} slots and the deadline (${date(t.deadline)}) are locked in escrow on chain and can't change here.</p><div class="form">
   <div class="two"><div class="field"><label for="eSponsor">Sponsor shown on the card</label><input id="eSponsor" value="${esc(eVal('eSponsor',t.sponsor))}"></div><div class="field"><label for="eMins">Estimated time (minutes)</label><input id="eMins" type="number" min="1" max="600" value="${esc(eVal('eMins',t.mins))}"></div></div>
   <div class="field"><label for="eTitle">Title</label><input id="eTitle" value="${esc(eVal('eTitle',t.title))}"></div>
   <div class="field"><label for="eDesc">What contributors do</label><textarea id="eDesc">${esc(eVal('eDesc',t.sum))}</textarea></div>
   <div class="two"><div class="field"><label for="eTpl">Template</label><select id="eTpl">${templates.map(([label])=>`<option ${label===eVal('eTpl',t.type)?'selected':''}>${esc(label)}</option>`).join('')}</select></div><div class="field"><label class="check"><input type="checkbox" id="eFeat" ${eVal('eFeat',t.featured)?'checked':''}> Featured</label></div></div>
   <div class="field"><label>Instructions <button class="sm" id="eAddStep">Add step</button></label><div class="qb">${steps.map((x,i)=>`<div class="qq"><div class="head"><b>${i+1}</b><input data-estep="${i}" value="${esc(x)}" aria-label="Instruction ${i+1}"><button class="sm bad" data-edel-step="${i}">Remove</button></div></div>`).join('')}</div></div>
   <div class="field"><label>Proof contributors must submit ${locked?'':'<button class="sm" id="eAddField">Add field</button>'}</label>${locked?`<p class="status-note">${t.in_progress} ${t.in_progress===1?'person is':'people are'} working on this task, so proof fields are locked until their work is reviewed. Everything else can change.</p>`:''}<div class="qb">${fields.map((f,i)=>`<div class="qq"><div class="head"><input data-elabel="${i}" value="${esc(f.label)}" aria-label="Proof field ${i+1} label" ${locked?'disabled':''}><select data-etype="${i}" aria-label="Proof field ${i+1} type" ${locked?'disabled':''}><option value="text" ${f.type==='text'?'selected':''}>Text</option><option value="url" ${f.type==='url'?'selected':''}>Link</option></select>${locked?'':`<button class="sm bad" data-edel-field="${i}">Remove</button>`}</div><div class="two"><label>Minimum characters <input data-emin="${i}" type="number" min="0" max="2000" value="${f.min_len}" ${locked?'disabled':''}></label><div><label><input data-eprivate="${i}" type="checkbox" ${f.private?'checked':''} ${locked?'disabled':''}> Private</label> <label><input data-erequired="${i}" type="checkbox" ${f.required?'checked':''} ${locked?'disabled':''}> Required</label></div></div></div>`).join('')}</div><small>Link fields only accept web addresses. Use Text for anything people write.</small></div>
   <div class="field"><label class="check"><input type="checkbox" id="eAi" ${eVal('eAi',t.ai)?'checked':''}> Let the AI agent review and pay this task</label></div>
   <div class="field" id="eAiCritWrap" ${eVal('eAi',t.ai)?'':'hidden'}><label for="eAiCrit">What the AI reviewer should check</label><textarea id="eAiCrit" maxlength="2000">${esc(eVal('eAiCrit',t.ai_criteria||''))}</textarea></div>
   </div><div class="act"><button class="sm ok" id="eSave">Save changes</button><button class="sm" id="eCancel">Cancel</button></div></div>`;
   $$('[data-estep]').forEach(i=>i.oninput=()=>{steps[Number(i.dataset.estep)]=i.value;});
   $$('[data-edel-step]').forEach(b=>b.onclick=()=>{keep();steps.splice(Number(b.dataset.edelStep),1);draw();});
   $('#eAddStep').onclick=()=>{if(steps.length<20){keep();steps.push('');draw();}};
   if(!locked){
     $('#eAddField').onclick=()=>{if(fields.length<20){keep();fields.push({key:'field_'+crypto.randomUUID().replaceAll('-','').slice(0,12),label:'',type:'text',min_len:0,required:true,private:false});draw();}};
     $$('[data-edel-field]').forEach(b=>b.onclick=()=>{keep();fields.splice(Number(b.dataset.edelField),1);draw();});
     for(const [attr,key,read] of [['elabel','label',i=>i.value],['etype','type',i=>i.value],['emin','min_len',i=>Number(i.value)],['eprivate','private',i=>i.checked],['erequired','required',i=>i.checked]])$$(`[data-${attr}]`).forEach(i=>i.oninput=i.onchange=()=>{fields[Number(i.dataset[attr])][key]=read(i);});
   }
   $('#eAi').onchange=()=>{$('#eAiCritWrap').hidden=!$('#eAi').checked;};
   $('#eCancel').onclick=()=>{$('#campEdit').innerHTML='';};
   $('#eSave').onclick=()=>action($('#eSave'),async()=>{
     const tpl=templates.find(([label])=>label===$('#eTpl').value)||templates[0];
     const body={title:$('#eTitle').value.trim(),summary:$('#eDesc').value.trim(),sponsor_name:$('#eSponsor').value.trim(),category:tpl[1],template:tpl[0],minutes_estimate:Number($('#eMins').value),steps:steps.map(x=>x.trim()),proof_schema:locked?t.proof_schema:fields,featured:$('#eFeat').checked,ai_review:$('#eAi').checked,...($('#eAi').checked&&$('#eAiCrit').value.trim()?{ai_criteria:$('#eAiCrit').value.trim()}:{})};
     const r=await api('/admin/campaigns/'+t.id+'/edit',body);
     notify(r.changed.length?'Task updated. Changes show on the board right away.':'No changes to save.');
     $('#campEdit').innerHTML='';await renderAdmin();
   });
   $('#campEdit').scrollIntoView?.({behavior:'smooth',block:'start'});
 };
 // Keep typed values when the step or field list is redrawn.
 const typed={};const keep=()=>{for(const k of ['eSponsor','eMins','eTitle','eDesc','eTpl','eAiCrit'])if($('#'+k))typed[k]=$('#'+k).value;for(const k of ['eFeat','eAi'])if($('#'+k))typed[k]=$('#'+k).checked;};
 const eVal=(k,fallback)=>k in typed?typed[k]:fallback;
 draw();
}
async function renderAdmin(){
 const render=++adminRenderVersion,tab=state.tab,current=()=>render===adminRenderVersion&&tab===state.tab&&owner();
 const k=await refreshAdminKpi();if(!k||!current())return;
 if(state.tab==='review'){
   const subs=await api('/reviewer/submissions');if(!current())return;const selected=subs.find(s=>s.id===state.selected)||subs[0];state.selected=selected?.id;
   $('#admBody').innerHTML=subs.length?`<div class="review"><ul class="qlist">${subs.map(s=>`<li data-sub="${s.id}" aria-selected="${s.id===state.selected}" tabindex="0"><span class="t">${esc(s.task)}</span><span class="s">${esc(short(s.by))} · ${date(s.submitted_at)} · ${badge(s.status)}</span></li>`).join('')}</ul><div class="proof"><h2>${esc(selected.task)}</h2><p>${esc(selected.by)} · <b class="kda">${fmt(selected.reward)}</b>${selected.campaign_ai?' · <span class="badge ai">AI-reviewed task</span>':''}</p>${selected.ai?`<div class="ai-box"><b>AI reviewer: ${esc(({approve:'would approve',request_changes:'asked for changes',escalate:'passed to you',error:'error'})[selected.ai.decision]||selected.ai.decision)}</b>${selected.ai.confidence!=null?` · confidence ${Math.round(selected.ai.confidence*100)}%`:''}${selected.ai.skip_reason?` · ${esc(AI_REASON[selected.ai.skip_reason]||selected.ai.skip_reason)}`:''}<p>${esc(selected.ai.reasons||'')}</p></div>`:''}${selected.proof_schema.map(f=>`<div class="field"><b>${esc(f.label)}${f.private?' · Private':''}</b><p class="proof-value">${f.type==='url'?link(selected.proof_json[f.key],selected.proof_json[f.key]):esc(selected.proof_json[f.key])}</p></div>`).join('')}<div class="field"><label for="rvNote">Review note (required for rejection or changes)</label><textarea id="rvNote" maxlength="2000">${esc(selected.review_note||'')}</textarea></div><div class="act"><button class="sm ok" data-review="approve" ${selected.status==='changes_requested'?'disabled':''}>Approve</button><button class="sm" data-review="request-changes">Request changes</button><button class="sm bad" data-review="reject">Reject</button></div></div></div>`:'<div class="empty">No submissions awaiting review.</div>';
   $$('[data-sub]').forEach(li=>{const select=()=>{state.selected=li.dataset.sub;action(null,renderAdmin);};li.onclick=select;li.onkeydown=e=>{if(e.key==='Enter')select();};});
   $$('[data-review]').forEach(b=>b.onclick=()=>action(b,async()=>{await api('/submissions/'+state.selected+'/'+b.dataset.review,{note:$('#rvNote').value.trim()});await renderAdmin();notify('Review decision saved.');}));
 }else if(state.tab==='pay'){
   const payouts=await api('/admin/payouts');if(!current())return;$('#cPay').textContent=payouts.filter(p=>p.status!=='confirmed').length;
   $('#admBody').innerHTML=`<div class="paybar"><p>Rewards are sent from escrow and marked paid after confirmation.</p><button class="sm ok" id="sendAll" ${k.paused?'disabled':''}>Send pending payouts</button></div><div class="scroll-x"><table class="tbl"><thead><tr><th>Task</th><th>Recipient</th><th>Amount</th><th>Status</th><th>Transaction</th><th></th></tr></thead><tbody>${payouts.map(p=>`<tr><td>${esc(p.task)}</td><td>${esc(short(p.by))}</td><td><b class="kda">${fmt(p.amount_kda)}</b></td><td>${badge(p.status)}${p.error?`<div class="status-note">${esc(p.error)}</div>`:''}</td><td>${txLink(p.request_key)}</td><td>${['pending','failed'].includes(p.status)?`<button class="sm" data-send="${p.id}" data-action="${p.status==='failed'?'retry':'send'}" ${k.paused?'disabled':''}>${p.status==='failed'?'Retry':'Send'}</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No payouts yet.</td></tr>'}</tbody></table></div>`;
   $('#sendAll').onclick=()=>action($('#sendAll'),async()=>{await api('/admin/payouts/send-all',{},{money:true});await renderAdmin();});
   $$('[data-send]').forEach(b=>b.onclick=()=>action(b,async()=>{await api('/admin/payouts/'+b.dataset.send+'/'+b.dataset.action,{},{money:true});await renderAdmin();}));
 }else if(state.tab==='camp'){
   const [campaigns,jobs]=await Promise.all([api('/admin/campaigns'),api('/admin/jobs')]);if(!current())return;
   $('#admBody').innerHTML=`<div class="scroll-x"><table class="tbl"><thead><tr><th>Campaign</th><th>Funded</th><th>Paid</th><th>Remaining</th><th>Refunded</th><th>Status</th><th></th></tr></thead><tbody>${campaigns.map(t=>`<tr><td><b>${esc(t.title)}</b><div class="time">${date(t.deadline)} · ${t.max} slots</div></td><td><b class="kda">${fmt(t.escrow?.funded)}</b></td><td><b class="kda">${fmt(t.escrow?.paid)}</b></td><td><b class="kda">${fmt(t.escrow?.remaining)}</b></td><td><b class="kda">${fmt(t.escrow?.refunded)}</b></td><td>${badge(t.status)}${t.hidden?' <span class="badge warn">Hidden</span>':''}</td><td><div class="act">${['draft','funding_failed'].includes(t.status)?`<button class="sm ok" data-fund="${t.id}" ${k.paused?'disabled':''}>Fund with Ecko</button>`:txLink(t.funding_tx)}${t.editable?`<button class="sm" data-edit="${t.id}">Edit</button><button class="sm" data-hide="${t.id}" title="${t.hidden?'Show this task on the board again':'Take this task off the board; unused KDA still returns at the deadline'}">${t.hidden?'Show':'Hide'}</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Create your first campaign.</td></tr>'}</tbody></table></div><div id="campEdit"></div><p class="note">After the deadline, unclaimed rewards are refunded automatically. Submitted work stays funded until paid or rejected.</p>${jobs.filter(j=>j.error||['prepared','broadcast'].includes(j.status)).map(j=>`<p class="status-note">${esc(j.kind)} · ${esc(j.status)} · ${txLink(j.request_key)} ${esc(j.error||'Awaiting confirmation')}</p>`).join('')}`;
   $$('[data-fund]').forEach(b=>b.onclick=()=>action(b,()=>fundCampaign(b.dataset.fund)));
   $$('[data-edit]').forEach(b=>b.onclick=()=>editCampaign(campaigns.find(t=>String(t.id)===b.dataset.edit)));
   $$('[data-hide]').forEach(b=>b.onclick=()=>action(b,async()=>{const t=campaigns.find(x=>String(x.id)===b.dataset.hide);await api('/admin/campaigns/'+t.id+'/visibility',{hidden:!t.hidden});notify(t.hidden?'Task is back on the board.':'Task hidden. People already working on it can still submit, and unused KDA returns to your wallet at the deadline.');await renderAdmin();}));
 }else if(state.tab==='ai'){
   const a=await api('/admin/ai-review');if(!current())return;$('#cAiOn').textContent=a.enabled?'On':'Off';
   $('#admBody').innerHTML=`<div class="paybar"><p>${a.configured?`The AI reviewer checks proof on campaigns created with <b>AI review</b> and pays approved work from escrow. It never rejects. Model ${esc(a.model)}.`:'Add ANTHROPIC_API_KEY on the server to use the AI reviewer.'}</p><button class="sm ${a.enabled?'bad':'ok'}" id="aiToggle" ${a.configured||a.enabled?'':'disabled'}>${a.enabled?'Turn off':'Turn on'}</button></div>
   <div class="kpi"><div><span>Max reward per task</span><b class="kda">${fmt(a.max_reward_kda)}</b></div><div><span>Paid by AI, last 24 h</span><b class="kda">${fmt(a.spent_24h)} / ${fmt(a.daily_kda)}</b></div><div><span>Approved · changes · to you (24 h)</span><b>${a.last_24h.approved} · ${a.last_24h.changes} · ${a.last_24h.escalated}</b></div><div><span>Approves only at</span><b>${Math.round(a.min_confidence*100)}%+</b></div></div>
   ${a.last_error?`<p class="status-note">Last error: ${esc(a.last_error)}</p>`:''}
   <div class="scroll-x"><table class="tbl"><thead><tr><th>Task</th><th>Decision</th><th>Confidence</th><th>Result</th><th>Why</th><th>When</th></tr></thead><tbody>${a.recent.map(r=>`<tr><td>${esc(r.task)}</td><td>${esc(({approve:'Approve',request_changes:'Changes',escalate:'Pass to owner',error:'Error'})[r.decision]||r.decision)}</td><td>${r.confidence!=null?Math.round(r.confidence*100)+'%':'–'}</td><td>${esc(({approved:'Paid by AI',changes_requested:'Asked for changes',escalated:'Sent to you',skipped:'Skipped'})[r.applied]||r.applied)}${r.skip_reason?`<div class="status-note">${esc(AI_REASON[r.skip_reason]||r.skip_reason)}</div>`:''}</td><td>${esc(r.reasons||'')}</td><td>${date(r.created_at)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No AI reviews yet.</td></tr>'}</tbody></table></div>`;
   $('#aiToggle').onclick=()=>action($('#aiToggle'),async()=>{await api('/admin/ai-review',{enabled:!a.enabled});notify(a.enabled?'AI reviewer turned off.':'AI reviewer turned on.');await renderAdmin();});
 }
}
$('#pauseBtn').onclick=async()=>{
 if(!owner()||state.pauseBusy||state.pausePending||$('#pauseBtn').disabled)return;
 const paused=!state.pausePaused;state.pauseBusy=true;++pauseVersion;renderPauseControl();
 try{
   // Check the server before opening Ecko; it rejects another pending change.
   const prepared=await api('/admin/pause-command',{paused});
   wallet||=new EckoWallet();const connected=await wallet.connect(state.config.network);if(connected!==state.user.account)throw new Error('Select the owner account in Ecko.');
   const signed_command=await wallet.sign(prepared.command);
   // The POST may commit even if its response is lost. Latch its exact signed
   // request before sending, and never clear it from an unrelated/null KPI.
   ++pauseVersion;state.pausePending={request_key:signed_command.hash,uncertain:true,signed_command,key:crypto.randomUUID(),retries:0,retryAt:Date.now()+15000};state.pausePaused=true;renderPauseControl();
   const saved=await api('/admin/pause',{signed_command},{money:true,key:state.pausePending.key});
   ++pauseVersion;state.pausePending={id:saved.job_id,request_key:saved.request_key};state.pausePaused=true;renderPauseControl();
   notify(paused?'Pause requested. It takes effect on chain after confirmation.':'Resume requested. Payouts resume after confirmation.');await renderAdmin();
 }catch(e){
   if(state.pausePending?.uncertain&&e.status>=400&&e.status<500){++pauseVersion;state.pausePending=null;}
   notify(e.message);await refreshAdminKpi().catch(()=>{});
 }finally{state.pauseBusy=false;renderPauseControl();}
};
let refreshing=false;
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
   const [tasks,stats,feed,work,board]=await Promise.all([api('/tasks'),api('/stats'),api('/payouts/recent'),api('/work'),api('/leaderboard')]);
   state.tasks=tasks;state.work=work;state.board=board;renderTasks();renderWork();renderBoard();
   $('#openRewards').textContent=fmt(stats.open_rewards);$('#sPaid').textContent=fmt(stats.paid_submissions);$('#sKda').textContent=fmt(stats.kda_paid);
   const aiPaid=Number(stats.ai_paid_submissions||0);$('#sAi').textContent=aiPaid;$('#sAiWrap').hidden=!aiPaid;$('#aiLine').hidden=!(aiPaid||tasks.some(t=>t.ai));
   $('#feed').innerHTML=feed.length?feed.map(p=>`<li><span class="who">${esc(p.who)}</span><b class="kda">${fmt(p.reward)}</b><span class="what">${esc(p.type)}, sponsored by ${esc(p.sponsor)}${p.ai?` · <a href="/ai-receipts/${esc(p.receipt)}" title="See the AI receipt">reviewed &amp; paid by AI agent</a>`:''}</span><span class="tx">${txLink(p.tx)}</span></li>`).join(''):'<li class="empty">No confirmed payouts yet.</li>';
   const before=state.mine.find(m=>String(m.campaign_id)===String(state.cur?.id))?.s;await loadPersonal();const after=state.mine.find(m=>String(m.campaign_id)===String(state.cur?.id))?.s;
   if(state.drawer&&before!==after&&!$('#proofForm'))renderDrawer();
   if(state.view==='admin'){if(state.tab==='review'||document.activeElement?.matches('textarea,input'))await refreshAdminKpi();else await renderAdmin();}
   if(state.view==='create')calc();
 }finally{refreshing=false;}
}
async function init(){try{state.config=await api('/config');const session=await api('/auth/session');state.user=session.user;state.csrf=session.csrf;sessionUI();calc();await refresh();setInterval(()=>{if(!document.hidden)refresh().catch(e=>notify(e.message));},15000);}catch(e){notify(e.message);$('#grid').innerHTML='<div class="empty">Unable to load tasks. Refresh after the service is available.</div>';}}
init();
