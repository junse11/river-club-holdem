> 보관된 초기 설계입니다. GTO/전략 분석 계획은 폐기했으며 현행 바운티 규칙은 [bounty-mode.md](bounty-mode.md)를 따릅니다.

# 단계별 실행 계획 및 완료 조건

작은 변경마다 테스트하고 다음 단계로 진행한다. 초기 커밋은 Phase 1 기반이며 아래 기능을 구현했다고 간주하지 않는다.

| Phase | 구현 범위 | 완료 기준 / 필수 검증 |
|---|---|---|
| 1 | 모노레포, React/Vite/Tailwind/Query/Zustand, Spring Boot/Gradle, Compose, Flyway, Swagger, CI | frontend production build, security slice tests, real PG/Redis startup smoke |
| 2 | guest, local profile login, Google/Kakao, Redis session, CSRF, account link policy | session fixation, expiry, logout, OAuth success/failure/collision; provider flow uses configured credentials |
| 3 | PUBLIC/PRIVATE room, code/password, seat/ready, owner controls, quick join | unique code collision retry, buyin boundary, forbidden owner action, join concurrency |
| 4 | pure Java deck/ranking/betting/state machine/positions/settlement | all ranking categories/kickers/wheel, split/odd chips, main+side pot, all-in reopening, min raise, turn order, 2..6 positions, HU, chip conservation |
| 5 | authenticated STOMP, public/private projections, mailbox/version/dedup/outbox, timeout/reconnect | two independent sessions, hidden cards absent from others' frames, spoofing rejected, duplicate commands, stale turn, disconnect and expiry |
| 6 | lobby/waiting/table UI, 6 seats, action slider, responsive settings | two browsers complete real hand, refresh restores state, illegal actions blocked server-side |
| 7 | provider/repository/context, validated importer, 13x13 matrix, Study toggle | exact scenario matching, provenance/license required, sum=1±0.0001, illegal action rejection, NO_DATA, room study policy |
| 8 | persisted hand review and history, paging, privacy projections | payout replay, participant authorization, folded/opponent cards protected |
| 9 | Testcontainers integration, compose deployment, operational docs | full guest/OAuth→room→hand→settlement→review flow, restart/dedup recovery, PG/Redis failures, zero-sum checks |

Testcontainers는 실제 PostgreSQL/Redis에서 migration·세션·상태복구를 검증한다. OAuth 단위 테스트는 provider 응답 fixture로 수행하되 실제 Google/Kakao staging callback smoke는 별도 기록한다. GTO 데이터가 없다는 것은 정상 상태이며 임의 데이터로 테스트를 통과시키지 않는다.

## 운영 전 결정

- 도메인/TLS와 OAuth callback URI, credentials는 환경변수로 공급.
- 합법적 전략 데이터 라이선스 확보 후 import; 확보 전 NO_DATA.
- MVP 단일 API writer 제한을 배포 문서에 고정하고 다중 writer 전환은 별도 검증.
- 세션/방 코드 시도 rate limit, WS 메시지 크기/속도, 로그 개인정보 마스킹, 백업/복구는 Phase 9 release gate.
