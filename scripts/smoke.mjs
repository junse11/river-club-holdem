import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
const origin=process.env.SMOKE_ORIGIN??'http://127.0.0.1:5173';
export class Session {
 cookies=new Map();
 async request(path,body,expected=200){
  const headers={Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
  if(body!==undefined){const token=await this.request('/api/auth/csrf');headers[token.headerName]=token.token;headers['Content-Type']='application/json';}
  headers.Cookie=[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1));}
  const text=await response.text();assert.equal(response.status,expected,`${path}: ${text}`);return text?JSON.parse(text):null;
 }
 async connect(){
  const socket=new WebSocket(origin.replace(/^http/,'ws')+'/ws',{headers:{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),Origin:origin}});
  const frames=[];socket.on('message',data=>frames.push(data.toString()));
  const wait=async(predicate)=>{const until=Date.now()+5000;while(Date.now()<until){const found=frames.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,25));}throw Error('STOMP frame timeout: '+frames.join('|'));};
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  socket.send('CONNECT\naccept-version:1.2\nhost:localhost\n\n\0');await wait(f=>f.startsWith('CONNECTED'));
  socket.send('SUBSCRIBE\nid:updates\ndestination:/user/queue/updates\n\n\0');
  // Spring's simple broker does not implement STOMP receipts.
  await new Promise(resolve=>setTimeout(resolve,100));
  return {socket,frames,wait};
 }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
const a=new Session(),b=new Session();let wa,wb;let code;
try{
 await a.request('/api/auth/guest',{nickname:'Smoke Alice'});await b.request('/api/auth/guest',{nickname:'Smoke Bob'});
 wa=await a.connect();wb=await b.connect();
 let table=await a.request('/api/rooms',{name:'Disposable smoke room',password:'friends',buyin:1000});code=table.code;
 await b.request(`/api/rooms/${code}/join`,{password:'wrong',buyin:1000},400);
 await b.request(`/api/rooms/${code}/join`,{password:'friends',buyin:1000});
 const update=await wa.wait(f=>f.startsWith('MESSAGE'));assert(!update.includes('cards'),'Notification must not carry cards');
 await a.request(`/api/rooms/${code}/ready`,{ready:true});await b.request(`/api/rooms/${code}/ready`,{ready:true});
 table=await a.request(`/api/rooms/${code}/start`,{});assert.equal(table.street,'PREFLOP');assert.equal(table.players[1].cards.length,0);
 const other=await b.request(`/api/rooms/${code}`);assert.equal(other.players[0].cards.length,0);assert.equal(other.players[1].cards.length,2);
 wb.socket.close();wb=await b.connect();const snapshot=await b.request(`/api/rooms/${code}`);assert.equal(snapshot.players[1].stack,9900);
 const command={commandId:crypto.randomUUID(),hand:table.hand,version:table.version,action:'FOLD'};
 await b.request(`/api/rooms/${code}/actions`,command,400);
 table=await a.request(`/api/rooms/${code}/actions`,command);assert.equal(table.street,'SETTLED');assert.equal(table.players[1].stack,10050);
 const duplicate=await a.request(`/api/rooms/${code}/actions`,command);assert.equal(duplicate.version,table.version);
 assert.equal((await a.request(`/api/rooms/${code}/history`)).length,1);
 await a.request(`/api/rooms/${code}/leave`,{});await b.request(`/api/rooms/${code}/leave`,{});
 await a.request('/api/auth/logout',{},204);await a.request('/api/auth/me',undefined,401);
 console.log('PASS: two real sessions, password join, private cards, STOMP updates/reconnect, hand settlement, command dedup, review, logout');
}finally{wa?.socket.close();wb?.socket.close();}
}
