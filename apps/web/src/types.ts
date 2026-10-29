export type User = { id: string; nickname: string };
export type Player = User & { seat: number; stack: number; bounty: number; bountyUnits: number; bet: number; ready: boolean; folded: boolean; showdown?: boolean; position: string; cards: string[]; cardCount: number };
export type BountyAward = { victimId: string; victimNickname: string; recipients: { id: string; nickname: string; units: number; amount: number }[] };
export type Table = { code: string; name: string; host: string; version: number; hand: number; street: string; board: string[]; sb: number; bb: number; currentBet: number; minRaiseTo: number; pot: number; actor: number; deadline: number; result: string; resetPending: boolean; bountyAwards: BountyAward[]; players: Player[]; allowedActions: string[]; pendingBlinds: number[]; log: { nickname: string; action: string; amountTo: number }[] };
export type Review = { bounties: BountyAward[]; resetToBb: number; hand: number; board: string[]; payouts: { nickname: string; amount: number; rank: string }[] };
export type InvitationInfo = { code: string; name: string; playerCount: number; capacity: number; sb: number; bb: number; passwordRequired: boolean; running: boolean };
