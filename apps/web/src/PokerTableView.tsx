import { Card } from './Card';
import type { Table } from './types';

export function PokerTableView({ table, userId, now, money }: { table: Table; userId?: string; now: number; money: (n: number) => string }) {
  const me = table.players.find(p => p.id === userId);
  const playing = !['WAITING', 'SETTLED'].includes(table.street);
  const actor = table.players.find(p => p.seat === table.actor);
  const seconds = Math.min(30, Math.max(0, Math.ceil((table.deadline - now) / 1000)));
  const chatList = table.chat ?? [];
  return <>
    <div className="table-hud" aria-label="게임 진행 상태">
      <div className="turn-summary"><span>{table.street} · HAND #{table.hand}</span><strong>{playing ? (actor ? `${actor.nickname}님의 차례` : `🔥 올인 쇼다운 · ${table.street} 오픈 중…`) : table.resetPending ? '바운티 정산 · 100BB 리셋 예정' : table.street === 'SETTLED' ? '핸드 정산 완료 (4초 후 다음 핸드)' : '플레이어 준비 중'}</strong></div>
      <div className={`turn-clock ${playing && actor && seconds <= 10 ? 'urgent' : ''}`} role="timer" aria-label="남은 행동 시간">{playing ? (actor ? <><b>{seconds}</b><span>초 남음</span></> : <span>올인 오픈</span>) : <span>대기 중</span>}</div>
    </div>
    <div className="poker-table" aria-label="6인 포커 테이블">
      <div className="felt"><small>RIVER CLUB</small><div className="board" aria-label="공용 카드">{Array.from({ length: 5 }, (_, i) => table.board[i] ? <Card key={i} value={table.board[i]} /> : <span className="slot" aria-label="미공개 공용 카드" key={i}/>)}</div><b>POT {money(table.pot)}</b></div>
      {Array.from({ length: 6 }, (_, seat) => {
        const p = table.players.find(player => player.seat === seat);
        const relative = (seat - (me?.seat ?? 0) + 6) % 6;
        const latestChat = p ? [...chatList].reverse().find(c => c.userId === p.id && now - c.time < 6000) : undefined;
        const posClass = p?.position.includes('BTN') ? 'pos-btn' : p?.position === 'SB' || p?.position === 'BB' ? 'pos-blind' : p?.position === 'WAIT' ? 'pos-wait' : 'pos-std';
        return <div key={seat} data-seat={seat} className={`player seat-${relative} ${p?.id === userId ? 'self' : ''} ${p?.seat === table.actor ? 'turn' : ''} ${p?.folded && playing ? 'folded' : ''}`}>
          {p ? <>
            {latestChat && <div className="seat-chat-bubble" title={latestChat.text}>💬 {latestChat.text}</div>}
            <div className="hole" aria-label={p.id === userId ? '내 홀 카드' : `${p.nickname} 홀 카드`}>{Array.from({ length: p.cardCount }, (_, i) => <Card key={i} value={p.cards[i]}/>)}</div>
            <span className={`pos-badge ${posClass}`} aria-label={`포지션 ${p.position}`}>{p.position}{p.ready && !playing ? ' ✓' : ''}</span>
            <b className="player-name" title={p.nickname}>{p.id === table.host ? '♛ ' : ''}{p.nickname}{p.id === userId ? ' (나)' : ''}</b>
            <span>{money(p.stack)}</span>
            <small className="bounty-score">🎯 {Number(p.bounty.toFixed(3))} 바운티{p.folded && playing ? ' · FOLD' : ''}{table.street === 'SETTLED' && p.cardCount > 0 ? (p.showdown ? ' · 🃏 공개' : ' · 🔒 비공개') : ''}</small>
            <em className="seat-bet">{p.bet > 0 ? `베팅 ${money(p.bet)}` : p.stack === 0 && playing && !p.folded ? 'ALL-IN' : '\u00a0'}</em>
          </> : <span className="empty-seat">빈 좌석</span>}
        </div>;
      })}
    </div>
  </>;
}
