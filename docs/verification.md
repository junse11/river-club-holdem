# 검증 기록 — 2026-10-29

## 초대 방 닉네임·전체 UI 겹침 점검 (최신)

- 초대 링크는 로그인 전 방 미리보기와 방별 닉네임 폼을 보여 준다. 익명 미리보기 API는 방 이름/코드/인원/블라인드/비밀번호 필요 여부/진행 여부만 응답한다. 플레이어 ID·닉네임·카드·잔고·비밀번호는 노출하지 않는다.
- 실제 Chrome 세션에서 초대 링크 열기 → 방 이름/5명 표시 → 방 안 닉네임 설정 → 비밀번호 오류 → 입력을 유지한 채 재시도 → 6번째 좌석 참가를 검증했다. 사용자 신원은 계속 서버 세션에서 결정한다.
- 카드/좌석을 CSS grid의 별도 행으로 배치하고 음수 여백·테이블 중앙 타이머·떠 있는 좌석 베팅액을 제거했다. 타이머는 별도 상단 상태 영역과 액션 줄에 표시한다. 스크롤 고정 오버레이로 다른 좌석을 덮지 않는다.
- 실제 6인 테이블에서 긴 닉네임, RIVER의 5장 보드, 내 카드, 펼친 베팅 패널을 검증했다. 1440px 데스크톱과 375px/320px 모바일 viewport에서 document.scrollWidth가 clientWidth를 초과하지 않았다. 브라우저 DOM bounding rectangle 검사에서 좌석끼리, 타이머-좌석, 보드-내 카드가 겹치지 않았다. 데스크톱 타이머는 모든 카드보다 위에 있었다.
- 스크린샷: `in-room-nickname.png`, `in-room-nickname-mobile.png`, `ui-audit-desktop.png`, `ui-audit-mobile.png`, `ui-audit-320.png`. 모바일은 브라우저 viewport 검사이며 모바일 실기기 테스트를 뜻하지 않는다.
- 점검 중 실제 서버 로그에서 딜러 퇴장 후 position 조회의 NoSuchElementException을 발견했다. 포지션을 핸드 시작 시 보관하도록 수정하고, 딜러 퇴장/방장 위임/새 참가자 합류 후 화면 조회 회귀 테스트를 추가했다.
- `gradlew.bat test bootJar` 29개 통과: 보안 4, 인증/방/초대 4, 엔진 13, 바운티 7, 인프라 1. 실패/skip 0. 프론트엔드 TypeScript/Vite build 통과.
- 만료된 방에서 로그아웃이 막히던 오류, 무한 연결 중 표기, 긴 닉네임 넘침, 작은 화면의 베팅 입력/버튼 배치, 꽉 찬 방의 기존 사용자 재접속 차단도 보완했다. 임의의 모든 기기/브라우저에서 모든 UI 오류가 없음을 증명하는 검증은 아니다.

## 카드·베팅 UI·초대 링크 개선 (최신)

- 본인 홀 카드 66×94, 공용 카드 64×92로 확대했다. 모바일은 각각 50×72, 44×65다. 본인 좌석은 항상 화면 아래로 회전 표시한다.
- RAISE/BET를 누르면 팟 1/4·1/3·1/2·올인·직접 입력/슬라이더·확정 버튼을 보여 준다. CALL은 패널과 독립적으로 표시한다. 레이즈 프리셋은 콜 후 팟 기준 추가 레이즈를 계산하며 서버 최소 레이즈와 잔여 스택으로 제한한다. 직접 입력은 정수 칩 단위이며 BB/원 전환은 표시만 바꾼다.
- 실제 Chrome 새 세션에서 `?join=방코드` 링크 → 닉네임 로그인 → 별도 코드 입력 없이 자동 참가를 확인했다. 서버가 발급한 초대 방 이름과 두 좌석이 표시되고 URL의 join 파라미터가 제거됐다.
- 독립 호스트 세션이 2BB RAISE → 브라우저에서 CALL 1BB 버튼 및 RAISE 패널 확인 → 1/2 팟 선택으로 총 4BB 계산 → RAISE 확정 → 호스트 CALL → FLOP 확인. 실제 팟 8BB, 양쪽 스택 96BB가 서버 로그와 화면에서 일치했다.
- 실제 플랍 화면에서 커진 본인/공용 카드, BET 패널 및 초대 링크 상시 표시를 시각 검증했다. 스크린샷 `raise-panel.png`, `cards-and-betting.png`.
- 이 변경은 프론트엔드 전용이다. TypeScript 및 Vite 프로덕션 빌드를 검증했고 기존 서버 게임 로직은 변경하지 않았다. 모바일 크기는 반응형 CSS로 반영했으며 이번 검증은 데스크톱 브라우저에서 수행했다.

## 바운티 모드 (최신)

- GTO/Study 버튼·패널·참고 자료 링크 및 서버 전략 필드를 제거했다. 아래 친구 MVP 기록의 전략 관련 설명은 과거 상태다.
- `npm run build` 성공. `gradlew.bat test bootJar` 26개 통과, 실패/skip 0 (바운티 7, 기존 엔진 12, 인증/방 2, 보안 4, PostgreSQL/Redis 1).
- `scripts/bounty-smoke.mjs`: 실제 두 세션 올인/콜 KO, 바운티 1점 한 번 지급, 중복 명령, 7초 후 전원 100BB 자동 리셋, 점수 유지, 전략 응답 필드 제거 확인.
- `scripts/smoke.mjs`: 비밀번호 방·개인 카드·STOMP 이벤트 및 재접속·정산·로그아웃 회귀 통과. 시작 스택은 고정 100BB로 검증했다.
- 실제 브라우저에서 고정 100BB 안내, 100BB로 방 생성, 좌석별 바운티 점수 및 순위판, GTO 메뉴 제거, LIVE 연결 확인. `bounty-table.png`로 화면 저장 및 시각 확인했다.
- 현재 실행 서버는 바운티 모드 local 프로필이다. 재시작 시 메모리 점수/세션/기록이 초기화되는 제한은 동일하다.

## 친구 게임 MVP (최신)

- `npm run build`: TypeScript 및 프로덕션 번들 성공.
- `gradlew.bat test bootJar`: 보안 MVC 4개, 로그인/방 통합 2개, 엔진 12개, 실제 PostgreSQL/Redis Testcontainers 1개 통과. 이번 실행에서는 Docker가 실행 가능해 인프라 테스트도 skip 없이 통과했다.
- 엔진 테스트에는 100개의 고정 seed 무작위 합법 액션 핸드(2..6명)의 칩 보존, 모든 패 category/wheel, 헤즈업, short all-in reopening, main/side pot별 지급, uncalled 반환, 스플릿팟, 권한/바이인, 타임아웃이 포함된다.
- `SMOKE_ORIGIN=http://192.168.0.3:5173 node scripts/smoke.mjs`: 실제 HTTP 세션 두 개, CSRF, 방 비밀번호, 본인 카드 분리, STOMP 개인 알림/연결 재접속, 액션 턴 검증/중복 제거, 폴드 정산, 기록, 로그아웃 전체 성공.
- 실제 브라우저: LAN 주소로 닉네임 로그인, 방 생성, 준비, 시작, 홀 카드 2장 및 상대 카드 뒷면, 폴드 버튼의 서버 액션 성공, SETTLED 및 핸드 리뷰 확인. 실제 HTTP LAN에서 secure-context에 의존하지 않는 액션 UUID 생성 경로도 검증했다.
- 화면 스크린샷 `friends-table.png`: 테이블 CSS class와 Tailwind utility 충돌을 고친 후 확인. 브라우저 레이아웃 확인은 데스크톱 크기이며 모바일 실기기 검증은 하지 않았다.
- 현재 PC의 브라우저 자동화에서는 127.0.0.1:5173 연결이 timeout됐지만 Vite 출력의 LAN 주소는 정상 동작했다. 친구 접속 안내에는 LAN 주소를 사용한다.
- 인터넷 원격 배포, 재시작 복구, 외부 OAuth, 영속 기록, 검증된 GTO 데이터는 구현 및 검증 대상에서 제외되어 있다. 현행 범위는 README 참조.

## Phase 1 당시 기록 (과거)

환경: Windows, Node 20.19.5, Eclipse Adoptium Java 21.0.5, Gradle Wrapper 8.14.3.

| 항목 | 결과 |
|---|---|
| npm install | 성공, audit 0 vulnerabilities |
| npm run build | TypeScript 및 Vite production bundle 성공 |
| gradlew.bat test bootJar | 성공; 보안 MVC 테스트 4개 통과 |
| InfrastructureIntegrationTest | Docker engine 부재로 1개 skip; PostgreSQL/Redis 실제 연동 미검증 |
| docker compose --env-file .env.example config --quiet | 성공 |
| git diff --check | 성공 |
| 브라우저 시각 검증 | 미실행; 로컬 HTTP 접근 제한으로 화면 렌더링 확인 못함 |
| 실제 멀티플레이 / OAuth / 게임 규칙 / GTO | 아직 구현 전, 검증 결과 없음 |

JAVA_HOME의 기존 값이 존재하지 않는 경로여서 테스트 프로세스에만 설치된 JDK 루트를 지정했다. Windows 한글 경로의 Gradle worker 인자 파일 디코딩 오류는 gradle.properties의 `file.encoding=COMPAT`으로 해결했다. Java 소스 컴파일 인코딩은 UTF-8로 별도 지정했다.

CI에는 Linux에서 frontend build와 backend test/bootJar를 실행하도록 구성했다. 워크플로 실행 결과는 아직 없다. Docker 실행 가능한 환경에서 통합 테스트와 Compose 전체 기동을 통과해야 Phase 1 통합 검증을 완료할 수 있다.
