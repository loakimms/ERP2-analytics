## ERP2 Analytics 서브 프로젝트 개요

이 디렉터리는 ERP2 본체와 분리된 **광고/검색/쇼핑 분석 전용 서브 프로젝트**입니다.

- UI/UX 는 기존 ERP 웹과 최대한 비슷하게 유지하되,
  - **웹 포트**: `5188` (Analytics Web)
  - **API 포트**: `5189` (Analytics API)
- DB 는 별도 Postgres 컨테이너(`analytics-db`)를 사용해
  - `naver_ad_keyword_daily`, `naver_ad_searchword_daily` 등 **일간 팩트 테이블**을 저장합니다.

### 구성

- `api/`
  - FastAPI 기반 백엔드
  - 역할: SearchAd/쇼핑/키워드 도구 호출, CSV/HTML 파싱, Analytics DB 적재 및 분석 API 제공
- `web/`
  - 광고 분석 전용 프론트엔드 (React/Vite 예정, ERP와 유사한 레이아웃/스타일)
- `docker/analytics.master.yml` + `docker/analytics.*.lock`
  - **운영/개발 단일 진실(SoT)**: `docker/analytics.master.lock`의 `ANALYTICS_IMAGE_TAG`
  - 불변 태그(immutable tag) + candidate→verify→promote 흐름으로 “되돌림”을 구조적으로 차단
- `scripts/`
  - `analytics_rebuild_and_verify.ps1`: 빌드→검증→승격/롤백(표준)
  - `analytics_up.ps1`: 재기동만(빌드 없음)
  - `start-analytics-local.ps1`: 로컬 빌드+기동 (ERP2-dev start-local.ps1와 동일 구조, `data/` 바인드 마운트)
  - `cmd-analytics-local.ps1`: 로컬 기동만 (ERP2-dev cmd-erp2-local.ps1와 동일 구조)
  - `analytics_*` 기타: candidate/verify/promote 단위 스크립트
- `docker-compose.yml` (LEGACY)
  - 과거 개발용 compose. 기본 실행에서 제외되어 있으며, **사용 비권장**(혼선/되돌림 체감 재발 위험)

### 기본 사용 흐름(로컬)

1. `cd C:\dev\ERP2-analytics`
2. 표준(추천): 빌드→검증→승격/롤백까지 한 번에 실행

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_rebuild_and_verify.ps1
```

3. 재기동만 필요하면(빌드 없음)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_up.ps1
# 또는 (ERP2-dev와 동일 구조)
.\scripts\cmd-analytics-local.ps1
```

4. 로컬 개발용 빌드+기동 (ERP2-dev start-local.ps1와 동일 구조, `data/` 폴더 사용)

```powershell
.\scripts\start-analytics-local.ps1
```

5. Python 스크립트 또는 Analytics API를 통해
   - SearchAd / 키워드 리포트 / 검색어 리포트 / 쇼핑 데이터를 수집
   - Analytics DB 에 일간 데이터 적재
6. Analytics Web(5188)에서 적재된 DB를 기준으로 리포트/추천을 조회

### (운영 추가) 내 PC 크롬 세션을 그대로 재사용하기(Host Chrome CDP, 9223)

5-2(쇼핑 검색)처럼 `search.shopping.naver.com`이 **418 제한/보안 확인**으로 막히는 경우,
컨테이너 내부 Chromium 대신 **내 PC(윈도우) Chrome 세션(쿠키/스토리지)을 그대로 재사용**하면
“한 번 풀면 계속 이용” 흐름에 가장 가깝게 동작합니다.

#### 실행 방법(권장: PowerShell 스크립트)

1) 호스트(윈도우)에서 아래 스크립트로 Chrome을 CDP 모드로 실행

```powershell
cd .\analytics
pwsh -File .\tools\start-host-chrome.ps1
```

2) `analytics-api`가 호스트 Chrome에 붙도록 “표준 스택”을 기동
   - `docker/analytics.master.yml`에 기본값으로 아래가 설정되어 있습니다.
     - `USE_HOST_CHROME=1`
     - `PW_CDP_URL=http://host.docker.internal:9223`

3) 5-2에서 “쇼핑검색 캡차 세션 열기”로 호스트 세션에서 보안 확인을 처리한 뒤 “조회”로 재시도

#### 수동 실행(스크립트 대신 직접 실행)

Chrome 실행 옵션 예시:

```text
chrome.exe --remote-debugging-port=9223 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\tmp\erp2-analytics-chrome https://search.shopping.naver.com/
```

#### 보안 주의

- `--remote-debugging-address=0.0.0.0`는 **외부 접근 가능성**이 있으므로,
  - 가능한 **사설 네트워크/로컬만 허용**
  - Windows 방화벽 규칙으로 **9223 포트 외부 차단**
  을 권장합니다.


