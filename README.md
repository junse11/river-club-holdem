# River Club — 친구용 바운티 홀덤

React/TypeScript + Java 21/Spring Boot. 현금 가치 없는 무료 칩 전용이다. 현재 버전은 **닉네임 세션 로그인으로 실제 2~6인 게임을 진행하는 단일 서버 MVP**다. 상대를 탈락시키면 바운티 1점을 획득하고, 7초 후 모두 100BB로 다음 핸드를 시작한다. 자세한 규칙은 [바운티 모드](docs/bounty-mode.md) 참조.

## 구현한 기능

- 서버 생성 사용자 ID, 닉네임 로그인, 세션 ID 교체, HttpOnly/SameSite 쿠키, CSRF 보호 POST, 로그아웃.
- 비공개 8자리 초대 코드, 선택 비밀번호 BCrypt 해시, 초대 링크, 시작 스택 100BB, 6좌석 자동 배정, 준비/방장 시작/퇴장/자동 방장 위임.
- 서버의 SecureRandom 셔플, 홀 카드, preflop/flop/turn/river, Fold/Check/Call/Bet/Raise/All-in, 최소 레이즈 및 short all-in 재오픈 검증.
- 7장 최상위 패 비교, 사이드팟·스플릿팟·uncalled bet 반환, 칩 보존, heads-up 순서, 2..6인 포지션, 버튼 회전, 30초 자동 체크/폴드, 7초 뒤 다음 핸드.
- 방장 블라인드 변경; 핸드 중 변경은 다음 핸드에 적용. 도중 참가자는 다음 핸드부터 참여.
- WebSocket/STOMP 본인 큐의 상태 변경 알림 + 인증된 REST 개인 스냅샷. 카드 정보는 WebSocket에 보내지 않는다. 방별 동기화, 버전 검증과 최근 1,000개 액션 ID 중복 방지.
- 2초 폴링 복구, 90초 접속 유예 후 자동 퇴장. 같은 세션으로 새로고침 시 자리 복구.
- 반응형 실제 테이블, 금액 입력/슬라이더, BB/원 표시, 핸드 종료 후 유저별 쇼다운(패 공개/숨기기) 선택, Web Audio 효과음(카드 딜링/액션/턴 알림/타이머/바운티 정산/쇼다운 오픈) 및 음소거 토글, 최근 50개 핸드 메모리 기록/팟별 정산 리뷰, 바운티 점수·순위판·탈락 알림.

## 실행 — Docker 없는 로컬 모드

친구 초대 링크는 방 화면에 표시되며 복사할 수 있다. 링크를 열면 초대 방 이름·인원·블라인드를 먼저 보고, 그 방에서 사용할 닉네임을 정해 참가한다. 별도 로그인 화면을 거치지 않는다. 방 비밀번호가 설정되어 있으면 입력 화면이 표시된다. 같은 네트워크에서 접근 가능한 PC 주소를 공유한다.

레이즈는 RAISE 버튼으로 금액 선택 패널을 연 뒤 1/4·1/3·1/2 팟, 올인 또는 직접 입력으로 선택하고 확정한다. 상대 레이즈에 대한 CALL은 별도 버튼이다. 금액은 서버 최소 레이즈와 스택 범위로 검증한다.

Node 20.19+ 또는 22.12+, JDK 21 필요. JAVA_HOME은 JDK 루트로 지정한다.

첫 터미널, 저장소 루트:

```powershell
cd apps/api
.\gradlew.bat bootRun --args='--spring.profiles.active=local'
```

둘째 터미널, 저장소 루트:

```powershell
npm ci
npm run dev -w apps/web -- --host 0.0.0.0 --port 5173
```

Vite가 출력하는 Network 주소(`http://PC의-LAN-IP:5173/`)로 같은 네트워크의 친구가 접속한다. 방장이 방을 만들고 코드를 공유한 뒤 각자 준비, 방장이 시작한다. 다른 사용자를 시험하려면 다른 기기/브라우저 프로필/시크릿 창을 사용한다. 같은 브라우저 세션의 두 탭은 같은 사용자다. localhost는 각 기기 자신을 뜻하므로 친구에게 공유하지 않는다.

**local 모드는 PostgreSQL/Redis 없이 서블릿 세션과 메모리 상태를 사용한다. 재시작 시 세션·게임·기록이 초기화된다.** 게임 서버는 한 프로세스로만 실행한다. 인터넷 원격 친구 접속용 HTTPS 호스팅은 아직 구성하지 않았다. LAN 접속은 OS 방화벽이 허용한 환경에서만 가능하다.

## Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

웹 localhost:3000, API localhost:8080, Swagger localhost:8080/swagger-ui/index.html. 현재 Compose의 API도 local 프로필이며 PostgreSQL/Redis는 기존 인프라 검증용이다. 기본 프로필에는 Redis Session/PostgreSQL/Flyway 설정이 남아 있지만 게임 및 사용자 이력을 DB에 영속화하지 않는다. 운영 배포로 간주하지 않는다.

## 검증

```powershell
npm run build
cd apps/api
.\gradlew.bat test bootJar
```

실제 실행 서버에 대한 독립 세션/WebSocket 스모크 테스트(임시 방 생성 및 종료):

```powershell
$env:SMOKE_ORIGIN='http://PC의-LAN-IP:5173'
node scripts/smoke.mjs
```

[실제 검증 기록](docs/verification.md). Docker Testcontainers 테스트는 Docker가 없으면 skip하므로 결과를 구분해서 확인한다.

## 남은 범위

OAuth는 이번 요청에 따라 보류했다. 공개 로비/검색/빠른 입장, 수동 좌석 선택, 방장 수동 위임·킥, 영속 핸드 기록과 전체 액션 리뷰, 재시작 복구/outbox/다중 서버, 인터넷 HTTPS 배포는 아직 구현하지 않았다. 현재 리뷰는 보드·팟별 지급 결과이며 홀 카드 장기 보관 기능은 없다. 전략 분석 기능은 제거했다.

## 구조 및 목표 설계

`apps/web` UI / `apps/api` auth·room·game·transport / `scripts` 실제 서버 검증 / `docs` 설계.

- [목표 아키텍처](docs/architecture.md)
- [목표 ERD](docs/database.md)
- [목표 API·이벤트](docs/api.md)
- [원래 단계별 계획](docs/plan.md)
- [현재 구현 API와 차이](docs/friends-mvp.md)

위 목표 설계의 DB/outbox/전략 및 named event 모델은 장기 계획이다. 이번 친구용 MVP는 아래 현행 계약을 따른다.
