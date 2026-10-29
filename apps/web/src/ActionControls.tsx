import { useEffect, useState } from 'react';
import { sound } from './sound';

type Actor = { stack: number; bet: number };
type BettingState = { bb?: number; pot: number; currentBet: number; minRaiseTo: number; allowedActions: string[] };

export function ActionControls({ table, me, money, busy, act, secondsLeft }: {
  table: BettingState; me?: Actor; money: (chips: number) => string;
  busy: boolean; act: (action: string, amountTo?: number) => void;
  secondsLeft?: number;
}) {
  const bb = table.bb ?? 100;
  const maximum = (me?.stack ?? 0) + (me?.bet ?? 0);
  const toCall = Math.min(Math.max(0, table.currentBet - (me?.bet ?? 0)), me?.stack ?? 0);
  const oneThirdPotTarget = table.currentBet + Math.max(1, Math.round((table.pot + toCall) / 3));
  const minimum = Math.min(Math.min(table.minRaiseTo, oneThirdPotTarget), maximum);
  const myTurn = table.allowedActions.length > 0;
  const raiseAction = table.allowedActions.includes('RAISE') ? 'RAISE' : table.allowedActions.includes('BET') ? 'BET' : null;
  const raiseLabel = raiseAction ?? (table.currentBet === 0 ? 'BET' : 'RAISE');
  const canFold = table.allowedActions.includes('FOLD');
  const canCheck = table.allowedActions.includes('CHECK');
  const canCall = table.allowedActions.includes('CALL');
  const canAllIn = table.allowedActions.includes('ALL_IN');
  const canSize = Boolean(raiseAction || canAllIn);

  const [expanded, setExpanded] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(minimum);

  useEffect(() => {
    setAmount(Math.min(maximum, Math.max(minimum, oneThirdPotTarget)));
  }, [minimum, maximum, oneThirdPotTarget, table.currentBet]);

  useEffect(() => {
    if (!myTurn) {
      setRaiseOpen(false);
      setExpanded(false);
    }
  }, [myTurn]);

  const allIn = amount >= maximum && canAllIn;
  const valid = Number.isSafeInteger(amount) && amount <= maximum && (allIn || amount >= minimum);
  const stepUnit = Math.max(1, Math.round(bb / 2));

  const selectFraction = (fraction: number) => {
    const target = table.currentBet + Math.max(1, Math.round((table.pot + toCall) * fraction));
    setAmount(Math.min(maximum, Math.max(minimum, target)));
  };

  const stepAmount = (delta: number) => {
    sound.chipClick();
    setAmount(prev => Math.min(maximum, Math.max(minimum, (Number.isFinite(prev) ? prev : minimum) + delta)));
  };

  const bbDisplay = `${Number((amount / bb).toFixed(2))}BB`;

  return <div className={`actions ${myTurn ? 'my-turn' : 'waiting-turn'}`}>
    <div className="action-status">
      <span>{myTurn ? '● 내 차례 · 액션을 선택하세요' : '상대 플레이어의 액션 대기 중 (비활성)'}</span>
      {secondsLeft !== undefined && <strong role="timer" aria-label="액션 남은 시간">{secondsLeft}초 남음</strong>}
    </div>

    {/* PC (Desktop) Original Layout */}
    <div className="desktop-betting-ui">
      <div className="controls action-buttons">
        <button type="button" className="danger" disabled={busy || !canFold} onClick={() => act('FOLD')}>FOLD · 폴드</button>
        {canCheck || (!canCall && toCall === 0)
          ? <button type="button" disabled={busy || !canCheck} onClick={() => act('CHECK')}>CHECK · 체크</button>
          : <button type="button" className="call-button" disabled={busy || !canCall} onClick={() => act('CALL')}>CALL · 콜 {money(toCall)}</button>}
        <button type="button" className="primary" disabled={busy || !raiseAction} aria-expanded={expanded && !!raiseAction} aria-controls="bet-options" onClick={() => { sound.chipClick(); setExpanded(value => !value); }}>{raiseLabel} · {raiseLabel === 'BET' ? '베트' : '레이즈'}</button>
        <button type="button" className="primary" disabled={busy || !canAllIn} onClick={() => act('ALL_IN')}>ALL-IN · 올인 {money(me?.stack ?? 0)}</button>
      </div>
      {expanded && raiseAction && <section id="bet-options" className="bet-options" aria-label="베팅 금액 선택">
        <div className="bet-presets"><span>팟 비율</span>{[[1, 3], [1, 2], [3, 4], [1, 1]].map(([n, d]) => <button type="button" key={`${n}-${d}`} disabled={busy} onClick={() => { sound.chipClick(); selectFraction(n / d); }}>{n === 1 && d === 1 ? '1 팟' : `${n}/${d} 팟`}</button>)}{canAllIn && <button type="button" disabled={busy} onClick={() => { sound.chipClick(); setAmount(maximum); }}>올인</button>}</div>
        <div className="sizing"><label htmlFor="bet-total-pc">직접 입력 · 스트리트 베팅 총액 (칩)<input id="bet-total-pc" type="number" inputMode="numeric" step={1} min={minimum} max={maximum} value={amount} disabled={busy} onChange={event => setAmount(Number(event.target.value))}/></label><input aria-label="베팅 슬라이더" type="range" min={minimum} max={Math.max(minimum, maximum)} step={1} value={Number.isFinite(amount) ? Math.max(minimum, Math.min(maximum, amount)) : minimum} disabled={busy} onChange={event => setAmount(Number(event.target.value))}/></div>
        <p className="bet-help">{table.currentBet > 0 ? '콜한 뒤 팟을 기준으로 레이즈합니다.' : '현재 팟을 기준으로 베팅합니다.'} 최소 금액(1/3 팟)보다 작으면 최소 금액을 적용합니다.</p>
        <div className="bet-confirm"><span>총액 <strong>{money(amount)}</strong> · 추가 투입 {money(Math.max(0, amount - (me?.bet ?? 0)))}</span><button type="button" className="primary" disabled={busy || !valid} onClick={() => act(allIn ? 'ALL_IN' : raiseAction, allIn ? undefined : amount)}>{allIn ? 'ALL-IN' : raiseAction} 확정 · {money(amount)}</button></div>
      </section>}
    </div>

    {/* Mobile Only Layout (Image 3 -> Image 2) */}
    <div className="mobile-betting-ui">
      {raiseOpen && myTurn ? (
        <section className="pn-raise-panel" aria-label="레이즈 금액 설정">
          <div className="pn-your-bet-card">
            <span className="pn-your-bet-label">Your bet</span>
            <div className="pn-your-bet-box">
              <small className="pn-bb-tag">{bbDisplay}</small>
              <input
                id="bet-total"
                aria-label="배팅 총액"
                type="number"
                inputMode="numeric"
                min={minimum}
                max={maximum}
                step={1}
                value={amount}
                disabled={busy}
                onChange={e => setAmount(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="pn-raise-bottom">
            <div className="pn-sizing-panel">
              <div className="pn-presets-row">
                <button type="button" disabled={busy} onClick={() => { sound.chipClick(); selectFraction(1 / 3); }}>1/3 POT</button>
                <button type="button" disabled={busy} onClick={() => { sound.chipClick(); selectFraction(1 / 2); }}>1/2 POT</button>
                <button type="button" disabled={busy} onClick={() => { sound.chipClick(); selectFraction(3 / 4); }}>3/4 POT</button>
                <button type="button" disabled={busy} onClick={() => { sound.chipClick(); selectFraction(1); }}>POT</button>
                <button type="button" disabled={busy || !canAllIn} onClick={() => { sound.chipClick(); setAmount(maximum); }}>ALL IN</button>
              </div>
              <div className="pn-slider-row">
                <button type="button" className="pn-step-btn" aria-label="배팅 감액" disabled={busy || amount <= minimum} onClick={() => stepAmount(-stepUnit)}>−</button>
                <input
                  aria-label="베팅 슬라이더"
                  className="pn-slider"
                  type="range"
                  min={minimum}
                  max={Math.max(minimum, maximum)}
                  step={1}
                  value={Number.isFinite(amount) ? Math.max(minimum, Math.min(maximum, amount)) : minimum}
                  disabled={busy}
                  onChange={e => setAmount(Number(e.target.value))}
                />
                <button type="button" className="pn-step-btn" aria-label="배팅 증액" disabled={busy || amount >= maximum} onClick={() => stepAmount(stepUnit)}>+</button>
              </div>
            </div>

            <div className="pn-raise-actions">
              <button type="button" className="pn-back-btn" disabled={busy} onClick={() => setRaiseOpen(false)}>BACK</button>
              <button
                type="button"
                className="pn-confirm-btn"
                disabled={busy || !valid}
                onClick={() => {
                  setRaiseOpen(false);
                  act(allIn ? 'ALL_IN' : (raiseAction ?? 'RAISE'), allIn ? undefined : amount);
                }}
              >
                {allIn ? 'ALL IN' : raiseLabel}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="pn-action-bar" role="group" aria-label="배팅 액션 버튼">
          <button
            type="button"
            className="pn-btn pn-call"
            disabled={busy || !myTurn || !canCall}
            onClick={() => act('CALL')}
          >
            CALL{toCall > 0 ? ` ${money(toCall)}` : ''}
          </button>
          <button
            type="button"
            className="pn-btn pn-raise"
            disabled={busy || !myTurn || !canSize}
            onClick={() => {
              sound.chipClick();
              if (raiseAction) setRaiseOpen(true);
              else if (canAllIn) act('ALL_IN');
            }}
          >
            {raiseAction ? raiseLabel : canAllIn ? 'ALL IN' : 'RAISE'}
          </button>
          <button
            type="button"
            className="pn-btn pn-check"
            disabled={busy || !myTurn || !canCheck}
            onClick={() => act('CHECK')}
          >
            CHECK
          </button>
          <button
            type="button"
            className="pn-btn pn-fold"
            disabled={busy || !myTurn || !canFold}
            onClick={() => act('FOLD')}
          >
            FOLD
          </button>
        </div>
      )}
    </div>
  </div>;
}
