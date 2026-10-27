import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQuiz} from '../server/server.js';
const key='a-private-test-password';
test('persistent identities, authoritative deadlines, validation, scoring and access control',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'beermat-'));let clock=100000;let quiz;
 async function start(){quiz=createQuiz({database:path.join(dir,'test.sqlite'),hostKey:key,now:()=>clock});await new Promise(r=>quiz.server.listen(0,'127.0.0.1',r));}
 await start();
 async function api(p,b={},auth=''){const r=await fetch(`http://127.0.0.1:${quiz.server.address().port}/api/${p}`,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,...await r.json()};}
 try{
 assert.equal((await api('host/open')).status,403);
 const host=(await api('login',{key})).key;await api('host/settings',{waitingRoom:false},host);
 const team=await api('join',{name:'Fox Team'});assert.equal(team.status,200);
 assert.equal((await api('join',{name:'fox team'})).status,409);
 const q={text:'Capital?',type:'text',seconds:10,points:2,answer:'Cardiff'};
 assert.equal((await api('host/open',q,host)).status,200);
 let state=await api('state',{},team.secret);const id=state.question.id;
 assert.equal(state.question.answer,undefined);
 assert.equal((await api('answer',{question:id+1,value:'Cardiff'},team.secret)).status,409);
 assert.equal((await api('answer',{question:id,value:' '},team.secret)).status,400);
 assert.equal((await api('answer',{question:id,value:'cardiff'},team.secret)).status,200);
 assert.equal((await api('answer',{question:id,value:'London'},team.secret)).status,409);
 assert.equal((await api('host/mark',{question:id,team:team.id,points:4},host)).status,409);
 clock+=10000;
 const t2=await api('join',{name:'Second Team'});
 assert.equal((await api('answer',{question:id,value:'Cardiff'},t2.secret)).status,409);
 state=await api('host/state',{},host);assert.equal(state.teams.find(t=>t.id===team.id).score,2);
 for(let i=0;i<2;i++)assert.equal((await api('host/mark',{question:id,team:team.id,points:4},host)).status,200);
 assert.equal((await api('state',{},team.secret)).teams.find(t=>t.id===team.id).score,4);
 clock+=16000;assert.equal((await api('host/state',{},host)).teams.find(t=>t.id===team.id).connected,false);
 assert.equal((await api('state',{},team.secret)).team.id,team.id);
 assert.equal((await api('host/state',{},host)).teams.find(t=>t.id===team.id).connected,true);
 await quiz.close();await start();
 state=await api('state',{},team.secret);assert.equal(state.answer.value,'cardiff');assert.equal(state.teams.find(t=>t.id===team.id).score,4);
 assert.equal((await api('host/state',{},host)).status,200);
 const h=(await api('login',{key})).key;
 assert.equal((await api('host/open',{...q,type:'choice',options:['A','B'],answer:'C'},h)).status,400);
 assert.equal((await api('host/open',{...q,type:'picture',media:'/media/../../secrets'},h)).status,400);
 assert.equal((await api('host/open',{...q,type:'sheet',items:['One','Two']},h)).status,200);
 const sheet=(await api('state',{},team.secret)).question;
 assert.equal((await api('answer',{question:sheet.id,value:['one']},team.secret)).status,400);
 assert.equal((await api('answer',{question:sheet.id,value:['one','two']},team.secret)).status,200);
 assert.equal((await api('host/adjust',{team:team.id,points:3,reason:'Paper round'},h)).status,200);
 assert.equal((await api('host/export',{},h)).teams[0].secret,undefined);
 }finally{await quiz.close();rmSync(dir,{recursive:true,force:true});}
});
test('host key must be configured securely',()=>assert.throws(()=>createQuiz({hostKey:'short'})));
test('concurrent teams, choices, manual close, portal fallback and request guards',async()=>{
 const quiz=createQuiz({database:':memory:',hostKey:key});await new Promise(r=>quiz.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${quiz.server.address().port}`;
 async function api(p,b={},auth=''){const r=await fetch(base+'/api/'+p,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(b)});return {status:r.status,...await r.json()};}
 try{
 for(const p of ['/','/generate_204','/hotspot-detect.html','/connecttest.txt','/host','/display','/app.js','/style.css']){const r=await fetch(base+p);assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy'));}
 const csrf=await fetch(base+'/api/join',{method:'POST',headers:{Origin:'http://evil.example'},body:'{"name":"Stolen"}'});assert.equal(csrf.status,403);
 const malformed=await fetch(base+'/api/join',{method:'POST',body:'{'});assert.equal(malformed.status,400);
 const host=(await api('login',{key})).key;await api('host/settings',{waitingRoom:false},host);
 const teams=await Promise.all(Array.from({length:20},(_,i)=>api('join',{name:'Team '+i})));
 const q={text:'Prime?',type:'choice',seconds:30,points:1,options:['8','11'],answer:'11'};
 assert.equal((await api('host/open',q,host)).status,200);
 const id=(await api('state',{},teams[0].secret)).question.id;
 assert.equal((await api('host/open',q,host)).status,409);
 assert.equal((await api('answer',{question:id,value:'99'},teams[0].secret)).status,400);
 const answers=await Promise.all(teams.map(t=>api('answer',{question:id,value:'11'},t.secret)));assert.ok(answers.every(r=>r.status===200));
 const duplicate=await Promise.all(Array.from({length:5},()=>api('answer',{question:id,value:'8'},teams[0].secret)));assert.ok(duplicate.every(r=>r.status===409));
 assert.equal((await api('host/close',{},host)).status,200);
 const board=await(await fetch(base+'/api/leaderboard')).json();assert.equal(board.teams.length,20);assert.ok(board.teams.every(t=>t.score===1));assert.equal(board.question.open,false);assert.equal(board.question.answer,undefined);
 assert.equal((await api('host/mark',{team:teams[0].id,question:id,points:1.5},host)).status,400);
 for(let i=0;i<10;i++)await api('login',{key:'incorrect'});assert.equal((await api('login',{key})).status,429);
 }finally{await quiz.close();}
});
