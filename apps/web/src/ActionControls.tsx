import { useEffect, useState } from 'react';
import { sound } from './sound';

type Actor = { stack: number; bet: number };
type BettingState = { pot: number; currentBet: number; minRaiseTo: number; allowedActions: string[] };

export function ActionControls({ table, me, money, busy, act, secondsLeft }: {
  table: BettingState; me?: Actor; money: (chips: number) => string;
  busy: boolean; act: (action: string, amountTo?: number) => void;
  secondsLeft?: number;
}) {
  const maximum = (me?.stack ?? 0) + (me?.bet ?? 0);
  const minimum = Math.min(table.minRaiseTo, maximum);
  const toCall = Math.min(Math.max(0, table.currentBet - (me?.bet ?? 0)), me?.stack ?? 0);
  const myTurn = table.allowedActions.length > 0;
  const raiseAction = table.allowedActions.includes('RAISE') ? 'RAISE' : table.allowedActions.includes('BET') ? 'BET' : null;
  const raiseLabel = raiseAction ?? (table.currentBet === 0 ? 'BET' : 'RAISE');
  const canFold = table.allowedActions.includes('FOLD');
  const canCheck = table.allowedActions.includes('CHECK');
  const canCall = table.allowedActions.includes('CALL');
  const canAllIn = table.allowedActions.includes('ALL_IN');
  const canSize = Boolean(raiseAction || canAllIn);
  const [amount, setAmount] = useState(minimum);
  useEffect(() => {
    setAmount(minimum);
  }, [minimum, maximum, table.currentBet]);
  const allIn = amount >= maximum && canAllIn;
  const valid = Number.isSafeInteger(amount) && amount <= maximum && (allIn || amount >= minimum);
  const selectFraction = (fraction: number) => {
    const target = table.currentBet + Math.round((table.pot + toCall) * fraction);
    setAmount(Math.min(maximum, Math.max(minimum, target)));
  };

  return <div className={`actions ${myTurn ? 'my-turn' : 'waiting-turn'}`}>
    <div className="action-status"><span>{myTurn ? '● 내 차례 · 드래그바로 금액 조절 후 아래 배팅 버튼을 누르세요' : '상대 플레이어의 액션 대기 중 (비활성)'}</span>{secondsLeft !== undefined && <strong role="timer" aria-label="액션 남은 시간">{secondsLeft}초 남음</strong>}</div>
    <section id="bet-options" className="bet-options" aria-label="베팅 금액 선택">
      <div className="bet-presets">
        <span>배팅 배율</span>
        {[[1, 4], [1, 3], [1, 2]].map(([n, d]) => <button type="button" key={d} disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(n / d); }}>{n}/{d} 팟</button>)}
        <button type="button" disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(1); }}>1 팟</button>
        <button type="button" disabled={busy || !myTurn || !canAllIn} onClick={() => { sound.chipClick(); setAmount(maximum); }}>올인</button>
      </div>
      <div className="sizing">
        <label htmlFor="bet-total">배팅 총액 (칩)<input id="bet-total" type="number" inputMode="numeric" step={1} min={minimum} max={maximum} value={amount} disabled={busy || !myTurn || !canSize} onChange={event => setAmount(Number(event.target.value))}/></label>
        <input aria-label="베팅 슬라이더" type="range" min={minimum} max={Math.max(minimum, maximum)} step={1} value={Number.isFinite(amount) ? Math.max(minimum, Math.min(maximum, amount)) : minimum} disabled={busy || !myTurn || !canSize} onChange={event => setAmount(Number(event.target.value))}/>
        <span className="sizing-readout">총 <strong>{money(amount)}</strong><small>(+{money(Math.max(0, amount - (me?.bet ?? 0)))})</small></span>
      </div>
    </section>
    <div className="controls action-buttons">
      <button type="button" className="danger" disabled={busy || !canFold} onClick={() => act('FOLD')}>FOLD · 폴드</button>
      {canCheck || (!canCall && toCall === 0)
        ? <button type="button" disabled={busy || !canCheck} onClick={() => act('CHECK')}>CHECK · 체크</button>
        : <button type="button" className="call-button" disabled={busy || !canCall} onClick={() => act('CALL')}>CALL · 콜 <strong>{money(toCall)}</strong></button>}
      <button type="button" className="primary" disabled={busy || !raiseAction || !valid} onClick={() => act(allIn ? 'ALL_IN' : raiseAction!, allIn ? undefined : amount)}>{raiseLabel} · {raiseLabel === 'BET' ? '베트' : '레이즈'} <strong>{money(amount)}</strong></button>
      <button type="button" className="primary allin-button" disabled={busy || !canAllIn} onClick={() => act('ALL_IN')}>ALL-IN · 올인 <strong>{money(me?.stack ?? 0)}</strong></button>
    </div>
  </div>;
}
