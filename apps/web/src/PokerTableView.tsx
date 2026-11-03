import { Card } from './Card';
import { evaluateHand, handLabel } from './serverless';
import type { Table } from './types';

function getCurrentHandBadge(holeCards: string[], board: string[]): string | null {
  const validHole = holeCards.filter(Boolean);
  if (validHole.length < 2) return null;
  const all = [...board.filter(Boolean), ...validHole];
  if (all.length >= 5) {
    return handLabel(evaluateHand(all)).toUpperCase();
  }
  const r1 = validHole[0].slice(0, -1);
  const r2 = validHole[1].slice(0, -1);
  if (r1 === r2) return 'ONE PAIR';
  return 'HIGH CARD';
}

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
  const timerPct = Math.max(5, Math.min(100, (seconds / 30) * 100));
  const chatList = table.chat ?? [];

  const streetLogs = playing
    ? table.log.filter(l => !l.street || l.street === table.street)
    : [];

  return <>
    <div className="poker-table pn-oval-table" aria-label="6인 포커 테이블">
      <div className="felt pn-oval-felt">
        <div className="pn-pot-pill" aria-label="현재 팟">
          <b>{money(table.pot)}</b>
          {playing && table.currentBet > 0 && (
            <small className="pn-current-bet-sub">최고 베팅 {money(table.currentBet)}</small>
          )}
        </div>

        <div className="board pn-board" aria-label="공용 카드">
          {Array.from({ length: 5 }, (_, i) =>
            table.board[i]
              ? <Card key={i} value={table.board[i]} />
              : <span className="slot" aria-label="미공개 공용 카드" key={i} />
          )}
        </div>

        <div className="pn-felt-watermark" aria-hidden="true">
          <span>No Limit Texas Hold&apos;em</span>
          <div className="pn-watermark-logo">
            <small>POWERED BY</small>
            <strong>POKER N♠W</strong>
          </div>
        </div>

        <div className={`pn-felt-status ${table.paused ? 'paused' : ''}`} aria-live="polite">
          {table.paused ? (
            <span>⏸️ PAUSED · 방장이 게임을 일시정지했습니다</span>
          ) : playing ? (
            actor ? (
              <span>● {actor.nickname}님의 차례 ({seconds}초)</span>
            ) : (
              <span>🔥 ALL-IN RUNOUT · 3초 간격 {table.street} 오픈 중 ({Math.max(1, seconds)}초)</span>
            )
          ) : table.street === 'SETTLED' ? (
            <span>{table.result || '핸드 정산 완료 · 4초 후 다음 핸드'}</span>
          ) : (
            <span>{table.result || '플레이어 준비 대기 중'}</span>
          )}
          {isHost && onTogglePause && (
            <button
              type="button"
              className={`pn-felt-pause-btn ${table.paused ? 'resume' : ''}`}
              disabled={busy}
              onClick={onTogglePause}
            >
              {table.paused ? '▶️ 재개' : '⏸️ PAUSE'}
            </button>
          )}
        </div>
      </div>

      {Array.from({ length: 6 }, (_, seat) => {
        const p = table.players.find(player => player.seat === seat);
        const relative = (seat - (me?.seat ?? 0) + 6) % 6;
        const latestChat = p ? [...chatList].reverse().find(c => c.userId === p.id && now - c.time < 6000) : undefined;
        const isDealer = Boolean(p && p.position.includes('BTN'));
        const isAllIn = Boolean(p && p.stack === 0 && playing && !p.folded);
        const hasBet = Boolean(p && p.bet > 0);
        const isTopBet = Boolean(playing && p && table.currentBet > 0 && p.bet === table.currentBet);
        const isShowdownRevealed = Boolean(table.street === 'SETTLED' && p?.showdown);
        const lastPlayerAct = p ? [...streetLogs].reverse().find(l => l.nickname === p.nickname) : undefined;
        const handBadge = p && (!p.folded || !playing) ? getCurrentHandBadge(p.cards, table.board) : null;
        const bountyVictimsText = p?.bountyVictims?.length
          ? p.bountyVictims.map(v => v.amount === 1 ? `${v.nickname}` : `${v.nickname}×${Number(v.amount.toFixed(2))}`).join(', ')
          : '';

        let feltPillContent: React.ReactNode = null;
        if (p) {
          if (isShowdownRevealed) {
            feltPillContent = <>🃏 SHOWDOWN</>;
          } else if (isAllIn) {
            feltPillContent = <>ALL IN {p.bet > 0 ? <strong>{money(p.bet)}</strong> : ''}</>;
          } else if (hasBet) {
            const actPrefix = lastPlayerAct?.action === 'RAISE' ? 'raise ' : lastPlayerAct?.action === 'BET' ? 'bet ' : lastPlayerAct?.action === 'CALL' ? 'call ' : '';
            feltPillContent = <>{actPrefix}<strong>{money(p.bet)}</strong></>;
          } else if (playing && lastPlayerAct?.action === 'CHECK') {
            feltPillContent = <>check</>;
          }
        }

        return (
          <div
            key={seat}
            data-seat={seat}
            className={`player pn-seat seat-${relative} ${p?.id === userId ? 'self' : ''} ${p?.seat === table.actor && playing ? 'turn' : ''} ${p?.folded && playing ? 'folded' : ''} ${hasBet ? 'has-bet' : ''} ${isTopBet ? 'highest-bet' : ''} ${isShowdownRevealed ? 'showdown-winner' : ''} ${!p ? 'is-empty' : ''}`}
          >
            {p ? (
              <>
                {isDealer && <span className="pn-dealer-btn" title="Dealer (BTN)">D</span>}
                {feltPillContent && (
                  <em className={`seat-bet pn-felt-pill ${isAllIn ? 'allin-bet' : 'active-bet'} ${isTopBet ? 'top-bet' : ''}`}>
                    {feltPillContent}
                  </em>
                )}
                {latestChat && <div className="seat-chat-bubble" title={latestChat.text}>💬 {latestChat.text}</div>}

                <div className="pn-seat-top-pills">
                  <span className="pn-stat-pill pn-pill-green" aria-label={`포지션 ${p.position}`}>
                    {p.position}{p.ready && !playing ? ' ✓' : ''}
                  </span>
                  <span className="pn-stat-pill pn-pill-red" title={bountyVictimsText ? `획득 바운티: ${bountyVictimsText}` : '바운티 점수'}>
                    🎯 {Number(p.bounty.toFixed(2))}
                  </span>
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
                </div>

                <div className="pn-seat-left">
                  {p.folded && playing ? (
                    <div className="pn-folded-mark" aria-label="폴드">
                      <span>✕</span>
                      <small>FOLD</small>
                    </div>
                  ) : p.cardCount > 0 ? (
                    <div className="pn-hole-wrap">
                      <div className="hole pn-hole" aria-label={p.id === userId ? '내 홀 카드' : `${p.nickname} 홀 카드`}>
                        {Array.from({ length: p.cardCount }, (_, i) => <Card key={i} value={p.cards[i]} />)}
                      </div>
                      {handBadge && <span className="pn-hand-rank-badge">{handBadge}</span>}
                    </div>
                  ) : (
                    <div className="pn-waiting-mark">
                      <small>{p.ready ? 'READY' : 'WAIT'}</small>
                    </div>
                  )}
                </div>

                <div className="pn-seat-info">
                  <b className="player-name" title={p.nickname}>
                    {p.id === table.host ? '♛ ' : ''}{p.nickname}{p.id === userId ? ' (나)' : ''}
                  </b>
                  <span className="player-stack">{money(p.stack)}</span>
                  {bountyVictimsText && (
                    <small className="bounty-score">🪙 {bountyVictimsText} 칩</small>
                  )}
                </div>

                {playing && p.seat === table.actor && (
                  <div className="pn-turn-bar" role="timer" aria-label="남은 행동 시간">
                    <div className="pn-turn-bar-fill" style={{ width: `${timerPct}%` }} />
                  </div>
                )}
              </>
            ) : (
              <span className="empty-seat">빈 좌석</span>
            )}
          </div>
        );
      })}
    </div>
  </>;
}
