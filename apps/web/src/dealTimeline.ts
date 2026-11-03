// 보드 카드 딜 연출 타임라인. 화면 애니메이션과 효과음이 같은 상수를 공유한다.
export const DEAL = {
  slideGap: 130,
  slideDuration: 280,
  flopFlipStart: 650,
  flipGap: 180,
  turnFlip: 600,
  riverFlip: 800,
} as const;

export type BoardDealStep = { index: number; slideAt: number; flipAt: number };

/** 새로 공개된 카드(prevLen..nextLen-1)의 슬라이드/플립 시작 시각(ms)을 계산한다. */
export function boardTimeline(prevLen: number, nextLen: number): BoardDealStep[] {
  const steps: BoardDealStep[] = [];
  const count = nextLen - prevLen;
  if (count <= 0) return steps;
  const isFlop = prevLen === 0 && count >= 3;
  for (let i = 0; i < count; i++) {
    const index = prevLen + i;
    if (isFlop) {
      steps.push({ index, slideAt: i * DEAL.slideGap, flipAt: DEAL.flopFlipStart + i * DEAL.flipGap });
    } else {
      const flipBase = nextLen >= 5 ? DEAL.riverFlip : DEAL.turnFlip;
      steps.push({ index, slideAt: i * DEAL.slideGap, flipAt: flipBase + i * DEAL.flipGap });
    }
  }
  return steps;
}
