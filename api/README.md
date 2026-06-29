## Analytics API (FastAPI) 개요

이 디렉터리는 ERP2 광고/검색/쇼핑 분석용 **전용 백엔드 API** 를 위한 코드가 들어갑니다.

- 프레임워크: FastAPI
- 실행 포트(컨테이너 내부): `8000`
- 도커 포트 매핑(예정): 호스트 `5189` → 컨테이너 `8000`
- 주요 역할:
  - SearchAd API 및 키워드 도구(`/keywordstool`) 호출
  - 네이버 쇼핑 검색 결과(상품/키워드/상품수) 수집
  - 수집된 데이터를 Analytics DB(Postgres, `analytics-db`)에 적재
  - 키워드/검색어/상품 기준 집계·추천 결과를 JSON API 형태로 제공

현재 단계에서는:

- 헬스체크용 엔드포인트(`/health`) 만 제공하는 **뼈대 앱**을 두고,
- 기존 Python 스크립트(`naveradkeyword.py`)를 참조해
  - `collect daily`, `keyword stats`, `searchword stats`, `keyword research` 등의 엔드포인트를
  - 점진적으로 추가해 나갈 예정입니다.

## Host Chrome(CDP) 세션 재사용(윈도우, 9223)

쇼핑 검색(5-2)에서 `search.shopping.naver.com`이 418 제한/보안 확인으로 막히는 경우가 있어,
컨테이너 내부 Chromium 대신 **호스트(윈도우) Chrome의 CDP 세션을 재사용**할 수 있습니다.

- `USE_HOST_CHROME=1`이면 `connect_over_cdp`를 시도합니다. (실패 시 내부 Chromium으로 폴백)
- 기본 `PW_CDP_URL`: `http://host.docker.internal:9223`

호스트 Chrome 실행은 `analytics/tools/start-host-chrome.ps1`를 권장합니다.


