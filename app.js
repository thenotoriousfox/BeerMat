const $=id=>document.getElementById(id),role=document.body.dataset.role;
let secret='',host='',qid=null,last=null,questions=[],isSheet=false;
try{secret=localStorage.getItem('pubquiz-team')||'';host=sessionStorage.getItem('pubquiz-host')||'';}catch{}
const message=s=>{$('message').textContent=s;};
async function api(p,b={},key=role==='host'?host:secret){const r=await fetch('/api/'+p,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(b),signal:AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok){const e=Error(data.error);e.status=r.status;throw e;}return data;}
function leaderboard(teams){$('leaderboard')?.replaceChildren(...teams.map(t=>{const li=document.createElement('li');li.textContent=`${t.name} — ${t.score}`;return li;}));}
function timer(q){return q?.open?`${Math.max(0,Math.ceil((q.deadline-Date.now())/1000))} seconds remaining`:'Answers closed';}
function showPlayer(s){$('join').hidden=true;$('game').hidden=false;$('team').textContent=s.team.name;$('code').textContent=secret;const q=s.question;$('status').textContent=timer(q);leaderboard(s.teams);
 if(q?.id!==qid){qid=q?.id;isSheet=q?.type==='sheet';$('question').textContent=q?.text||'Waiting for quizmaster…';$('inputs').replaceChildren();$('media').replaceChildren();
  if(q?.media){const el=document.createElement(q.type==='audio'?'audio':'img');el.src=q.media;if(q.type==='audio')el.controls=true;else el.alt='Quiz picture';$('media').append(el);}
  if(q){const items=q.type==='sheet'?q.items:[q.text];for(const [i,item]of items.entries()){const label=document.createElement('label');label.textContent=q.type==='sheet'?`${i+1}. ${item}`:'Your answer';let input=document.createElement(q.type==='choice'?'select':'input');if(q.type==='choice'){const empty=document.createElement('option');empty.value='';empty.textContent='Choose…';input.append(empty,...q.options.map(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;return o;}));}else input.maxLength=300;label.append(input);$('inputs').append(label);}}
 }
 const disabled=!q?.open||!!s.answer;for(const x of $('inputs').querySelectorAll('input,select'))x.disabled=disabled;$('submit').disabled=disabled;if(s.answer){$('status').textContent='Answer saved';let values=isSheet?JSON.parse(s.answer.value):[s.answer.value];[...$('inputs').querySelectorAll('input,select')].forEach((x,i)=>{x.value=values[i]||'';});}
}
async function poll(){try{
 if(role==='display'){const r=await fetch('/api/leaderboard',{signal:AbortSignal.timeout(5000)});leaderboard((await r.json()).teams);message('');}
 if(role==='player'&&secret){showPlayer(await api('state'));message('Connected');}
 if(role==='host'&&host){const s=await api('host/state');$('login').hidden=true;$('panel').hidden=false;last=s;$('question').textContent=s.question?.text||'Waiting';$('status').textContent=timer(s.question);
 const selected=$('adjustTeam').value;$('adjustTeam').replaceChildren(...s.teams.map(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;return o;}));if(selected)$('adjustTeam').value=selected;
 $('teams').replaceChildren(...s.teams.map(t=>{const box=document.createElement('p');const a=s.answers.find(a=>a.team===t.id);box.textContent=`${t.name} — ${t.score} points — ${t.connected?'connected':'⚠ DISCONNECTED'} — ${a?.value||'No answer'} `;
 if(a&&!s.question?.open){for(const pts of [0,s.question.points]){const b=document.createElement('button');b.textContent=`Set ${pts}`;b.onclick=()=>act(()=>api('host/mark',{question:s.question.id,team:t.id,points:pts}));box.append(b);}}return box;}));message(s.teams.some(t=>!t.connected)?'⚠ Disconnected teams — check team list':'Connected');
 }
 }catch(e){if(e.status===401&&role==='player'){$('join').hidden=false;$('game').hidden=true;secret='';}if(role==='player')$('submit').disabled=true;message(e.status?e.message:'Connection lost — reconnecting automatically. Do not create a new team.');}finally{setTimeout(poll,2000);}}
async function act(f){try{await f();message('Saved');}catch(e){message(e.message);}}
if(role==='player'){
 const save=key=>{secret=key;qid=null;try{localStorage.setItem('pubquiz-team',key);}catch{message('Storage unavailable: copy your recovery code');}};
 $('joinButton').onclick=()=>act(async()=>{const r=await api('join',{name:$('name').value});save(r.secret);showPlayer(await api('state'));});
 $('recover').onclick=()=>act(async()=>{const code=$('recovery').value.trim();const s=await api('state',{},code);save(code);showPlayer(s);});
 $('submit').onclick=()=>act(async()=>{const values=[...$('inputs').querySelectorAll('input,select')].map(x=>x.value);await api('answer',{question:qid,value:isSheet?values:values[0]});showPlayer(await api('state'));});
}
if(role==='host'){
 $('auth').onclick=()=>act(async()=>{host=(await api('login',{key:$('key').value})).key;try{sessionStorage.setItem('pubquiz-host',host);}catch{}$('key').value='';});
 $('open').onclick=()=>act(()=>api('host/open',JSON.parse($('editor').value)));
 $('close').onclick=()=>act(()=>api('host/close'));
 $('adjust').onclick=()=>act(()=>api('host/adjust',{team:$('adjustTeam').value,points:Number($('points').value),reason:$('reason').value}));
 $('import').onchange=()=>act(async()=>{questions=JSON.parse(await $('import').files[0].text());if(!Array.isArray(questions))throw Error('Quiz must be a JSON array');$('queue').replaceChildren(...questions.map((q,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}. ${q.text}`;return o;}));});
 $('load').onclick=()=>{$('editor').value=JSON.stringify(questions[Number($('queue').value)],null,2);};
 $('export').onclick=()=>act(async()=>{const data=await api('host/export');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='pubquiz-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
}
poll();
