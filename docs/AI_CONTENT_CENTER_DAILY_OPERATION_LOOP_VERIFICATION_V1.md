# AI Content Center Daily Operation Loop Verification v1

검증일: 2026-08-24

## 판정

`AI_CONTENT_CENTER_REVIEW_READY_AUTO_GENERATION_IMPLEMENTED / PERFORMANCE_LOOP_NOT_YET_PROVEN`

현재 코드는 “매일 아침 자동 생성 → 담당자 검수 대기”까지의 첫 번째 운영 루프 단절점을 닫았다. 다만 “게시 → 실제 성과 관찰 → 다음 생성 반영” 운영 루프는 아직 자동으로 닫혔다는 증거가 부족하다.

## 확인된 연결

1. 별도 AI 콘텐츠 센터 메뉴와 화면이 존재한다.
   - `web/src/modules/layout/AppShell.tsx`
   - `web/src/modules/content/ContentCenterView.tsx`

2. 기존 GFA Generator는 소구 기반 생성 lineage를 받을 수 있다.
   - `generation_source=appeal`
   - `appeal_point_id`
   - `api/main.py`
   - `web/src/modules/ads/GfaCreativeGeneratorView.tsx`

3. Content Center 백엔드 핵심 엔진이 존재한다.
   - SKU Scope: `api/content_center_scope.py`
   - Insight / Appeal / Evidence / Claim: `api/content_center_engine.py`
   - Daily Planner: `api/content_center_planner.py`
   - Channel artifact generation: `api/content_center_generate.py`
   - Publish / Performance / Learning: `api/content_center_learn.py`
   - API routes: `api/content_center_api.py`

4. Collection scheduler에 Content Center 분석 작업이 등록되어 있다.
   - task id: `content_insight_daily`
   - default schedule: `07:20`
   - 실행 내용: `sync_content_sku_scope()` → `run_insight_engine()` → `build_today_plan()` → `materialize_plan_artifacts()`

5. Daily Plan 이후 Artifact 자동 생성이 idempotent하게 연결되어 있다.
   - `ContentPlanItem.plan_id`와 `generation_version`을 기준으로 기존 Artifact를 재사용한다.
   - 이미 Artifact가 있는 Plan은 재실행 시 appeal/topic을 변경하지 않는다.
   - 생성물은 `reviewer_status="pending"`에서 멈춘다.
   - 일부 Plan 생성 실패는 `generation_failed`로 격리하고 나머지 Artifact는 검수 가능하게 둔다.

## 미증명 또는 HOLD 항목

1. 실제 외부 성과 수집은 아직 자동 연결이 아니다.
   - `POST /content/performance`로 성과 입력은 가능하다.
   - Blog / Instagram / Shorts의 실제 조회, 저장, 공유, 완주율 등을 자동 수집하는 collector는 확인되지 않았다.
   - 현재 PROMOTE / REVISE는 실제 외부 API 수집 결과라기보다 입력된 performance payload 기반이다.

2. 게시 URL 연결은 가능하지만, 게시 채널 성과와 자동 매칭되는 증거는 없다.
   - `POST /content/publish-links`는 URL/외부 ID 저장까지 담당한다.
   - 이후 URL 또는 external id를 이용한 성과 조회/매칭 작업은 확인되지 않았다.

3. GFA regression은 로컬 환경 제약으로 아직 완전히 닫히지 않았다.
   - `test_gfa_creative_generator`는 현재 Windows Python 3.14 환경에서 `pandas==2.2.2` wheel 부재로 실행 불가.
   - Python 3.11 또는 3.12 환경에서 재실행해야 한다.

4. 실제 브라우저 E2E 운영 흐름은 아직 증명되지 않았다.
   - 검증된 것은 unit test, typecheck, route test다.
   - AI 콘텐츠 센터 진입 → Appeal 선택 → Evidence 확인 → 초안 생성 → 검수 → 게시 URL 연결 → Learning 표시의 실제 브라우저 흐름은 별도 확인이 필요하다.

5. 성과 귀속 기준은 별도 계약으로 고정한다.
   - 기준 문서: `docs/AI_CONTENT_PERFORMANCE_ATTRIBUTION_CONTRACT_V1.md`
   - 다음 collector는 이 계약을 통과한 metric과 attribution level만 구현한다.

## 완료 기준

다음 조건이 모두 충족되어야 1차 운영 루프를 닫았다고 판정한다.

1. 기존 NAS Daily Collection이 SUCCESS/PARTIAL로 끝난 뒤 Content Center가 자동 실행된다. 현재 scheduler wiring은 존재한다.
2. 실제 NAS 데이터로 Insight → Appeal → Daily Plan → Artifact가 사람의 수동 실행 없이 생성된다. 현재 코드 경로와 unit test는 통과했다.
3. 담당자는 AI 콘텐츠 센터 화면에서 생성된 Artifact를 검수 대기 상태로 확인할 수 있다. 현재 `reviewer_status="pending"`으로 생성한다.
4. 게시 URL 또는 외부 ID가 저장되고, 해당 게시물의 실제 성과가 `ContentPerformanceDaily`에 연결된다. 아직 자동 성과 수집/매칭은 HOLD다.
5. `Content → Appeal → Evidence → Performance → PROMOTE/REVISE`가 한 건 이상 역추적된다. 아직 실제 성과 기반 E2E 증거는 HOLD다.
6. Python 3.11/3.12 환경에서 기존 GFA Generator regression test가 통과한다. 현재 로컬 Python 3.14 환경에서는 HOLD다.

## 다음 검증 순서

1. Python 3.11/3.12 테스트 환경을 준비해 `test_gfa_creative_generator`를 실행한다.
2. 실제 운영 DB에서 `content_insight_daily`를 1회 실행해 오늘 Plan과 Artifact가 함께 생성되는지 확인한다.
3. 브라우저 E2E로 AI 콘텐츠 센터 진입 → 검수 대기 Artifact 확인 → 승인/보류 → 게시 URL 연결 흐름을 1회 캡처한다.
4. `docs/AI_CONTENT_PERFORMANCE_ATTRIBUTION_CONTRACT_V1.md`를 기준으로 첫 performance collector 또는 수동 업로드 포맷을 확정한다.

## 검증 결과

- `python -m unittest test_content_center`: PASS, 8 tests.
- `python -m py_compile main.py content_center_generate.py content_center_planner.py`: PASS. 기존 `main.py` 문자열 escape warning은 남아 있으나 이번 변경 문법 오류는 없다.
- `python -m unittest test_gfa_creative_generator`: HOLD. 현재 로컬 Python 3.14 환경에 `pandas`가 없고, `pandas==2.2.2`는 Python 3.14 wheel이 없어 설치가 실패한다.
