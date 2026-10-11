# AI Content GFA Learning Loop E2E Verification v1

검증일: 2026-08-24

## 판정

`GFA_PERFORMANCE_ATTRIBUTION_BRIDGE_IMPLEMENTED / REAL_OPERATION_E2E_BLOCKED_LOCAL_DB_NO_REAL_DATA`

GFA Performance Attribution Bridge의 코드 구조와 fixture 기반 테스트는 통과했다. 다만 현재 로컬 Analytics DB에는 실제 운영 테이블과 데이터가 없어 `ContentArtifact → GFA creative_id → naver_gfa_performance_daily → record_performance() → Appeal verdict` 실제 E2E는 아직 증명하지 못했다.

## 이번 검증에서 확인한 것

1. Analytics DB 컨테이너만 기동했다.
   - 실행 대상: `analytics-db`
   - ERP2-dev 계열 컨테이너는 조작하지 않았다.

2. 로컬 Python에서 Postgres 접속을 위해 `psycopg[binary]==3.3.2`를 설치했다.

3. 로컬 DB 접속은 가능했다.
   - DB URL: `postgresql+psycopg://analytics:analytics_pw@localhost:5442/analytics`

4. 그러나 실제 E2E에 필요한 테이블이 현재 로컬 DB에 없다.
   - `content_artifact`: MISSING
   - `content_gfa_creative_binding`: MISSING
   - `content_performance_daily`: MISSING
   - `content_appeal_point`: MISSING
   - `naver_gfa_performance_daily`: MISSING

5. 따라서 실제 운영 row 기반 E2E는 수행하지 않았다.
   - schema/table이 없는 상태에서 fixture를 넣어 통과시키는 것은 실제 운영 E2E 증거가 아니다.
   - 이번 검증은 차단 사유 확인까지만 수행했다.

6. 검증을 위해 기동했던 `analytics-db` 컨테이너는 중지했다.

## 필요한 실제 E2E 조건

다음 중 하나가 필요하다.

1. 실제 운영/NAS Analytics DB에 접근 가능한 환경.
2. 운영 DB snapshot 또는 sanitized dump를 로컬 `analytics-db`에 적재한 환경.
3. 최소한 다음 테이블과 실제 row가 포함된 검증 DB.
   - `content_artifact`
   - `content_appeal_point`
   - `content_gfa_creative_binding`
   - `content_performance_daily`
   - `naver_gfa_performance_daily`

## PASS 기준

실제 데이터로 아래 흐름을 한 건 이상 통과해야 한다.

1. `ContentArtifact.channel = "gfa"`인 Artifact 확인.
2. 해당 Artifact를 실제 GFA `creative_id`와 binding.
3. `naver_gfa_performance_daily.creative_id`에서 동일 creative row 확인.
4. baseline window와 observation window row 확인.
5. Bridge 실행 결과 `attribution_level = DIRECT`.
6. `record_performance()`가 `ContentPerformanceDaily`를 생성 또는 재사용.
7. verdict가 `PROMOTE`, `MAINTAIN`, `REVISE`, `OBSERVE` 중 하나로 계약에 따라 산출.
8. `ContentArtifact → Appeal → Performance → Verdict`를 역추적.
9. AI 콘텐츠 센터 UI에서 학습 현황이 표시되는지 확인.

## 현재 유지 판정

- Daily Insight/Plan 자동화: PASS
- Review-ready Artifact 자동 생성: PASS
- Attribution Contract: PASS
- Attribution Runtime: PASS
- GFA Performance Attribution Bridge 구현: PASS
- GFA Bridge fixture test: PASS
- 실제 운영 데이터 E2E: BLOCKED
- 기존 GFA Generator regression: HOLD_ENVIRONMENT
