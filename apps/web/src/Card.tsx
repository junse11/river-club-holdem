const faces: Record<string, string> = { '14': 'A', '13': 'K', '12': 'Q', '11': 'J' };
const suits: Record<string, string> = { S: '♠', C: '♣', D: '♦', H: '♥' };
export function Card({ value }: { value?: string }) {
  if (!value) return <span className="card back" aria-label="비공개 카드"><small>POKER NOW</small></span>;
  const suit = value.slice(-1), rank = value.slice(0, -1);
  return <span className={`card ${'DH'.includes(suit) ? 'red' : 'black'}`} aria-label={`${faces[rank] ?? rank}${suits[suit]}`}><span>{faces[rank] ?? rank}</span><em>{suits[suit]}</em></span>;
}

/** 딜러가 깔듯 뒷면으로 미끄러져 들어온 뒤 뒤집히는 보드 카드. animate=false면 즉시 앞면. */
export function BoardCard({ value, animate, slideAt = 0, flipAt = 0 }: { value: string; animate: boolean; slideAt?: number; flipAt?: number }) {
  if (!animate) return <Card value={value} />;
  const style = { ['--slide-at' as string]: `${slideAt}ms`, ['--flip-at' as string]: `${flipAt}ms` } as React.CSSProperties;
  return <span className="board-card dealing" style={style}>
    <span className="board-card-inner">
      <span className="board-card-face board-card-back"><Card /></span>
      <span className="board-card-face board-card-front"><Card value={value} /></span>
    </span>
  </span>;
}
