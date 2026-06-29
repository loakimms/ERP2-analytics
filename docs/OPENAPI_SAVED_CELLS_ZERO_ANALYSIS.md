# saved_cells: 0 현상 분석 및 대응

## 현상

- 키워드 순위 수집 job이 `status: SUCCESS`, `keywords: 66` 인데 **`saved_cells: 0`** 으로 끝남.
- API 호출 자체는 200으로 성공하지만, **실제 저장 건수가 0**이라 수집이 안 된 것처럼 보임.

## 원인 후보

1. **병렬 워커에서 API 설정 미적용**  
   `_openapi_fetch_shop_items`는 `_first_nonempty()` → `_get_api_setting()` → `_load_api_settings_cached()`로 DB에 있는 네이버 API 키를 읽음.  
   백그라운드 job 스레드에서 executor를 띄운 직후, 워커 스레드가 캐시를 읽기 전에 캐시가 비어 있거나, 워커에서만 캐시를 채우는 타이밍 이슈가 있으면 `client_id`/`client_secret`이 빈 값이 되어 모든 키워드에서 `(None, [])` 반환 → `had_openapi_error=True`, rank 0은 저장하지 않음 → **saved_cells: 0**.

2. **워커/저장 예외가 무시됨**  
   병렬 경로에서 `future.result()` 또는 `_write_keyword_result()` 내부에서 예외가 나도 `except Exception: pass`로 삼켜서, 실패 원인을 알 수 없고 saved도 증가하지 않음.

3. **DB 저장 실패**  
   `_write_keyword_result` 안에서 merge/commit 실패 시 예외만 잡고 0을 반환. 로그가 없어 원인 파악이 어려움.

## 적용한 수정

1. **캐시 선로딩**  
   키워드 수집 루프(순차/병렬 공통) 진입 전에 `_load_api_settings_cached()`를 한 번 호출해, 워커 스레드가 API 설정을 읽을 때 캐시가 이미 채워져 있도록 함.

2. **예외 로깅**  
   - 병렬 경로에서 `future.result()` 또는 그 이후 처리에서 예외가 나면 `[openapi-rank-job] worker result or write failed err=...` 를 출력.
   - `_write_keyword_result` 내부에서 commit 실패 시 `[openapi-rank-job] write_keyword_result failed keyword=... err=...` 를 출력.

3. **saved_cells 힌트**  
   `saved_cells == 0` 이고 처리한 키워드가 있으면, job detail에  
   `saved_cells_hint: "openapi_error_or_write_failure_check_api_logs"` 를 넣어,  
   UI/운영자가 API 로그를 확인하라는 신호를 받을 수 있게 함.

## 점검 방법

- 수집 다시 실행 후 **API 컨테이너 로그** 확인:  
  `docker compose logs api` 또는 `docker logs <api_container>`  
  - `[openapi-rank-job] write_keyword_result failed` → DB 저장 실패.
  - `[openapi-rank-job] worker result or write failed` → 워커 예외(OpenAPI 실패 또는 그 외).
- job detail에 `saved_cells_hint`가 있으면 위 로그와 함께 원인 추적.

## 추가 확인

- 네이버 검색 API 키가 **설정 화면(앱 설정)** 또는 **환경 변수**에 올바르게 들어 있는지.
- DB `app_settings`에 `api:NAVER_SEARCH_CLIENT_ID`, `api:NAVER_SEARCH_CLIENT_SECRET` (또는 사용 중인 키명) 값이 있는지.
