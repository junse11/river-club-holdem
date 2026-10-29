import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InvitationInfo, Table } from './types';

export function Invitation({ code, nickname, preview, join, onJoined, onCancel }: {
  code: string; nickname: string; preview: () => Promise<InvitationInfo>;
  join: (nickname: string, password: string) => Promise<Table>;
  onJoined: (table: Table) => void; onCancel: () => void;
}) {
  const info = useQuery({ queryKey: ['invitation', code], queryFn: preview, retry: false, refetchInterval: 10000 });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current || !nickname || nickname.trim().length < 2) return;
    autoJoined.current = true;
    setPending(true);
    join(nickname.trim(), '').then(onJoined).catch(reason => {
      setError(reason instanceof Error ? reason.message : '참가하지 못했습니다.');
      setPending(false);
    });
  }, [nickname, join, onJoined]);
  const full = !!info.data && info.data.playerCount >= info.data.capacity;
  return <section className="invited-room" aria-label="초대받은 방">
    <div className="invitation-heading"><p className="eyebrow">FRIEND INVITATION · BOUNTY TABLE</p><h1>{info.data?.name ?? '친구의 테이블'}</h1><p>방 코드 <strong>{code}</strong>{info.data ? ` · ${info.data.playerCount}/${info.data.capacity}명 · 블라인드 ${info.data.sb}/${info.data.bb}` : ''}</p></div>
    <div className="invitation-layout"><div className="invitation-table"><span>♠ RIVER CLUB</span><strong>{info.data?.running ? '친구들이 플레이하고 있습니다' : '친구들과 한 테이블에서'}</strong><p>{info.data?.running ? '참가하면 다음 핸드부터 함께 플레이합니다.' : '닉네임을 입력하면 비밀번호 없이 바로 입장합니다.'}</p><small>시작 스택 100BB · 탈락시키면 바운티 +1</small></div>
      <form className="room-join-card" onSubmit={async event => {
        event.preventDefault(); if (pending) return;
        const form = new FormData(event.currentTarget); setPending(true); setError('');
        try { onJoined(await join(String(form.get('nickname')).trim(), '')); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '참가하지 못했습니다.'); setPending(false); }
      }}><h2>이 방에서 사용할 닉네임</h2><label>닉네임<input name="nickname" defaultValue={nickname} placeholder="2~20자" required minLength={2} maxLength={20} autoComplete="nickname" disabled={pending}/></label>
      <div className="join-status" role="status">{error || (info.error instanceof Error ? info.error.message : full ? '현재 방이 가득 찼습니다. 기존 참가자는 다시 연결할 수 있습니다.' : info.isPending ? '방 정보를 확인하고 있습니다…' : '')}</div>
      <button className="primary" disabled={pending}>{pending ? '입장 중…' : '비밀번호 없이 바로 입장'}</button><button type="button" onClick={onCancel} disabled={pending}>로비로 돌아가기</button><small>초대 링크로 비밀번호 없이 즉시 입장합니다.</small></form>
    </div>
  </section>;
}
