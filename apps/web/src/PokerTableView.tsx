import { Card } from './Card';
import type { Table } from './types';

export function PokerTableView({ table, userId, now, money, onKick, onTogglePause, busy }: {
  table: Table;
  userId?: string;
  now: number;
  money: (n: number) => string;
  onKick?: (targetId: string, nickname: string) => void;
  onTogglePause?: () => void;
  busy?: boolean;
}) {
  const me = table.players.find(p => p.id === userId);
  const isHost = Boolean(userId && table.host === userId);
  const playing = !['WAITING', 'SETTLED'].includes(table.street);
  const actor = table.players.find(p => p.seat === table.actor);
  const seconds = Math.min(30, Math.max(0, Math.ceil((table.deadline - now) / 1000)));
  const chatList = table.chat ?? [];
  const lastBetAction = playing
    ? [...table.log].reverse().find(l => (!l.street || l.street === table.street) && (l.amountTo > 0 || l.action === 'CHECK' || l.action === 'FOLD'))
    : undefined;
  return <>
    <div className={`table-hud ${table.paused ? 'paused-hud' : ''}`} aria-label="게임 진행 상태">
      <div className="turn-summary">
        <span>{table.street} · HAND #{table.hand}{table.paused ? ' · ⏸️ PAUSED' : ''}</span>
        <strong>
          {table.paused
            ? '⏸️ 방장이 게임을 일시정지했습니다'
            : playing
              ? (actor ? `${actor.nickname}님의 차례` : `🔥 올인 쇼다운 · 3초 간격으로 ${table.street} 오픈 중…`)
              : table.resetPending
                ? '바운티 정산 · 100BB 리셋 예정'
                : table.street === 'SETTLED'
                  ? '핸드 정산 완료 (쇼다운 가능 · 4초 후 다음 핸드)'
                  : '플레이어 준비 중'}
        </strong>
      </div>
      <div className="hud-right">
        {isHost && onTogglePause && (
          <button
            type="button"
            className={`hud-pause-btn ${table.paused ? 'primary' : ''}`}
            disabled={busy}
            onClick={onTogglePause}
          >
            {table.paused ? '▶️ 재개' : '⏸️ PAUSE'}
          </button>
        )}
        <div className={`turn-clock ${!table.paused && playing && actor && seconds <= 10 ? 'urgent' : ''}`} role="timer" aria-label="남은 행동 시간">
          {table.paused
            ? <span>⏸️ 정지됨</span>
            : playing
              ? (actor ? <><b>{seconds}</b><span>초 남음</span></> : <><b>{Math.max(1, seconds)}</b><span>초 · 오픈</span></>)
              : <span>대기 중</span>}
        </div>
      </div>
    </div>
    <div className="poker-table" aria-label="6인 포커 테이블">
      <div className="felt">
        <small>↻ 시계방향 진행 · BTN → SB → BB</small>
        <div className="board" aria-label="공용 카드">{Array.from({ length: 5 }, (_, i) => table.board[i] ? <Card key={i} value={table.board[i]} /> : <span className="slot" aria-label="미공개 공용 카드" key={i}/>)}</div>
        <div className="felt-pot-row">
          <b>POT {money(table.pot)}</b>
          {playing && table.currentBet > 0 && <span className="felt-current-bet">최고 베팅 <strong>{money(table.currentBet)}</strong></span>}
        </div>
        {playing && lastBetAction && (
          <div className="felt-last-action" aria-live="polite">
            최근 액션: <b>{lastBetAction.nickname}</b> · {lastBetAction.action}{lastBetAction.amountTo > 0 ? <> <strong>{money(lastBetAction.amountTo)}</strong></> : ''}
          </div>
        )}
      </div>
      {Array.from({ length: 6 }, (_, seat) => {
        const p = table.players.find(player => player.seat === seat);
        const relative = (seat - (me?.seat ?? 0) + 6) % 6;
        const latestChat = p ? [...chatList].reverse().find(c => c.userId === p.id && now - c.time < 6000) : undefined;
        const posClass = p?.position.includes('BTN') ? 'pos-btn' : p?.position === 'SB' || p?.position === 'BB' ? 'pos-blind' : p?.position === 'WAIT' ? 'pos-wait' : 'pos-std';
        const isAllIn = Boolean(p && p.stack === 0 && playing && !p.folded);
        const hasBet = Boolean(p && p.bet > 0);
        const isTopBet = Boolean(playing && p && table.currentBet > 0 && p.bet === table.currentBet);
        const isShowdownRevealed = Boolean(table.street === 'SETTLED' && p?.showdown);
        const bountyVictimsText = p?.bountyVictims?.length
          ? p.bountyVictims.map(v => v.amount === 1 ? `${v.nickname}` : `${v.nickname}×${Number(v.amount.toFixed(2))}`).join(', ')
          : '';
        return <div key={seat} data-seat={seat} className={`player seat-${relative} ${p?.id === userId ? 'self' : ''} ${p?.seat === table.actor ? 'turn' : ''} ${p?.folded && playing ? 'folded' : ''} ${hasBet ? 'has-bet' : ''} ${isTopBet ? 'highest-bet' : ''} ${isShowdownRevealed ? 'showdown-winner' : ''}`}>
          {p ? <>
            {isHost && p.id !== userId && onKick && (
              <button
                type="button"
                className="seat-kick-btn"
                title={`${p.nickname} 강제 퇴장`}
                disabled={busy}
                onClick={() => onKick(p.id, p.nickname)}
              >
                강퇴 ✕
              </button>
            )}
            {latestChat && <div className="seat-chat-bubble" title={latestChat.text}>💬 {latestChat.text}</div>}
            <div className="hole" aria-label={p.id === userId ? '내 홀 카드' : `${p.nickname} 홀 카드`}>{Array.from({ length: p.cardCount }, (_, i) => <Card key={i} value={p.cards[i]}/>)}</div>
            <span className={`pos-badge ${posClass}`} aria-label={`포지션 ${p.position}`}>{p.position}{p.ready && !playing ? ' ✓' : ''}</span>
            <b className="player-name" title={p.nickname}>{p.id === table.host ? '♛ ' : ''}{p.nickname}{p.id === userId ? ' (나)' : ''}</b>
            <span className="player-stack">{money(p.stack)}</span>
            <small className="bounty-score">🎯 {Number(p.bounty.toFixed(3))} 바운티{bountyVictimsText ? ` (${bountyVictimsText} 칩)` : ''}{p.folded && playing ? ' · FOLD' : ''}</small>
            {isShowdownRevealed ? (
              <em className="seat-bet active-bet top-bet">🃏 쇼다운 공개</em>
            ) : isAllIn ? (
              <em className="seat-bet allin-bet">🔥 ALL-IN{p.bet > 0 ? <> <strong>{money(p.bet)}</strong></> : ''}</em>
            ) : hasBet ? (
              <em className={`seat-bet active-bet ${isTopBet ? 'top-bet' : ''}`}>🪙 베팅 <strong>{money(p.bet)}</strong></em>
            ) : (
              <em className="seat-bet">{'\u00a0'}</em>
            )}
          </> : <span className="empty-seat">빈 좌석</span>}
        </div>;
      })}
    </div>
  </>;
}
