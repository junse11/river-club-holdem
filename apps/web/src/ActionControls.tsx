import { useEffect, useState } from 'react';
import { sound } from './sound';

type Actor = { stack: number; bet: number };
type BettingState = { bb?: number; paused?: boolean; pot: number; currentBet: number; minRaiseTo: number; allowedActions: string[] };

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
  const myTurn = !table.paused && table.allowedActions.length > 0;
  const raiseAction = table.allowedActions.includes('RAISE') ? 'RAISE' : table.allowedActions.includes('BET') ? 'BET' : null;
  const raiseLabel = raiseAction ?? (table.currentBet === 0 ? 'BET' : 'RAISE');
  const canFold = table.allowedActions.includes('FOLD');
  const canCheck = table.allowedActions.includes('CHECK');
  const canCall = table.allowedActions.includes('CALL');
  const canAllIn = table.allowedActions.includes('ALL_IN');
  const canSize = Boolean(raiseAction || canAllIn);

  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(minimum);
  const [bbInput, setBbInput] = useState(() => String(Number((minimum / bb).toFixed(2))));

  const updateAmount = (chips: number) => {
    const clamped = Math.min(maximum, Math.max(minimum, Math.round(chips)));
    setAmount(clamped);
    setBbInput(String(Number((clamped / bb).toFixed(2))));
  };

  useEffect(() => {
    const initial = Math.min(maximum, Math.max(minimum, oneThirdPotTarget));
    setAmount(initial);
    setBbInput(String(Number((initial / bb).toFixed(2))));
  }, [minimum, maximum, oneThirdPotTarget, table.currentBet, bb]);

  useEffect(() => {
    if (!myTurn) {
      setRaiseOpen(false);
    }
  }, [myTurn]);

  const allIn = amount >= maximum && canAllIn;
  const valid = Number.isSafeInteger(amount) && amount <= maximum && (allIn || amount >= minimum);
  const stepUnit = Math.max(1, Math.round(bb / 2));
  const minBb = Number((minimum / bb).toFixed(2));
  const maxBb = Number((maximum / bb).toFixed(2));

  const selectFraction = (fraction: number) => {
    const target = table.currentBet + Math.max(1, Math.round((table.pot + toCall) * fraction));
    updateAmount(target);
  };

  const stepAmount = (delta: number) => {
    sound.chipClick();
    updateAmount((Number.isFinite(amount) ? amount : minimum) + delta);
  };

  const handleBbInputChange = (raw: string) => {
    setBbInput(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setAmount(Math.round(parsed * bb));
    }
  };

  const handleBbInputBlur = () => {
    updateAmount(Number.isFinite(amount) ? amount : minimum);
  };

  const bbDisplay = `${Number((amount / bb).toFixed(2))} BB`;
  const extraBet = Math.max(0, amount - (me?.bet ?? 0));

  return <div className={`actions ${myTurn ? 'my-turn' : 'waiting-turn'}`}>
    <div className="action-status">
      <span>
        {table.paused
          ? '⏸️ 게임 일시정지됨 · 방장이 재개할 때까지 대기 중'
          : myTurn
            ? '● 내 차례 · 액션을 선택하세요'
            : '상대 플레이어의 액션 대기 중 (비활성)'}
      </span>
      {secondsLeft !== undefined && (
        <strong role="timer" aria-label="액션 남은 시간">
          {table.paused ? `⏸️ ${secondsLeft}초 (정지)` : `${secondsLeft}초 남음`}
        </strong>
      )}
    </div>

    {/* PC (Desktop) Compact One-Screen Layout */}
    <div className="desktop-betting-ui">
      <section id="bet-options" className="bet-options pc-compact-betting" aria-label="베팅 금액 선택">
        <div className="bet-presets">
          <button type="button" disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(1 / 3); }}>1/3 팟</button>
          <button type="button" disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(1 / 2); }}>1/2 팟</button>
          <button type="button" disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(3 / 4); }}>3/4 팟</button>
          <button type="button" disabled={busy || !myTurn || !canSize} onClick={() => { sound.chipClick(); selectFraction(1); }}>1 팟</button>
          <button type="button" disabled={busy || !myTurn || !canAllIn} onClick={() => { sound.chipClick(); updateAmount(maximum); }}>올인</button>
        </div>
        <div className="sizing">
          <label htmlFor="bet-total-pc">
            배팅 총액 (BB)
            <div className="bb-input-wrap">
              <input
                id="bet-total-pc"
                type="number"
                inputMode="decimal"
                step={0.5}
                min={minBb}
                max={maxBb}
                value={bbInput}
                disabled={busy || !myTurn || !canSize}
                onChange={event => handleBbInputChange(event.target.value)}
                onBlur={handleBbInputBlur}
              />
              <span className="bb-unit-suffix">BB</span>
            </div>
          </label>
          <input
            aria-label="베팅 슬라이더"
            type="range"
            min={minimum}
            max={Math.max(minimum, maximum)}
            step={1}
            value={Number.isFinite(amount) ? Math.max(minimum, Math.min(maximum, amount)) : minimum}
            disabled={busy || !myTurn || !canSize}
            onChange={event => updateAmount(Number(event.target.value))}
          />
          <span className="pc-bet-summary">
            총 <strong>{bbDisplay}</strong> <small>(+{Number((extraBet / bb).toFixed(2))} BB)</small>
          </span>
        </div>
      </section>
      <div className="controls action-buttons">
        <button type="button" className="danger" disabled={busy || !myTurn || !canFold} onClick={() => act('FOLD')}>FOLD · 폴드</button>
        {canCheck || (!canCall && toCall === 0)
          ? <button type="button" disabled={busy || !myTurn || !canCheck} onClick={() => act('CHECK')}>CHECK · 체크</button>
          : <button type="button" className="call-button" disabled={busy || !myTurn || !canCall} onClick={() => act('CALL')}>CALL · 콜 {money(toCall)}</button>}
        <button
          type="button"
          className="primary"
          disabled={busy || !myTurn || !raiseAction || !valid}
          onClick={() => act(allIn ? 'ALL_IN' : raiseAction!, allIn ? undefined : amount)}
        >
          {raiseLabel} · {raiseLabel === 'BET' ? '베트' : '레이즈'} {bbDisplay}
        </button>
        <button type="button" className="primary" disabled={busy || !myTurn || !canAllIn} onClick={() => act('ALL_IN')}>
          ALL-IN · 올인 {money(me?.stack ?? 0)}
        </button>
      </div>
    </div>

    {/* Mobile Only Layout (Image 3 -> Image 2) */}
    <div className="mobile-betting-ui">
      {raiseOpen && myTurn ? (
        <section className="pn-raise-panel" aria-label="레이즈 금액 설정">
          <div className="pn-your-bet-card">
            <span className="pn-your-bet-label">Your bet (BB)</span>
            <div className="pn-your-bet-box">
              <small className="pn-bb-tag">BB</small>
              <input
                id="bet-total"
                aria-label="배팅 총액 (BB)"
                type="number"
                inputMode="decimal"
                min={minBb}
                max={maxBb}
                step={0.5}
                value={bbInput}
                disabled={busy}
                onChange={e => handleBbInputChange(e.target.value)}
                onBlur={handleBbInputBlur}
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
                <button type="button" disabled={busy || !canAllIn} onClick={() => { sound.chipClick(); updateAmount(maximum); }}>ALL IN</button>
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
                  onChange={e => updateAmount(Number(e.target.value))}
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
                {allIn ? 'ALL IN' : `${raiseLabel} ${bbDisplay}`}
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
