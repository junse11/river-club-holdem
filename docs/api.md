> 보관된 초기 설계입니다. GTO/전략 분석 계획은 폐기했으며 현행 바운티 규칙은 [bounty-mode.md](bounty-mode.md)를 따릅니다.

# REST / WebSocket 계약

현재 친구용 MVP의 실제 API·WS 계약은 [friends-mvp.md](friends-mvp.md)를 참조한다. 아래 `/api/v1`와 named events는 목표 설계 계약이며 현재 구현 경로와 다르다.

## REST v1 (후속 구현)

JSON `/api/v1`; 쿠키 세션; 변경 요청은 `/api/auth/csrf`의 headerName/token 사용. CSRF bootstrap은 인증 전 허용한다. 에러는 application/problem+json, code, traceId, fieldErrors를 포함하며 카드·세션 토큰을 노출하지 않는다. 400 입력 오류, 401 만료, 403 권한/CSRF, 404 비공개 리소스, 409 version/상태 충돌, 422 액션 불가, 429 rate limit.

| Method / route | 입력 / 응답 / 권한 |
|---|---|
| POST /auth/guest | nickname? → server-created user + session, CSRF required |
| POST /auth/local | local profile only; generated development identity |
| GET /auth/me | current user, session expiration; no provider tokens |
| GET /oauth2/authorization/{google,kakao} | Spring authorization redirect, OAuth state tied to session |
| GET /login/oauth2/code/{provider} | provider callback, validated server-side |
| POST /rooms | name, visibility, password?, sb, bb, min/maxBuyin, studyAllowed → room; creator host |
| GET /rooms | q, bbMin, bbMax, hasSeat, cursor, limit<=50; PUBLIC only |
| POST /rooms/quick-join | buyin, blind range → joins one matching room atomically; full race retries bounded |
| POST /rooms/join-by-code | code, password?, buyin; rate limited |
| GET /rooms/{id} | membership required for private; public metadata excludes passwords/cards |
| POST /rooms/{id}/join | password?, buyin; validated stack allocation once |
| POST /rooms/{id}/seat | seat 0..5, expectedVersion; membership required |
| PATCH /rooms/{id}/ready | ready, expectedVersion; member only |
| PATCH /rooms/{id}/settings | sb, bb, buyin, studyAllowed, expectedVersion; host only; pending blinds in-hand |
| POST /rooms/{id}/start | commandId, expectedVersion; host, ready>=2 |
| POST /rooms/{id}/leave | commandId; member; safe fold/settlement |
| POST /rooms/{id}/host | targetMemberId; host only |
| DELETE /rooms/{id}/members/{memberId} | host, waiting member only |
| GET /rooms/{id}/snapshot | own cards + public table, version, deadline, allowedActions; member only |
| GET /hands | cursor; own hands only |
| GET /hands/{id} | participant only; own cards + showdown reveals |
| GET /hands/{id}/strategy | review context reconstructed by server; settled own hand only |
| GET /rooms/{id}/strategy | current own turn context reconstructed by server, Study allowed |
| GET /strategies/preflop/range | position, stackBB, scenarioId; exact applicable dataset only |

OAuth redirect routes are Spring standard endpoints outside /api/v1; nginx must forward these when Phase 2 implements login. Logout stays `/api/auth/logout`.

## STOMP

Native WebSocket `/ws` same-origin. CONNECT carries CSRF header, authenticated session cookie supplies Principal. Allowed origins configured explicitly. Subscribe interceptor checks current membership and session; user destination uses server Principal UUID. Broker `/topic` is receive-only to clients.

Client SEND `/app/rooms/{id}/actions`:

```json
{"commandId":"uuid","handId":"uuid","expectedVersion":42,"action":"RAISE","amountTo":600}
```

FOLD/CHECK omit amountTo. CALL/ALL_IN amounts are server-computed. BET/RAISE require integer amountTo. A command must come from the current actor; message payload cannot override identity. Heartbeat 10s, reconnect exponential backoff 1..30s plus jitter, no blind replay of actions after reconnect: retrieve command result and current snapshot first.

Public `/topic/rooms/{id}` envelope:

```json
{"eventId":"uuid","roomId":"uuid","handId":"uuid","version":43,"type":"PLAYER_ACTION","occurredAt":"2026-10-29T10:00:00Z","payload":{"seat":2,"action":"RAISE","amountTo":600}}
```

| Event | Public payload |
|---|---|
| PLAYER_JOINED / PLAYER_LEFT | member public ID, nickname, seat, stack |
| PLAYER_READY | seat, ready |
| GAME_STARTED / HAND_STARTED | handId, button, positions, blinds, stack snapshots |
| PLAYER_TURN | actorSeat, deadline; no own-hole detail |
| PLAYER_ACTION | actorSeat, action, amountTo, delta |
| POT_UPDATED | pots/eligibleSeats, total |
| COMMUNITY_CARDS_DEALT | street, board |
| SHOWDOWN | only non-folded required revealed cards, rankings |
| HAND_RESULT | per-pot winners/payouts, final stacks |
| BLINDS_UPDATED | effective hand, blinds, pending flag |
| PLAYER_DISCONNECTED / PLAYER_RECONNECTED | seat, graceDeadline |

Private `/user/queue/game`: CARDS_DEALT(own holeCards), ACTION_ACK(commandId,version), ACTION_REJECTED(commandId,code), TURN_OPTIONS(allowedActions,minRaiseTo,maxAmountTo,toCall), SNAPSHOT(own view). Never publish a single all-player payload then filter in JavaScript. Snapshot and history use separate DTOs which cannot contain opponent unrevealed cards/deck.
