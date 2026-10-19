import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const token=()=>randomBytes(24).toString('hex');
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createQuiz({database='quiz.sqlite',hostKey,now=Date.now,mediaDir=path.join(root,'media')}={}) {
 if(!hostKey||hostKey.length<12)throw Error('HOST_KEY must contain at least 12 characters');
 const db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,secret TEXT UNIQUE,seen INTEGER);
 CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT,opened INTEGER,deadline INTEGER,closed INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS answers(team TEXT REFERENCES teams(id),question INTEGER REFERENCES questions(id),value TEXT,points INTEGER DEFAULT 0,PRIMARY KEY(team,question));
 CREATE TABLE IF NOT EXISTS adjustments(id INTEGER PRIMARY KEY,team TEXT REFERENCES teams(id),points INTEGER,reason TEXT);
 `);
 const sessions=new Set();const attempts=new Map();
 const rows=(sql,...p)=>db.prepare(sql).all(...p);
 const latest=()=>db.prepare('SELECT * FROM questions ORDER BY id DESC LIMIT 1').get();
 const publicQ=q=>q?{id:q.id,...Object.fromEntries(Object.entries(JSON.parse(q.data)).filter(([k])=>k!=='answer')),deadline:q.deadline,open:!q.closed&&now()<q.deadline}:null;
 const scores=()=>rows(`SELECT id,name,seen,COALESCE((SELECT SUM(points) FROM answers WHERE team=teams.id),0)+COALESCE((SELECT SUM(points) FROM adjustments WHERE team=teams.id),0) score FROM teams ORDER BY score DESC,name`).map(t=>({...t,connected:now()-t.seen<15000}));
 function validQuestion(q){
  if(!q||typeof q.text!=='string'||!q.text.trim()||q.text.length>1000||!['text','choice','picture','audio','sheet'].includes(q.type)||!Number.isInteger(q.seconds)||q.seconds<5||q.seconds>7200||!Number.isInteger(q.points)||q.points<0||q.points>100)throw Error('Invalid question');
  if(q.answer!==undefined&&(typeof q.answer!=='string'||q.answer.length>300))throw Error('Invalid marking answer');
  if(q.type==='choice'&&(!Array.isArray(q.options)||q.options.length<2||q.options.length>8||q.options.some(x=>typeof x!=='string'||!x.trim()||x.length>200)||new Set(q.options).size!==q.options.length||(q.answer&&!q.options.includes(q.answer))))throw Error('Invalid choices');
  if(['picture','audio'].includes(q.type)&&(!/^\/media\/[a-zA-Z0-9_.-]+$/.test(q.media)||!existsSync(path.join(mediaDir,path.basename(q.media)))))throw Error('Media file missing');
  if(q.type==='sheet'&&(!Array.isArray(q.items)||!q.items.length||q.items.length>50||q.items.some(x=>typeof x!=='string'||!x.trim()||x.length>500)))throw Error('Invalid sheet');
  return {text:q.text.trim(),type:q.type,seconds:q.seconds,points:q.points,answer:q.answer||'',options:q.type==='choice'?q.options:[],items:q.type==='sheet'?q.items:[],media:['picture','audio'].includes(q.type)?q.media:null};
 }
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://quiz.local');const p=url.pathname;
   if(req.method==='GET'&&!p.startsWith('/api/')){
    let file=p==='/host'?'host.html':p==='/display'?'display.html':p==='/app.js'?'app.js':p==='/style.css'?'style.css':p.startsWith('/media/')?null:'player.html';
    let location=file?path.join(root,file):/^\/media\/[a-zA-Z0-9_.-]+$/.test(p)?path.join(mediaDir,path.basename(p)):null;
    if(!location||!existsSync(location))return send(404,{error:'Not found'});
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
    res.writeHead(200,{'Content-Type':types[path.extname(location)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; media-src 'self'; img-src 'self'; connect-src 'self'"});return res.end(readFileSync(location));
   }
   if(req.method==='GET'&&p==='/api/leaderboard')return send(200,{teams:scores().map(({seen,connected,...t})=>t),question:publicQ(latest())});
   if(req.method!=='POST')return send(405,{error:'POST required'});
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return send(413,{error:'Request too large'});}
   let body;try{body=JSON.parse(raw||'{}');}catch{return send(400,{error:'Invalid JSON'});}if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'Invalid request'});
   if(p==='/api/login'){
    const ip=req.socket.remoteAddress;const a=attempts.get(ip)||{n:0,time:now()};if(now()-a.time>60000){a.n=0;a.time=now();}attempts.set(ip,a);
    if(++a.n>10)return send(429,{error:'Wait one minute before trying again'});
    if(!equal(body.key,hostKey))return send(403,{error:'Incorrect key'});const key=token();sessions.add(key);return send(200,{key});
   }
   const auth=req.headers.authorization?.replace(/^Bearer /,'');
   if(p.startsWith('/api/host/')){
    if(!sessions.has(auth))return send(403,{error:'Host login required'});
    if(p==='/api/host/state')return send(200,{teams:scores(),question:latest()?{...publicQ(latest()),answer:JSON.parse(latest().data).answer}:null,answers:rows('SELECT * FROM answers WHERE question=?',latest()?.id||0)});
    if(p==='/api/host/open'){
     const q=validQuestion(body);if(publicQ(latest())?.open)return send(409,{error:'Close current question first'});
     db.prepare('INSERT INTO questions(data,opened,deadline) VALUES(?,?,?)').run(JSON.stringify(q),now(),now()+q.seconds*1000);return send(200,{ok:true});
    }
    if(p==='/api/host/close'){db.prepare('UPDATE questions SET closed=1 WHERE id=?').run(latest()?.id||0);return send(200,{ok:true});}
    if(p==='/api/host/mark'){
     const q=db.prepare('SELECT * FROM questions WHERE id=?').get(body.question);if(!q||publicQ(q).open)return send(409,{error:'Close question before marking'});
     if(!Number.isInteger(body.points)||Math.abs(body.points)>100)return send(400,{error:'Invalid points'});
     const r=db.prepare('UPDATE answers SET points=? WHERE team=? AND question=?').run(body.points,body.team,body.question);return send(r.changes?200:404,{ok:!!r.changes});
    }
    if(p==='/api/host/adjust'){
     if(!Number.isInteger(body.points)||Math.abs(body.points)>100||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>200||!db.prepare('SELECT id FROM teams WHERE id=?').get(body.team))return send(400,{error:'Valid team, points and reason required'});
     db.prepare('INSERT INTO adjustments(team,points,reason) VALUES(?,?,?)').run(body.team,body.points,body.reason);return send(200,{ok:true});
    }
    if(p==='/api/host/export')return send(200,{teams:rows('SELECT id,name FROM teams'),questions:rows('SELECT * FROM questions'),answers:rows('SELECT * FROM answers'),adjustments:rows('SELECT * FROM adjustments')});
    return send(404,{error:'Unknown action'});
   }
   if(p==='/api/join'){
    if(typeof body.name!=='string'||body.name.trim().length<2||body.name.trim().length>40)return send(400,{error:'Team name must be 2–40 characters'});
    if(db.prepare('SELECT id FROM teams WHERE name=? COLLATE NOCASE').get(body.name.trim()))return send(409,{error:'Name taken. Use your recovery code to reconnect.'});
    const id=token(),secret=token();db.prepare('INSERT INTO teams VALUES(?,?,?,?)').run(id,body.name.trim(),secret,now());return send(200,{id,secret});
   }
   const team=db.prepare('SELECT * FROM teams WHERE secret=?').get(auth||'');if(!team)return send(401,{error:'Team recovery code required'});
   db.prepare('UPDATE teams SET seen=? WHERE id=?').run(now(),team.id);
   if(p==='/api/state')return send(200,{team:{id:team.id,name:team.name},question:publicQ(latest()),answer:db.prepare('SELECT value FROM answers WHERE team=? AND question=?').get(team.id,latest()?.id||0),teams:scores().map(({seen,connected,...t})=>t)});
   if(p==='/api/answer'){
    const q=latest();if(!q||body.question!==q.id||!publicQ(q).open)return send(409,{error:'Question closed or outdated'});
    const data=JSON.parse(q.data);let value=body.value;
    if(data.type==='sheet'){
     if(!Array.isArray(value)||value.length!==data.items.length||value.some(x=>typeof x!=='string'||x.length>300))return send(400,{error:'Complete the answer sheet'});value=JSON.stringify(value.map(x=>x.trim()));
    }else{
     if(typeof value!=='string'||!value.trim()||value.length>300||(data.type==='choice'&&!data.options.includes(value)))return send(400,{error:'Invalid answer'});value=value.trim();
    }
    if(db.prepare('SELECT 1 FROM answers WHERE team=? AND question=?').get(team.id,q.id))return send(409,{error:'Already submitted'});
    const points=data.type!=='sheet'&&data.answer&&value.normalize('NFKC').toLocaleLowerCase()===data.answer.normalize('NFKC').trim().toLocaleLowerCase()?data.points:0;
    db.prepare('INSERT INTO answers VALUES(?,?,?,?)').run(team.id,q.id,value,points);return send(200,{ok:true});
   }
   send(404,{error:'Unknown action'});
  }catch(e){send(400,{error:e.message});}
 });
 return {server,db,close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const quiz=createQuiz({hostKey:process.env.HOST_KEY,database:process.env.QUIZ_DB||path.join(root,'quiz.sqlite')});
 quiz.server.listen(Number(process.env.PORT||3000),process.env.BIND||'0.0.0.0',()=>console.log('PubQuiz ready; host dashboard /host; player registration /'));
}
