const faces: Record<string, string> = { '14': 'A', '13': 'K', '12': 'Q', '11': 'J' };
const suits: Record<string, string> = { S: '♠', C: '♣', D: '♦', H: '♥' };
export function Card({ value }: { value?: string }) {
  if (!value) return <span className="card back" aria-label="비공개 카드">♠</span>;
  const suit = value.slice(-1), rank = value.slice(0, -1);
  return <span className={`card ${'DH'.includes(suit) ? 'red' : ''}`} aria-label={`${faces[rank] ?? rank}${suits[suit]}`}><span>{faces[rank] ?? rank}</span><em>{suits[suit]}</em></span>;
}
