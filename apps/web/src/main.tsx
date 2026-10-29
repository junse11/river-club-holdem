import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Client } from '@stomp/stompjs';
import { create } from 'zustand';
import './style.css';
import { ActionControls } from './ActionControls';
import { Invitation } from './Invitation';
import { Card } from './Card';
import { PokerTableView } from './PokerTableView';
import { sound } from './sound';
import type { User, Table, BountyAward, Review, InvitationInfo } from './types';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function commandId(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
const useSettings=create<{bb:boolean;sound:boolean;toggle:()=>void;toggleSound:()=>void}>(set=>({bb:true,sound:sound.isEnabled(),toggle:()=>set(s=>({bb:!s.bb})),toggleSound:()=>set(s=>{const next=!s.sound;sound.setEnabled(next);return{sound:next};})}));
class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
async function api<T>(path:string,body?:unknown):Promise<T>{
  const headers:Record<string,string>={};
  if(body!==undefined){const response=await fetch('/api/auth/csrf',{credentials:'include'});if(!response.ok)throw new Error('서버 연결 실패');const token=await response.json() as {headerName:string;token:string};headers[token.headerName]=token.token;headers['Content-Type']='application/json';}
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'include',headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):undefined;}catch{data=undefined;}
  if(!response.ok)throw new ApiError(data?.message??(response.status===401?'세션이 만료되었습니다. 다시 로그인해주세요.':'요청 실패'),response.status);
  return data as T;
}
function App(){
 const cache=useQueryClient(),preferences=useSettings();
 const user=useQuery({queryKey:['me'],queryFn:async()=>{try{return await api<User>('/api/auth/me');}catch(e){if(e instanceof ApiError&&e.status===401)return null;throw e;}}});
 const [code,setCode]=useState(()=>sessionStorage.getItem('river:room')??'');
 const [invite,setInvite]=useState(()=>new URLSearchParams(location.search).get('join')?.trim().toUpperCase()??'');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[connected,setConnected]=useState(false),[now,setNow]=useState(Date.now()),[settingsOpen,setSettingsOpen]=useState(false),[recordsOpen,setRecordsOpen]=useState(false);
 const room=useQuery({queryKey:['room',code],queryFn:()=>api<Table>(`/api/rooms/${code}`),enabled:!!code&&!!user.data,refetchInterval:2000,refetchIntervalInBackground:true});
 const history=useQuery({queryKey:['history',code,room.data?.hand,room.data?.street],queryFn:()=>api<Review[]>(`/api/rooms/${code}/history`),enabled:!!room.data});
 useEffect(()=>{sessionStorage.setItem('river:room',code);},[code]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!user.data)return;const ws=new Client({brokerURL:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`,reconnectDelay:3000,onConnect:()=>{setConnected(true);ws.subscribe('/user/queue/updates',()=>{void cache.invalidateQueries({queryKey:['room']});});},onWebSocketClose:()=>setConnected(false)});ws.activate();return()=>{void ws.deactivate();};},[user.data?.id,cache]);
 useEffect(()=>{if(room.error instanceof ApiError&&room.error.status===401)void cache.invalidateQueries({queryKey:['me']});},[room.error,cache]);
 const run=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'요청 실패');}finally{setBusy(false);}};
 const enter=useCallback((t:Table)=>{cache.setQueryData(['room',t.code],t);setCode(t.code);setInvite('');const url=new URL(location.href);url.searchParams.delete('join');window.history.replaceState(null,'',url);},[cache]);
 const previewInvite=useCallback(()=>api<InvitationInfo>(`/api/invitations/${encodeURIComponent(invite)}`),[invite]);
 const joinInvite=useCallback(async(nickname:string,password:string)=>{if(!user.data){const loggedIn=await api<User>('/api/auth/guest',{nickname});cache.setQueryData(['me'],loggedIn);}return api<Table>(`/api/rooms/${encodeURIComponent(invite)}/join`,{password,nickname});},[invite,user.data,cache]);
 const cancelInvite=()=>{setInvite('');const url=new URL(location.href);url.searchParams.delete('join');window.history.replaceState(null,'',url);};
 const update=async(path:string,body:unknown={})=>{cache.setQueryData(['room',code],await api<Table>(`/api/rooms/${code}/${path}`,body));};
 const t=room.data,me=t?.players.find(p=>p.id===user.data?.id),playing=t&&!['WAITING','SETTLED'].includes(t.street);
 const prevTableRef=useRef<Table|null>(null),lastTickRef=useRef('');
 useEffect(()=>{
  if(!t){prevTableRef.current=null;return;}
  const prev=prevTableRef.current;
  if(!prev||prev.code!==t.code){prevTableRef.current=t;return;}
  if(prev.version===t.version&&prev.hand===t.hand&&prev.street===t.street&&prev.actor===t.actor&&prev.players.length===t.players.length)return;
  prevTableRef.current=t;
  if(t.hand!==prev.hand&&t.street==='PREFLOP'){
   sound.dealHand();
   if(me&&t.actor===me.seat)sound.myTurn(260);
   return;
  }
  if(t.hand===prev.hand){
   let actionPlayed=false;
   if(t.log.length>prev.log.length){
    actionPlayed=true;
    const lastAction=t.log[t.log.length-1]?.action;
    if(lastAction==='FOLD')sound.fold();
    else if(lastAction==='CHECK')sound.check();
    else if(lastAction==='CALL')sound.call();
    else if(lastAction==='BET'||lastAction==='RAISE')sound.raise();
    else if(lastAction==='ALL_IN')sound.allIn();
   }
   const newCards=Math.max(0,t.board.length-prev.board.length);
   const cardBaseDelay=actionPlayed?170:0;
   for(let i=0;i<newCards;i++)sound.cardFlip(cardBaseDelay+i*85,1800+i*140);
   if(t.street==='SETTLED'&&prev.street!=='SETTLED'){
    const settleDelay=cardBaseDelay+newCards*85+(actionPlayed&&newCards===0?40:0);
    if(t.bountyAwards.length>0)sound.bounty(settleDelay);
    else{
     const mePrev=prev.players.find(p=>p.id===user.data?.id);
     sound.settle(!!(me&&mePrev&&me.stack>mePrev.stack),settleDelay);
    }
    return;
   }
   if(playing&&me&&t.actor===me.seat&&(prev.actor!==me.seat||prev.street!==t.street)){
    sound.myTurn(cardBaseDelay+newCards*85+(actionPlayed&&newCards===0?40:0));
   }
   if(!playing){
    const showdownRevealed=t.street==='SETTLED'&&t.players.some(p=>p.showdown&&!prev.players.find(q=>q.id===p.id)?.showdown);
    if(showdownRevealed){sound.cardFlip(0,1850);sound.cardFlip(75,2100);}
    const readyChanged=t.players.some(p=>p.ready!==prev.players.find(q=>q.id===p.id)?.ready);
    if(t.players.length>prev.players.length||readyChanged)sound.ready();
   }
  }
 },[t,me,playing,user.data?.id]);
 useEffect(()=>{
  if(!t||!playing||!me||t.actor!==me.seat)return;
  const secs=Math.min(30,Math.max(0,Math.ceil((t.deadline-now)/1000)));
  if(secs>=1&&secs<=10){
   const key=`${t.code}-${t.hand}-${t.version}-${secs}`;
   if(lastTickRef.current!==key){lastTickRef.current=key;sound.tick(secs<=3);}
  }
 },[t,playing,me,now]);
 const money=(n:number)=>preferences.bb&&t?`${Number((n/t.bb).toFixed(2))} BB`:`${n.toLocaleString()}원`;
 const form=(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();return new FormData(e.currentTarget);};
 return <main><header><a href="/" className="brand">♠ RIVER CLUB</a><span>BOUNTY TABLE · 무료 칩</span><div><button type="button" onClick={preferences.toggleSound} aria-pressed={preferences.sound} title={preferences.sound?'효과음 끄기':'효과음 켜기'}>{preferences.sound?'🔊 소리':'🔇 음소거'}</button><button type="button" onClick={()=>setSettingsOpen(v=>!v)} aria-expanded={settingsOpen}>⚙️ 설정</button>{user.data&&<button disabled={busy} onClick={()=>void run(async()=>{if(code){try{await api('/api/rooms/'+code+'/leave',{});}catch(e){if(!(e instanceof ApiError&&[400,401].includes(e.status)))throw e;}}await api('/api/auth/logout',{});cache.clear();setCode('');await cache.invalidateQueries({queryKey:['me']});})}>로그아웃</button>}</div></header><div className="error" role="status">{error||(room.error instanceof Error?room.error.message:'')}</div>
 {settingsOpen&&<section className="settings-modal" role="dialog" aria-label="게임 및 BB 설정"><div className="settings-card"><div className="settings-header"><h2>⚙️ 게임 · BB 설정</h2><button type="button" onClick={()=>setSettingsOpen(false)}>닫기 ✕</button></div><div className="settings-group"><span>표시 및 사운드</span><div className="settings-row"><button type="button" onClick={preferences.toggle}>금액 표시: <strong>{preferences.bb?'BB 단위':'원 단위'}</strong> (전환)</button><button type="button" onClick={preferences.toggleSound}>{preferences.sound?'🔊 효과음 켜짐':'🔇 효과음 꺼짐'}</button></div></div>{t&&<div className="settings-group"><span>블라인드 (SB / BB) 설정</span>{t.host===user.data?.id?<form onSubmit={e=>{const f=form(e);void run(async()=>{await update('blinds',{sb:Number(f.get('sb')),bb:Number(f.get('bb'))});setSettingsOpen(false);});}}><div className="blind-inputs"><label>Small Blind<input name="sb" type="number" min={1} max={5000} defaultValue={t.sb} required/></label><label>Big Blind<input name="bb" type="number" min={2} max={10000} defaultValue={t.bb} required/></label></div><button className="primary" disabled={busy}>블라인드 적용</button><small>핸드 중 변경은 다음 핸드부터 적용{t.pendingBlinds.length?` · 예약 ${t.pendingBlinds.join('/')}`:''}</small></form>:<p>현재 블라인드 <strong>{t.sb}/{t.bb}</strong>{t.pendingBlinds.length?` (다음 핸드 ${t.pendingBlinds.join('/')})`:''} · 방장만 변경할 수 있습니다.</p>}</div>}{t&&<div className="settings-group"><label htmlFor="room-invite-link">친구 초대 링크 · 방에서 닉네임을 정하고 참가</label><input id="room-invite-link" readOnly value={`${location.origin}/?join=${code}`} onFocus={event=>event.currentTarget.select()}/></div>}</div></section>}
 {user.isPending?<p>세션 확인 중…</p>:invite?<Invitation key={invite} code={invite} nickname={user.data?.nickname??''} preview={previewInvite} join={joinInvite} onJoined={enter} onCancel={cancelInvite}/>:!user.data?<section className="entry"><p className="eyebrow">PRIVATE POKER NIGHT</p><h1>친구들과<br/>한 테이블에서.</h1><p>{invite?`초대 코드 ${invite} · 닉네임을 정하면 친구 방으로 바로 입장합니다.`:'닉네임으로 로그인하고 초대 코드로 모이세요.'}</p><form onSubmit={e=>{const f=form(e);void run(async()=>{cache.setQueryData(['me'],await api<User>('/api/auth/guest',{nickname:f.get('nickname')}));});}}><label>닉네임<input name="nickname" required minLength={2} maxLength={20} placeholder="2~20자"/></label><button className="primary" disabled={busy}>입장하기 →</button></form><small>비밀번호 없는 임시 세션입니다. 같은 브라우저로 재접속하세요.</small></section>:!code?<section className="lobby"><p className="eyebrow">WELCOME, {user.data?.nickname}</p><h1>오늘의 포커 나이트</h1><p>2~6인 바운티 매치 · 상대 스택을 0으로 만들면 1점 · 탈락 발생 시 전원 100BB 리셋</p><div className="forms">{[false,true].map(join=><form key={String(join)} onSubmit={e=>{const f=form(e);void run(async()=>{enter(await api<Table>(join?`/api/rooms/${encodeURIComponent(String(f.get('code')).trim().toUpperCase())}/join`:'/api/rooms',{name:f.get('name'),password:f.get('password')}));});}}><h2>{join?'친구 방 참가':'새 친선방 만들기'}</h2>{join?<label>초대 코드<input name="code" required minLength={8} maxLength={8} defaultValue={new URLSearchParams(location.search).get('join')??''}/></label>:<label>방 이름<input name="name" required maxLength={40} defaultValue={`${user.data?.nickname}의 테이블`}/></label>}<label>방 비밀번호 {join?'':'(선택)'}<input name="password" type="password" maxLength={60}/></label><small>시작 스택 100BB · 바운티는 칩과 별도 점수입니다.</small><button className="primary" disabled={busy}>{join?'참가하기':'방 만들기'}</button></form>)}</div></section>:!t?<section className="entry"><h2>{room.isError?'테이블에 연결하지 못했습니다':'테이블 연결 중'}</h2><button onClick={()=>setCode('')}>로비로 돌아가기</button></section>:<>
 <section className="room-heading"><div><p className="eyebrow">{connected?'● LIVE':'● 재연결 대기'}</p><h2>{t.name}</h2><p>코드 <strong>{code}</strong> · 블라인드 {t.sb}/{t.bb}{t.pendingBlinds.length?` (예약 ${t.pendingBlinds.join('/')})`:''}</p></div><div><button type="button" onClick={()=>void run(async()=>{const url=`${location.origin}/?join=${code}`;if(navigator.clipboard)await navigator.clipboard.writeText(url);else{setSettingsOpen(true);setError('설정 창의 초대 링크를 복사해 친구에게 보내주세요.');return;}setError('초대 링크를 복사했습니다.');})}>초대 복사</button><button type="button" onClick={()=>setSettingsOpen(v=>!v)} aria-expanded={settingsOpen}>⚙️ BB·설정</button><button type="button" className="mobile-only-btn" onClick={()=>setRecordsOpen(v=>!v)} aria-expanded={recordsOpen}>📊 순위·기록</button><button disabled={busy} onClick={()=>void run(async()=>{await api(`/api/rooms/${code}/leave`,{});setCode('');})}>나가기</button></div></section>
 <div className="layout"><section><PokerTableView table={t} userId={user.data?.id} now={now} money={money}/><div className="result">{t.result||(playing?`${t.players.find(p=>p.seat===t.actor)?.nickname??''}님의 차례`:'모두 준비하면 시작할 수 있습니다.')}</div>
 {!playing?<div className="controls">{t.street==='SETTLED'&&me&&me.cardCount>0&&<button type="button" className={me.showdown?'call-button':'primary'} disabled={busy} onClick={()=>void run(()=>update('showdown',{showdown:!me.showdown}))}>{me.showdown?'🙈 쇼다운 취소 · 패 숨기기':'🃏 쇼다운 · 내 패 공개하기'}</button>}<button className={t.street==='SETTLED'?'':'primary'} disabled={busy||!me||(me.stack===0&&!t.resetPending)} onClick={()=>void run(()=>update('ready',{ready:!me?.ready}))}>{me?.ready?'준비 취소':'준비 완료'}</button>{t.host===user.data.id&&<button disabled={busy||t.players.filter(p=>(p.stack>0||t.resetPending)).length<2||t.players.some(p=>(p.stack>0||t.resetPending)&&!p.ready)} onClick={()=>void run(()=>update('start'))}>게임 시작</button>}<small>{t.street==='SETTLED'&&me&&me.cardCount>0?(me.showdown?'내 홀 카드가 테이블에 공개되었습니다 · ':'쇼다운 버튼으로 내 패를 공개할지 선택하세요 · '):''}{t.resetPending?'7초 뒤 전원 100BB로 리셋 · 바운티 점수는 유지됩니다.':'정산 후 7초 뒤 다음 핸드 자동 시작'}</small></div>:<ActionControls key={`${t.hand}-${t.version}`} table={t} me={me} money={money} busy={busy} secondsLeft={Math.min(30,Math.max(0,Math.ceil((t.deadline-now)/1000)))} act={(action,amountTo)=>void run(()=>update('actions',{commandId:commandId(),hand:t.hand,version:t.version,action,amountTo}))}/>}
 </section><aside className={recordsOpen?'mobile-open':''}><article><p className="eyebrow">BOUNTY LEADERBOARD</p><h2>바운티 순위</h2>{t.players.slice().sort((a,b)=>b.bountyUnits-a.bountyUnits).map((p,i)=><p className="leaderboard-row" key={p.id}><span>{i+1}. {p.nickname}</span><strong>🎯 {Number(p.bounty.toFixed(3))}</strong></p>)}<p>스택 0으로 탈락시키면 1점. 공동 승자는 나눠 갖습니다. 탈락 발생 시 다음 핸드 전원 100BB로 시작합니다.</p><BountyAwards awards={t.bountyAwards}/></article><article><h2>액션 기록</h2><div className="log">{t.log.map((l,i)=><p key={i}><b>{l.nickname}</b> {l.action} <span>{money(l.amountTo)}</span></p>)}</div></article><article><h2>핸드 리뷰</h2>{history.data?.slice().reverse().slice(0,10).map(h=><details key={h.hand}><summary>HAND #{h.hand}</summary><div className="review">{h.board.map(c=><Card key={c} value={c}/>)}</div>{h.payouts.map((p,i)=><p key={i}>{p.nickname} +{money(p.amount)} · {p.rank}</p>)}<BountyAwards awards={h.bounties??[]}/>{h.resetToBb>0&&<p>다음 핸드 전원 100BB 리셋</p>}</details>)}</article></aside></div></>}
 <footer>무료 가상 칩 전용 · 원 표시는 표시 형식입니다 · 로컬 서버 재시작 시 세션과 기록 초기화</footer></main>;
}
function BountyAwards({awards}:{awards:BountyAward[]}){return <>{awards.map(a=><p className="bounty-award" key={a.victimId}>{a.victimNickname} 탈락 → {a.recipients.map(r=>`${r.nickname} +${Number(r.amount.toFixed(3))}`).join(' · ')} 바운티</p>)}</>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><App/></QueryClientProvider></React.StrictMode>);
