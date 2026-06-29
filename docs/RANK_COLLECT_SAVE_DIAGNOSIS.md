# 키워드 순위 수집·저장 단계별 진단

수집이 실제로 되는지, OpenAPI에서 데이터를 가져오는지, DB에 저장되는지를 **단계별로** 확인하는 방법입니다.

---

## 확인된 원인 (수정 완료)

- **증상**: "키워드 순위 지금 수집" 클릭 시 UI는 STARTED로 표시되지만 진행률이 올라가지 않고, API 로그에 `[openapi-rank-job]` 로그가 전혀 없음.
- **원인**: `_run_openapi_rank_job` 내부에서 **첫 로그 출력 시 `keywords_list`를 참조**하는데, 해당 변수는 **그 아래 줄에서 정의**되어 있어 `NameError` 발생 → 백그라운드 태스크가 조용히 종료되고, job은 DB에 STARTED로 남음.
- **수정**: `keywords_list` 및 `concurrency`를 **로그 출력 이전**에 정의하도록 이동. 추가로 `no_product_id` / `openapi_not_configured` 조기 실패 시에도 로그 출력하도록 보강.
- **검증**: API 재빌드 후 "키워드 순위 지금 수집" 실행 → `docker logs ... | findstr openapi-rank-job` 에 `[openapi-rank-job] start job_id=...` 가 보이고, 진행률이 갱신되면 정상.

---

## 전체 흐름 요약

```
[UI] 수집 시작
  → POST /search-rank/crawl/category (job_id 반환)
  → BackgroundTasks: _run_openapi_rank_job()
      ① 네이버 OpenAPI(shop.json) 호출로 키워드별 순위 조회
      ② _write_keyword_result() 로 tracked_product_rank_daily 에 merge
  → analytics_job_run 상태: STARTED → SUCCESS (또는 FAILED/CANCELLED)

[UI] today-status 폴링
  → POST /search-rank/crawl/today-status
  → DB tracked_product_rank_daily (date=오늘, source='openapi') 조회
  → 수집 완료 수 = 해당 product_url·키워드 조합에 대한 행 존재 개수
```

- **수집이 “진행 중”인지**: job 상태가 `STARTED`이고, 주기적으로 `today-status` 호출로 UI 진행률이 갱신되는지로 판단 가능.
- **데이터를 “가져오는지”**: OpenAPI 호출이 성공하는지 → API 로그와 `saved_cells`/진단 로그로 확인.
- **“저장”하는지**: `tracked_product_rank_daily`에 오늘자·`source='openapi'` 행이 실제로 늘어나는지 → DB 조회로 확인.

---

## 호출 간격 ("1.2초에 한 번" 체감)

- **관찰**: 네트워크 탭 등에서 OpenAPI 호출이 약 1.2초마다 한 번씩 나가는 것처럼 보일 수 있음.
- **원인**: 코드에 1.2초 고정 sleep은 없음. **키워드당 1사이클** = API 1회 요청(네트워크 RTT 수백 ms) + DB 저장 + (같은 키워드 2페이지 이상일 때만) 10~30ms sleep. `OPENAPI_RANK_CONCURRENCY=1`(기본)이면 키워드를 순차 처리하므로, 체감상 "1키워드 ≈ 1초대"가 됨.
- **조정**: 더 빠르게 하려면 `OPENAPI_RANK_CONCURRENCY=4` 등으로 키워드 병렬 처리. 페이징 간 지연은 `OPENAPI_RANK_DELAY_MIN` / `OPENAPI_RANK_DELAY_MAX`(초, 기본 0.01~0.03)로 조정 가능(429 발생 시 완화).

---

## 1단계: 수집이 실제로 진행되고 있는지

### 확인할 것

- job이 **시작**되었는지
- job 상태가 **STARTED**인 동안 **today-status**가 주기적으로 호출되어 UI 진행률이 변하는지

### UI 증거

- "상품별 키워드 수집 현황" 테이블에 **상태: STARTED** 또는 **처리완료**가 보임.
- 진행률(수집 완료 / 총 키워드 수)이 시간이 지나면서 **변동**함 (폴링으로 갱신).

### 네트워크 증거

- 개발자 도구 Network 탭에서 다음이 반복 호출됨:
  - `GET .../search-rank/crawl/category/status?job_id=...` → 200
  - `POST .../search-rank/crawl/today-status` (product_urls) → 200

### API 로그

- job 시작 시 한 번 다음 로그가 나와야 함:
  - `[openapi-rank-job] start job_id=... keywords=... client_id_len=... client_secret_len=... concurrency=...`
- `client_id_len` / `client_secret_len` 이 **0이 아니어야** 함 (0이면 OpenAPI 미설정 → 2단계에서 실패).

**결론**: 위 로그가 있고, UI에서 진행률이 변하면 **수집(작업)은 진행 중**으로 볼 수 있음.

---

## 2단계: OpenAPI에서 데이터를 제대로 가져오는지

### 확인할 것

- 네이버 검색 API(shop.json) 호출이 **성공**하는지
- `client_id` / `client_secret` 이 job/워커에 **제대로 전달**되는지

### API 로그 (필수)

수집 한 번 실행한 뒤, API 컨테이너 로그에서 아래를 확인:

```bash
# 로컬 Docker (analytics 마스터 스택)
docker compose -f docker/analytics.master.yml --env-file docker/analytics.master.lock logs --tail=500 analytics-api 2>&1 | findstr /i "openapi-rank-job"
```

확인할 로그:

| 로그 내용 | 의미 |
|-----------|------|
| `[openapi-rank-job] start ... client_id_len=0 client_secret_len=0` | API 키 미설정 → 2단계 실패. 설정(앱 설정 또는 env) 확인 필요. |
| `[openapi-rank-job] start ... client_id_len=... client_secret_len=...` (둘 다 0 아님) | 자격증명은 job에 전달됨. |
| `[openapi-rank-job] saved_cells=0 diagnostic: ... http_status=200 items_count=...` | OpenAPI는 200이고 items 있음 → 가져오기는 됨. 저장(3단계) 문제 가능성 큼. |
| `[openapi-rank-job] saved_cells=0 diagnostic: ... http_status=4xx` 또는 `items_count=0` | OpenAPI 오류 또는 결과 없음 → 가져오기 실패. |
| `[openapi-rank-job] write_keyword_result failed keyword=... err=...` | **저장** 단계 예외 → 3단계 확인. |
| `[openapi-rank-job] worker result or write failed err=...` | 워커(OpenAPI 호출 또는 저장) 예외. |

### 설정 출처

- 자격증명 우선순위: **DB(app_settings `api:NAVER_SEARCH_CLIENT_ID` 등)** → **환경변수**.
- 설정 화면(앱 설정)에 넣은 값은 DB에 저장되며, job 시점에 `_load_api_settings_cached()`로 읽힘.

**결론**:  
- `client_id_len`/`client_secret_len` 이 0이 아니고,  
- `saved_cells=0 diagnostic` 에 `http_status=200`, `items_count>0` 이면 **데이터는 가져오고 있음**.  
- 그런데도 `saved_cells=0` 이면 **3단계(저장)** 를 의심.

---

## 3단계: DB에 제대로 저장하고 있는지

### 확인할 것

- `tracked_product_rank_daily` 테이블에 **오늘 날짜**, **source='openapi'** 인 행이 수집 후 **증가**하는지

### DB 직접 조회

Analytics DB는 `analytics` (사용자 `analytics`). 로컬 마스터 스택에서:

```bash
# 오늘자 openapi 저장 건수 (전체)
docker compose -f docker/analytics.master.yml --env-file docker/analytics.master.lock exec analytics-db psql -U analytics -d analytics -c "
SELECT date, source, COUNT(*) AS rows
FROM tracked_product_rank_daily
WHERE date = CURRENT_DATE AND source = 'openapi'
GROUP BY date, source;
"

# 오늘자 openapi 상품별·키워드 수 (샘플)
docker compose -f docker/analytics.master.yml --env-file docker/analytics.master.lock exec analytics-db psql -U analytics -d analytics -c "
SELECT product_url, COUNT(*) AS keywords
FROM tracked_product_rank_daily
WHERE date = CURRENT_DATE AND source = 'openapi'
GROUP BY product_url
ORDER BY keywords DESC
LIMIT 10;
"
```

- 수집 **전**에 위 쿼리를 한 번 돌려 두고, 수집 **완료(SUCCESS)** 후 다시 돌려서 **rows / keywords 수가 늘었는지** 보면 저장 여부를 판단할 수 있음.

### UI·API와의 관계

- **today-status**는 이 테이블을 조회해서 "수집 완료" 개수를 만듦.
- 여기에 행이 없으면 UI에서도 수집 완료 수가 0으로 나옴.
- job의 `saved_cells`는 **이번 job에서 merge 성공한 셀 수**이므로, 로그의 `saved_cells`와 위 `COUNT(*)` 증가분이 대략 일치하면 저장이 정상 동작하는 것.

**결론**:  
- 수집 완료 후 `tracked_product_rank_daily` (date=오늘, source='openapi') 행이 **이전보다 증가**하면 **저장까지 정상**.  
- 증가가 없으면 `[openapi-rank-job] write_keyword_result failed` 로그가 있는지 확인하고, DB 권한/스키마/트랜잭션 롤백 여부를 추가로 점검.

---

## 요약 체크리스트

| 단계 | 확인 방법 | 정상일 때 |
|------|-----------|-----------|
| 1. 수집 진행 | UI 진행률 변동, status 폴링 200 | STARTED 동안 % 갱신, today-status 200 |
| 2. 데이터 가져오기 | API 로그 `[openapi-rank-job]` | client_id_len/client_secret_len ≠ 0, diagnostic 시 http_status=200, items_count>0 |
| 3. 저장 | DB `tracked_product_rank_daily` (오늘, openapi) | 수집 후 COUNT(*) 증가, write_keyword_result failed 없음 |

---

## 재기동 후 "상태: STARTED"만 보이고 수집 로그가 없을 때

- **원인**: 수집 job은 API 프로세스의 BackgroundTasks에서 실행됨. **API(컨테이너)를 재기동하면** 그 프로세스가 종료되며, 그때 실행 중이던 job은 **완료되지 않고 사라짐**. DB의 `analytics_job_run`에는 여전히 `status=STARTED`로 남아 있어 UI가 "상태: STARTED"만 반복 표시함.
- **수집 로그(print)**: 재기동 **이전** 컨테이너의 stdout에만 있었고, 재기동 후에는 **새 컨테이너**라서 해당 job의 `[openapi-rank-job]` 로그는 **남아 있지 않음**.
- **대응**:
  1. **API 재기동 시** 이제 STARTED로 남아 있는 category-crawl job을 자동으로 `FAILED (api_restart)` 처리함 → UI에서 곧 NOT_FOUND/FAILED로 바뀌고 job_id가 정리됨.
  2. **새로 수집**하려면 "키워드 순위 지금 수집"을 **다시** 눌러 **새 job**을 시작한 뒤, **재기동하지 말고** SUCCESS/FAILED가 나올 때까지 기다리면 됨. 그동안 `docker logs analytics-master-api` 또는 `diagnose-rank-collect-save.ps1`로 `[openapi-rank-job]` 로그 확인 가능.

---

## "수정 후 저장 0건" 확인 절차 (실제로 새로 쓰는지 검증)

UI %와 DB가 일치해도, **수정한 수집 방식으로 새로 저장된 행이 0건**일 수 있다. 그때 아래로 검증한다.

1. **한 상품만 오늘 openapi 데이터 삭제**
   - DB: `DELETE FROM tracked_product_rank_daily WHERE date = CURRENT_DATE AND source = 'openapi' AND product_url = '해당상품URL';`
   - 또는 UI에서 "오늘(OpenAPI) 데이터 삭제 후 재수집" 후 **그 상품만** 수집 대상으로 두고 수집 실행.
2. **해당 상품만 "키워드 순위 지금 수집" 실행** (재기동하지 말 것).
3. **API 로그 확인** (`docker logs analytics-master-api` 또는 `diagnose-rank-collect-save.ps1`):
   - `[openapi-rank-job] start ... smart_targets=... catalog_by_url=...` → 둘 다 0이면 상품 ID 매칭 불가로 저장 0건 가능.
   - `client_id_len=0` 또는 `client_secret_len=0` → OpenAPI 미설정으로 저장 0건.
   - `[openapi-rank-job] wrote keyword ... saved=1` 등 → 실제로 쓰기 발생.
   - `[openapi-rank-job] saved_cells=0 → 수정 후 저장 0건. 원인 후보: ...` → 원인 후보 1~4 확인.
4. **job이 SUCCESS로 끝난 뒤** DB에서 해당 상품의 `tracked_product_rank_daily` 행 수 조회. 0이면 수정한 경로에서 쓰기가 한 건도 안 된 것.

---

## 로그 분석 요약 (표시 %가 변동 없을 때)

- **Network 탭**: `status?job_id=...`, `today-status` 가 200으로 반복 호출되면, 프론트는 정상 폴링 중.
- **API 로그에 `[openapi-rank-job]` 이 전혀 없음**  
  - 수집 job이 **다른(이전) 컨테이너**에서 돌다가 재기동으로 죽었을 가능성. → 재기동 시 STARTED를 FAILED로 정리하는 로직으로 유령 job 정리.  
  - 또는 **BackgroundTasks의 print가 버퍼링**되어 로그에 안 찍힘. → `print(..., flush=True)` 및 `PYTHONUNBUFFERED=1` 적용 후 재빌드하면 로그에 바로 보임.
- **%가 안 올라가는 이유**:  
  1) **DB에 새 행이 안 쌓임** (job이 죽었거나, 저장 실패) → today-status 응답이 매번 동일 → UI % 고정.  
  2) **job은 돌고 저장도 되는데** UI가 갱신 안 됨 → today-status 응답이 바뀌는지 Network 탭에서 비교.  
- **확인 순서**: 재빌드 후 "키워드 순위 지금 수집" 한 번 실행 → `docker logs analytics-master-api` 에 `[openapi-rank-job] start ... smart_targets=...` 가 보이는지 확인. 보이면 job이 이 컨테이너에서 돌고 있는 것.

---

## 관련 문서

- **saved_cells=0 전용 분석·대응**: [OPENAPI_SAVED_CELLS_ZERO_ANALYSIS.md](./OPENAPI_SAVED_CELLS_ZERO_ANALYSIS.md)
