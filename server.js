import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const teams = new Map();
let currentQuestion = null;
let questionOpen = false;
const answers = new Map();
const hostKey = process.env.HOST_KEY;
if (!hostKey) { console.error('Set HOST_KEY to a private password before starting.'); process.exit(1); }
app.get('/', (_, res) => res.sendFile('player.html', {root: process.cwd()}));
app.get('/host', (_, res) => res.sendFile('host.html', {root: process.cwd()}));
app.get('/health', (_, res) => res.json({ok:true}));
function roster() { return [...teams.values()].map(({id,name,connected,score})=>({id,name,connected,score})); }
function broadcast() { io.to('hosts').emit('state',{teams:roster(),currentQuestion,questionOpen,answers:[...answers.values()]}); }
io.on('connection', socket => {
  let teamId = null; let isHost = false;
  socket.on('host:auth', (key, ack) => { if(key !== hostKey) return ack?.({ok:false}); isHost=true; socket.join('hosts'); ack?.({ok:true}); broadcast(); });
  socket.on('team:join', (name, ack) => {
    if(typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40) return ack?.({ok:false,error:'Team name must be 2–40 characters'});
    if([...teams.values()].some(t=>t.name.toLowerCase()===name.trim().toLowerCase())) return ack?.({ok:false,error:'Team name already taken'});
    teamId=randomUUID(); teams.set(teamId,{id:teamId,name:name.trim(),connected:true,score:0}); socket.join(`team:${teamId}`); ack?.({ok:true,id:teamId}); broadcast();
  });
  socket.on('team:answer',(value,ack)=>{
    if(!teamId || !questionOpen || !currentQuestion) return ack?.({ok:false,error:'Question closed'});
    if(answers.has(teamId)) return ack?.({ok:false,error:'Already answered'});
    if(typeof value !== 'string' || value.length > 300) return ack?.({ok:false,error:'Invalid answer'});
    answers.set(teamId,{teamId,answer:value.trim(),submittedAt:Date.now()}); ack?.({ok:true}); broadcast();
  });
  socket.on('host:question',(question,ack)=>{
    if(!isHost) return ack?.({ok:false});
    if(typeof question !== 'string' || question.trim().length < 1 || question.length > 500) return ack?.({ok:false});
    currentQuestion=question.trim(); questionOpen=true; answers.clear(); io.emit('question',{text:currentQuestion,open:true}); broadcast(); ack?.({ok:true});
  });
  socket.on('host:close',()=>{if(!isHost)return;questionOpen=false;io.emit('question',{text:currentQuestion,open:false});broadcast();});
  socket.on('host:score',(data)=>{if(!isHost)return;const t=teams.get(data?.teamId);if(t && Number.isInteger(data.points) && Math.abs(data.points)<=10){t.score+=data.points;broadcast();}});
  socket.on('disconnect',()=>{if(teamId && teams.has(teamId)){teams.get(teamId).connected=false;broadcast();io.to('hosts').emit('team:disconnected',{teamId});}});
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Quiz listening on port '+(process.env.PORT||3000)));
