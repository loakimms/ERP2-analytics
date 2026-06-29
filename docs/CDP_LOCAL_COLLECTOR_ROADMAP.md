# CDP 수집 단순화 로드맵

## 목표

내 상품 추적의 상품 상세 메트릭 수집에서 사용자가 매번 Host Agent/Host Chrome 실행기를 내려받거나 다시 실행하지 않도록 한다.

최종 목표는 NAS/API 서버가 사용자 PC의 `9223` 포트로 들어가는 구조를 줄이고, 사용자 PC의 로컬 Collector가 Chrome 세션을 직접 다룬 뒤 결과만 Analytics API로 전송하는 것이다.

---

## 현재 구조

```text
Web 수집 모달
  -> 사용자 PC Host Agent(127.0.0.1:9230)로 Chrome CDP 창 시작
  -> Analytics API(local 5189 / NAS 6188)가 사용자 PC Chrome CDP(9223)에 접속
  -> API의 Playwright 스크래퍼가 상품 페이지를 수집
  -> API가 DB(tracked_product_page_daily)에 저장
```

### 병목

- 일반 닫기에서도 Host Chrome/Agent를 종료하면 다음 수집 때 다시 실행해야 한다.
- NAS에서는 API 서버가 사용자 PC의 `9223`으로 접근해야 하므로 방화벽, PC IP 감지, portproxy 문제가 생긴다.
- 수집 로직이 `api/main.py`에 집중되어 있어 Host Agent는 Chrome을 띄우는 보조 역할만 한다.

---

## 1단계: 상시 Host Agent/Chrome 재사용

### 원칙

- 최초 1회 설치 후 Host Agent는 로그인 시 자동 실행한다.
- 일반 모달 닫기는 API의 Playwright 세션만 정리하고, Host Agent/Chrome은 유지한다.
- 실제 종료/자동 실행 해제는 `수집·Agent 강제 종료` 같은 명시적 버튼에서만 수행한다.

### 현재 반영

- `closeCollectPopup()`은 Host Agent/Chrome 종료를 호출하지 않고 API `captcha-session/stop`만 호출한다.
- `forceStopCollectScripts()`는 기존처럼 Host Chrome 종료, Host Agent shutdown, 자동 실행 해제를 수행한다.
- 수집 모달 문구는 강제 종료가 예외 동작임을 드러내도록 조정한다.

### 후속 TODO

- [ ] 수집 모달 상단에 `Host Agent: 연결됨/미실행/오류` 상태 배지 표시
- [ ] Agent 연결됨이면 다운로드 버튼보다 `세션 준비`를 기본 동선으로 강조
- [ ] Host Chrome CDP가 이미 살아 있으면 `세션 준비됨` 상태로 표시
- [ ] NAS standalone Agent에도 ensure task를 추가해 로그인 후 자동 복구 강화

---

## 2단계: Local Collector 구조

### 목표 구조

```text
Web 수집 모달
  -> Analytics API에 collect job 생성
  -> 사용자 PC Host Agent/Local Collector가 job을 가져옴
  -> Local Collector가 로컬 Chrome CDP로 상품 페이지 수집
  -> Collector가 결과 JSON을 Analytics API로 전송
  -> API는 검증/upsert/mirror만 수행
```

### 기대 효과

- NAS 서버가 사용자 PC `9223`에 직접 접근하지 않아도 된다.
- 방화벽/portproxy/IP 자동감지 이슈가 크게 줄어든다.
- 사용자 PC의 로그인/쿠키/보안확인 세션을 로컬 Collector가 안정적으로 재사용한다.
- 웹은 긴 `collect-now` 요청을 들고 있지 않고 job 상태만 폴링할 수 있다.

### API 계약 초안

#### Job 생성

```http
POST /search-rank/page-metrics/local-collector/jobs
{
  "urls": ["https://smartstore.naver.com/..."],
  "mode": "page_metrics",
  "target_date": "2026-06-01"
}
```

응답:

```json
{
  "job_id": "pmc_...",
  "status": "QUEUED",
  "urls": ["..."]
}
```

#### Collector job polling

```http
GET /search-rank/page-metrics/local-collector/jobs/next?device_id=...
```

#### Collector 결과 업로드

```http
POST /search-rank/page-metrics/local-collector/jobs/{job_id}/results
{
  "results": [
    {
      "url": "...",
      "ok": true,
      "metrics": {}
    }
  ]
}
```

API는 여기서 기존 `upsert_tracked_product_page_daily()`와 review mirror를 재사용한다.

### 구현 TODO

- [ ] `api/main.py`에서 `_scrape_product_page_metrics()` 주변 파서/결과 형식을 분리 가능한 모듈로 추출
- [ ] API에 Collector job 테이블 또는 `analytics_job_run` 확장 설계
- [ ] Host Agent에 `/collector/health`, `/collector/jobs/poll`, `/collector/run-once` 추가
- [ ] NAS standalone Agent 생성 스크립트에 Collector 엔드포인트 포함
- [ ] 인증 방식 결정: Firebase bearer 위임, device token, HMAC 중 선택
- [ ] UI는 `collect-now` 직접 호출 대신 job 생성 + 상태 폴링으로 전환
- [ ] 기존 API CDP 수집은 fallback으로 유지하되, 기본값은 Local Collector로 변경
- [ ] 테스트: job 생성, 결과 업로드 upsert, Collector 실패 재시도, 기존 fallback 경로

---

## 권장 진행 순서

1. 1단계 재사용 정책을 배포해 “매번 다시 실행” 문제를 먼저 줄인다.
2. 모달에 Agent 상태 배지를 추가해 설치/실행 여부를 사용자가 바로 알 수 있게 한다.
3. Collector API 계약을 먼저 추가하되 기존 `collect-now`는 유지한다.
4. Host Agent에 Collector prototype을 붙이고, 단일 URL `scrape-once`부터 로컬 실행한다.
5. batch/job 방식으로 확장한 뒤 NAS 기본 수집 경로를 Collector로 전환한다.
