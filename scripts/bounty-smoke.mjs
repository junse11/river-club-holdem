import assert from 'node:assert/strict';
import {Session} from './smoke.mjs';
const a=new Session(),b=new Session();
const ua=await a.request('/api/auth/guest',{nickname:'Bounty Alice'});
const ub=await b.request('/api/auth/guest',{nickname:'Bounty Bob'});
const sessions=new Map([[ua.id,a],[ub.id,b]]);
let t=await a.request('/api/rooms',{name:'Bounty smoke'});const path=`/api/rooms/${t.code}`;
try{
 await b.request(`${path}/join`,{});
 await a.request(`${path}/ready`,{ready:true});await b.request(`${path}/ready`,{ready:true});
 for(let attempt=0;attempt<10;attempt++){
  t=await a.request(`${path}/start`,{});let last;
  while(!['SETTLED','WAITING'].includes(t.street)){
   const id=t.players.find(p=>p.seat===t.actor).id;
   const session=sessions.get(id);const view=await session.request(path);
   const action=view.allowedActions.includes('ALL_IN')?'ALL_IN':view.allowedActions.includes('CALL')?'CALL':'CHECK';
   const command={commandId:crypto.randomUUID(),hand:view.hand,version:view.version,action};
   t=await session.request(`${path}/actions`,command);last={session,command};
  }
  if(!t.resetPending)continue; // A tied board can return both players' chips.
  assert.equal(t.players.reduce((sum,p)=>sum+p.bountyUnits,0),60);
  assert.equal(t.bountyAwards.length,1);assert(t.players.some(p=>p.stack===0));
  const duplicate=await last.session.request(`${path}/actions`,last.command);
  assert.equal(duplicate.players.reduce((sum,p)=>sum+p.bountyUnits,0),60);
  const oldHand=t.hand;const until=Date.now()+11000;
  while(Date.now()<until){t=await a.request(path);await b.request(path);if(t.hand>oldHand)break;await new Promise(r=>setTimeout(r,150));}
  assert.equal(t.hand,oldHand+1);assert.equal(t.street,'PREFLOP');assert.equal(t.resetPending,false);
  for(const p of t.players)assert.equal(p.stack+p.bet,100*t.bb);
  assert.equal(t.players.reduce((sum,p)=>sum+p.bountyUnits,0),60);
  assert(!('strategyStatus' in t));assert(!('studyAllowed' in t));
  console.log('PASS: knockout awards one bounty once; automatic next hand respawns everyone at 100BB; scores persist; strategy fields removed');
  process.exitCode=0;break;
 }
 assert.equal(t.players.reduce((sum,p)=>sum+p.bountyUnits,0),60,'No knockout after 10 all-in hands');
}finally{await a.request(`${path}/leave`,{});await b.request(`${path}/leave`,{});}
