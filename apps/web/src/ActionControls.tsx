import { useState } from 'react';
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
  const raiseAction = table.allowedActions.includes('RAISE') ? 'RAISE' : table.allowedActions.includes('BET') ? 'BET' : null;
  const raiseLabel = raiseAction ?? (table.currentBet === 0 ? 'BET' : 'RAISE');
  const canFold = table.allowedActions.includes('FOLD');
  const canCheck = table.allowedActions.includes('CHECK');
  const canCall = table.allowedActions.includes('CALL');
  const canAllIn = table.allowedActions.includes('ALL_IN');
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState(minimum);
  const allIn = amount === maximum && canAllIn;
  const valid = Number.isSafeInteger(amount) && amount <= maximum && (allIn || amount >= table.minRaiseTo);
  const selectFraction = (fraction: number) => {
    // Raise by a fraction of the pot after calling, expressed as street-total chips.
    const target = table.currentBet + Math.round((table.pot + toCall) * fraction);
    setAmount(Math.min(maximum, Math.max(table.minRaiseTo, target)));
  };

  return <div className={`actions ${table.allowedActions.length ? 'my-turn' : 'waiting-turn'}`}>
    <div className="action-status"><span>{table.allowedActions.length ? '● 내 차례 · 액션을 선택하세요' : '상대 플레이어의 액션 대기 중 (비활성)'}</span>{secondsLeft !== undefined && <strong role="timer" aria-label="액션 남은 시간">{secondsLeft}초 남음</strong>}</div>
    <div className="controls action-buttons">
      <button className="danger" disabled={busy || !canFold} onClick={() => act('FOLD')}>FOLD · 폴드</button>
      {canCheck || (!canCall && toCall === 0)
        ? <button disabled={busy || !canCheck} onClick={() => act('CHECK')}>CHECK · 체크</button>
        : <button className="call-button" disabled={busy || !canCall} onClick={() => act('CALL')}>CALL · 콜 {money(toCall)}</button>}
      <button className="primary" disabled={busy || !raiseAction} aria-expanded={expanded && !!raiseAction} aria-controls="bet-options" onClick={() => { sound.chipClick(); setExpanded(value => !value); }}>{raiseLabel} · {raiseLabel === 'BET' ? '베트' : '레이즈'}</button>
      <button className="primary" disabled={busy || !canAllIn} onClick={() => act('ALL_IN')}>ALL-IN · 올인 {money(me?.stack ?? 0)}</button>
    </div>
    {expanded && raiseAction && <section id="bet-options" className="bet-options" aria-label="베팅 금액 선택">
      <div className="bet-presets"><span>팟 비율</span>{[[1, 4], [1, 3], [1, 2]].map(([n, d]) => <button key={d} disabled={busy} onClick={() => { sound.chipClick(); selectFraction(n / d); }}>{n}/{d} 팟</button>)}{table.allowedActions.includes('ALL_IN') && <button disabled={busy} onClick={() => { sound.chipClick(); setAmount(maximum); }}>올인</button>}</div>
      <div className="sizing"><label htmlFor="bet-total">직접 입력 · 스트리트 베팅 총액 (칩)<input id="bet-total" type="number" inputMode="numeric" step={1} min={minimum} max={maximum} value={amount} disabled={busy} onChange={event => setAmount(Number(event.target.value))}/></label><input aria-label="베팅 슬라이더" type="range" min={minimum} max={maximum} step={1} value={Number.isFinite(amount) ? Math.max(minimum, Math.min(maximum, amount)) : minimum} disabled={busy} onChange={event => setAmount(Number(event.target.value))}/></div>
      <p className="bet-help">{table.currentBet > 0 ? '콜한 뒤 팟을 기준으로 레이즈합니다.' : '현재 팟을 기준으로 베팅합니다.'} 최소 금액보다 작으면 최소 금액을 적용합니다.</p>
      <div className="bet-confirm"><span>총액 <strong>{money(amount)}</strong> · 추가 투입 {money(Math.max(0, amount - (me?.bet ?? 0)))}</span><button className="primary" disabled={busy || !valid} onClick={() => act(allIn ? 'ALL_IN' : raiseAction, allIn ? undefined : amount)}>{allIn ? 'ALL-IN' : raiseAction} 확정 · {money(amount)}</button></div>
    </section>}
  </div>;
}
