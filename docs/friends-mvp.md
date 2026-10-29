# 친구 MVP 현행 계약

초대 링크는 익명 GET `/api/invitations/{code}`로 방 입장에 필요한 메타데이터만 표시한다. 초대 방 안에서 nickname/password를 입력한 뒤 필요한 경우 guest 세션을 만들고 POST `/api/rooms/{code}/join`으로 참가한다. join의 선택적 nickname은 해당 방에서 쓸 별칭이며 사용자 ID는 세션에서만 얻는다. 일반 /auth/me의 계정 닉네임을 덮어쓰지 않는다. 자세한 UI 검증은 verification.md 참조.

## HTTP

인증: GET `/api/auth/csrf`가 반환하는 headerName/token을 모든 변경 요청에 포함. POST `/api/auth/guest` `{nickname}`로 서버가 UUID를 발급하고 세션에 SecurityContext를 저장한다. GET `/api/auth/me`, POST `/api/auth/logout` 제공. 사용자는 입력으로 ID를 지정할 수 없다.

| Route | Body / response |
|---|---|
| POST /api/rooms | name,password? → 개인 스냅샷 |
| POST /api/rooms/{code}/join | password? → 개인 스냅샷 |
| GET /api/rooms/{code} | 인증된 멤버 개인 스냅샷, presence 갱신 |
| POST /api/rooms/{code}/ready | ready |
| POST /api/rooms/{code}/showdown | showdown (SETTLED 상태에서 본인 홀 카드 공개/숨기기 선택) |
| POST /api/rooms/{code}/start | 방장만, 두 명 이상 및 유효 스택 전원 ready |
| POST /api/rooms/{code}/blinds | sb,bb; 방장만, 진행 중에는 pending |
| POST /api/rooms/{code}/actions | commandId(UUID),hand,version,action,amountTo? |
| POST /api/rooms/{code}/leave | 핸드 중이면 fold 후 정산 경계에서 제거 |
| GET /api/rooms/{code}/history | 최근 50개 보드·액션·팟 지급 기록, 개인 홀 카드 제외 |

amountTo는 해당 스트리트 누적 베팅 총액. CALL/ALL_IN 금액은 서버가 결정한다. 같은 commandId를 다른 payload로 재사용하면 거부한다. 버전 불일치·잘못된 차례·권한·입력은 400과 message로 반환한다. 로그인 만료는 401, CSRF 위반은 403이다. HTTP 폴링은 만료 시 다시 로그인 화면으로 전환한다.

## WS

`/ws` native STOMP, 인증 세션 쿠키 + 기본 동일 origin 검증. `/user/queue/updates`만 구독 가능. payload `{code,version}`는 본인이 속한 방의 변경 알림이다. 알림을 받은 UI가 REST 개인 스냅샷을 조회한다. 다른 사용자 ID를 구독할 수 없으며 클라이언트 SEND는 전부 거부한다. 모든 변경 명령은 CSRF 보호 REST로만 수락한다. 연결 유실에는 3초 재접속 및 2초 폴링 복구를 사용한다.

공개 덱/전체 홀 카드 DTO는 없다. 본인의 패와 정산 후 공개 가능한 non-folded showdown 패만 스냅샷에 포함한다. WS에는 카드 자체가 없다. 사용자 세션이 만료된 연결도 변경 알림만 받을 수 있으며 개인 데이터 조회 및 모든 변경은 HTTP 인증을 다시 거쳐야 한다.

## 실행/상태

local: Servlet HttpSession 30분, SESSION HttpOnly/SameSite=Lax, HTTP 개발용 Secure=false. 환경변수로 운영 Secure를 true로 덮어쓸 수 있다. 로컬 DB/Redis 자동설정을 제외한다. 게스트 세션은 브라우저 쿠키가 신원이며 다른 기기로 복구할 수 없다.

모든 방/칩/명령 중복 기록은 JVM 메모리다. RoomService가 방별 monitor 아래 엔진을 호출한다. 엔진은 Spring과 전송계층에 의존하지 않는다. 재접속은 같은 세션 및 서버가 살아 있는 동안만 지원한다. 90초 동안 스냅샷 요청이 없으면 자동 fold/퇴장한다. 접속 종료 전에는 액션 타이머 30초를 계속 적용한다.

레이크 0, 방 참가 시 서버가 100BB를 지급하고 탈락 발생 시 다음 핸드에 전원을 100BB로 초기화한다. 한 사용자는 한 방에만 참여하며 재join으로 칩을 재지급하지 않는다. 방 퇴장 후 재참가하면 100BB와 바운티 0점으로 시작한다. 정산은 pots별 contributor 경계, eligible 승자와 정수 odd chip 분배를 사용한다.

현재는 바운티 모드다. 자세한 정산·분배·100BB 리셋 계약은 [bounty-mode.md](bounty-mode.md) 참조.
