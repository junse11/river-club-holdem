// Real server-backed six-player room for manual responsive UI inspection.
// Run with SMOKE_ORIGIN pointing to the running frontend, then open printed invite.
import {Session} from './smoke.mjs';
const origin=process.env.SMOKE_ORIGIN??'http://127.0.0.1:5173';
const peers=[];
for(let i=0;i<5;i++){
 const session=new Session();const user=await session.request('/api/auth/guest',{nickname:i===0?'검증 호스트':('긴닉네임플레이어'+i+'ABCDEFGHI').slice(0,20)});
 peers.push({session,user});
}
let table=await peers[0].session.request('/api/rooms',{name:'UI 겹침 검증 · 6인 테이블',password:'room-test'});
const path=`/api/rooms/${table.code}`;
for(const [i,peer] of peers.entries()){
 if(i>0)await peer.session.request(`${path}/join`,{password:'room-test'});
 await peer.session.request(`${path}/ready`,{ready:true});
}
console.log(`INVITE ${origin}/?join=${table.code} PASSWORD room-test`);
const until=Date.now()+600000;
try{
 while(Date.now()<until){
  for(const p of peers)table=await p.session.request(path);
  if(['WAITING','SETTLED'].includes(table.street)&&table.players.length===6&&table.players.every(p=>p.ready)){
   table=await peers[0].session.request(`${path}/start`,{});
  }
  const actor=table.players.find(p=>p.seat===table.actor);
  const peer=peers.find(p=>p.user.id===actor?.id);
  if(peer){
   const view=await peer.session.request(path);
   const action=view.allowedActions.includes('CHECK')?'CHECK':view.allowedActions.includes('CALL')?'CALL':null;
   if(action)await peer.session.request(`${path}/actions`,{commandId:crypto.randomUUID(),hand:view.hand,version:view.version,action});
  }
  await new Promise(resolve=>setTimeout(resolve,120));
 }
}finally{for(const p of peers)await p.session.request(`${path}/leave`,{}).catch(()=>{});}
