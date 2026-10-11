# AI Content Performance Attribution Contract v1

작성일: 2026-08-24

## 목적

AI 콘텐츠 센터의 두 번째 운영 단절점인 “게시 콘텐츠 → 실제 성과 → Content/Appeal 연결 → 다음 생성 반영”을 구현하기 전에, 채널별 성과 정의와 귀속 기준을 고정한다.

이번 문서는 collector 구현이 아니다. 이 계약이 통과된 뒤, 계약에 필요한 최소 collector 또는 수동 업로드만 구현한다.

## 범위

포함:

- Blog, Instagram, YouTube Shorts, GFA의 성과 metric 정의
- 성과를 `ContentArtifact`, `ContentTopic`, `ContentAppealPoint`, `ContentInsight` 중 어디까지 귀속할지 정의
- 게시 전 baseline과 게시 후 observation window 정의
- `PROMOTE`, `MAINTAIN`, `REVISE`, `OBSERVE` 판정 기준
- 직접 귀속과 단순 상관관계 구분

제외:

- 자동 게시
- 외부 채널 API collector 구현
- 광고비 자동 증액/감액
- 매출 상승을 특정 콘텐츠 원인으로 자동 단정하는 로직

## 핵심 원칙

1. 성과의 1차 소유자는 항상 `ContentArtifact`다.
2. `Appeal`은 여러 콘텐츠 성과가 누적된 뒤에만 강화 또는 약화한다.
3. `Insight`는 장기 학습 레벨이며, 단일 콘텐츠 성과로 즉시 바꾸지 않는다.
4. 직접 추적 가능한 성과와 단순 correlation을 분리한다.
5. 데이터가 부족하면 성공/실패가 아니라 `OBSERVE`다.
6. 자동 게시 없이 사람 검수와 게시 URL/외부 ID 연결을 전제로 한다.

## Attribution 레벨

`DIRECT`

- 게시물 URL, UTM, campaign id, creative id, external id 등으로 해당 콘텐츠 성과임을 직접 확인할 수 있다.
- GFA creative 성과, UTM 포함 블로그 유입, 게시물별 Instagram/Shorts insight가 여기에 해당한다.

`ASSISTED`

- 콘텐츠 노출 이후 같은 SKU의 검색, 클릭, 장바구니, 구매가 증가했지만 콘텐츠 단위 직접 추적은 제한적이다.
- 같은 기간의 다른 마케팅 이벤트와 함께 해석해야 한다.

`CORRELATION`

- 게시 이후 지표 변화는 있으나 해당 콘텐츠가 원인이라는 근거가 약하다.
- Appeal 점수를 바로 올리거나 낮추지 않고 관찰 근거로만 저장한다.

`UNKNOWN`

- 게시 링크 또는 외부 ID는 있으나 성과 데이터를 확보하지 못했다.
- 판정은 `OBSERVE`다.

## 채널별 Metric 계약

GFA:

- Primary metric: CTR, CVR, 구매 수, ROAS.
- Secondary metric: impressions, clicks, cost, creative approval/use status.
- Attribution level: creative id 또는 campaign/adgroup/creative name으로 매칭되면 `DIRECT`.
- Observation window: 게시 또는 사용 시작 후 1일, 3일, 7일.
- Baseline: 동일 상품/캠페인 유형의 최근 7일 또는 최근 N개 GFA creative 평균.

Blog:

- Primary metric: organic visits, product click, 구매 유입이 확인되는 경우 conversion.
- Secondary metric: search exposure, average position, dwell proxy, referral clicks.
- Attribution level: UTM 또는 게시 URL 기반 유입이면 `DIRECT`, SKU 전체 검색/방문 증가는 `ASSISTED`.
- Observation window: 게시 후 3일, 7일, 14일.
- Baseline: 같은 SKU의 최근 14일 organic/search baseline과 같은 채널 과거 콘텐츠 평균.

Instagram:

- Primary metric: reach, engagement rate, saves, shares, profile/link clicks.
- Secondary metric: likes, comments, follows.
- Attribution level: post id 또는 permalink insight가 있으면 `DIRECT`.
- Observation window: 게시 후 1일, 3일, 7일.
- Baseline: 같은 SKU/콘텐츠 포맷의 최근 10개 게시물 중앙값.

YouTube Shorts:

- Primary metric: views, completion rate, retention proxy, click-through to product/link.
- Secondary metric: likes, comments, shares, subscribers gained.
- Attribution level: video id별 insight가 있으면 `DIRECT`.
- Observation window: 게시 후 1일, 3일, 7일, 14일.
- Baseline: 같은 SKU/포맷의 최근 10개 Shorts 중앙값.

## 저장 계약

현행 `ContentPerformanceDaily`는 다음 공통 metric을 가진다.

- `artifact_id`
- `appeal_id`
- `sku_id`
- `channel`
- `metric_date`
- `impressions`
- `clicks`
- `ctr`
- `cvr`
- `saves`
- `shares`
- `completion_rate`
- `purchases`
- `extra_json`

채널별 고유 metric은 `extra_json`에 넣는다.

`extra_json`에는 최소 다음 필드를 둔다.

- `attribution_level`: `DIRECT`, `ASSISTED`, `CORRELATION`, `UNKNOWN`
- `source`: `gfa`, `blog`, `instagram`, `shorts`, `manual`
- `source_external_id`: channel post id, creative id, video id 등
- `published_url`: 게시 URL
- `baseline_window`: 비교 기준 기간
- `observation_window`: 성과 관찰 기간
- `primary_metric`: 채널별 1차 metric 이름
- `primary_value`: 1차 metric 값
- `baseline_value`: baseline 값
- `delta_pct`: baseline 대비 증감률
- `confidence`: `LOW`, `MEDIUM`, `HIGH`
- `notes`: 과잉해석 방지 설명

## 판정 계약

`OBSERVE`

- sample이 최소 기준 미만이다.
- attribution level이 `UNKNOWN`이다.
- 관찰 window가 아직 끝나지 않았다.
- 다른 큰 이벤트와 겹쳐 귀속 판단이 어렵다.

`PROMOTE`

- attribution level이 `DIRECT` 또는 높은 신뢰도의 `ASSISTED`다.
- primary metric이 baseline 대비 의미 있게 개선됐다.
- secondary metric이 치명적으로 악화되지 않았다.
- 금지/제한 claim 이슈가 없다.

`MAINTAIN`

- primary metric이 baseline과 유사하다.
- 부정 신호가 없고 sample이 충분하다.
- Appeal을 유지하되 우선순위를 크게 올리지 않는다.

`REVISE`

- sample이 충분하고 primary metric이 baseline 대비 명확히 악화됐다.
- CTR은 높지만 CVR/구매/클릭 품질이 낮아 hook-content mismatch가 의심된다.
- saves/shares/retention 등 채널 고유 반응이 낮아 포맷 또는 메시지 수정이 필요하다.
- claim risk 또는 고객 오해 가능성이 발견된다.

## 최소 Sample 기준

GFA:

- impressions 1,000 이상 또는 clicks 30 이상 전까지는 `OBSERVE`.

Blog:

- visits 30 이상 또는 product clicks 10 이상 전까지는 `OBSERVE`.

Instagram:

- reach 300 이상 또는 engagements 30 이상 전까지는 `OBSERVE`.

Shorts:

- views 500 이상 또는 completion sample 100 이상 전까지는 `OBSERVE`.

## Appeal 반영 기준

단일 `ContentArtifact` 성과는 바로 `Appeal`의 최종 성공/실패로 보지 않는다.

Appeal에 반영할 수 있는 조건:

- 같은 `appeal_id`에 대해 서로 다른 Artifact가 2개 이상 성과를 제공한다.
- 또는 하나의 Artifact라도 attribution level이 `DIRECT`이고 sample과 개선 폭이 충분하다.
- `CORRELATION`은 Appeal 점수 조정이 아니라 Evidence note로만 저장한다.

Appeal score 조정 원칙:

- `PROMOTE`: freshness와 conversion 계열 score를 소폭 상승.
- `MAINTAIN`: score 유지, observation count만 증가.
- `REVISE`: status를 즉시 폐기하지 않고 `WEAKENING` 또는 수정 후보로 둔다.
- `OBSERVE`: score 변경 없음.

## 과잉해석 방지

다음 경우에는 `PROMOTE`를 금지한다.

- 같은 기간 할인, 이벤트, 광고비 증액, 재고 이슈, 외부 바이럴 등 confounder가 있다.
- 콘텐츠 단위 direct id가 없고 SKU 전체 매출만 상승했다.
- sample이 최소 기준 미만이다.
- claim risk가 `HIGH`다.

다음 경우에는 `REVISE`를 보류하고 `OBSERVE`로 둔다.

- 게시 직후 노출이 아직 충분하지 않다.
- 채널 알고리즘 노출 지연 가능성이 있다.
- 외부 성과 데이터가 일부 누락됐다.

## 다음 구현 Gate

1. `record_performance()`는 이 계약의 `extra_json` 필드를 저장해야 한다.
2. `diagnose_performance()`는 channel, attribution level, baseline, observation window를 입력으로 받아야 한다.
3. 첫 collector는 모든 채널이 아니라 가장 direct attribution이 쉬운 채널 하나부터 시작한다.
4. collector 구현 전에도 수동 performance 입력은 이 계약 필드를 만족해야 한다.
5. `Content → Appeal → Evidence → Performance → Verdict`를 API/UI에서 역추적할 수 있어야 한다.

## 현재 코드와의 차이

`api/content_center_learn.py`의 `diagnose_performance()`와 `record_performance()`는 이 계약의 runtime 입력을 읽도록 정렬됐다.

반영된 runtime 입력:

- `attribution_level`
- `primary_metric`
- `primary_value`
- `baseline_value`
- `delta_pct`
- `sample`
- `min_sample`
- `confidence`
- `observation_complete`
- `source`

검증된 fixture:

- `DIRECT` + 충분한 sample + baseline 대비 개선 → `PROMOTE`
- `DIRECT` + 충분한 sample + baseline 대비 악화 → `REVISE`
- `DIRECT` + 변화 미미 → `MAINTAIN`
- sample 부족 → `OBSERVE`
- `CORRELATION` only → 직접 `PROMOTE` 금지, `OBSERVE`
- `UNKNOWN` → `OBSERVE`
- observation window 미완료 → `OBSERVE`

아직 제외:

- 외부 채널 collector 구현
- Blog / Instagram / Shorts 성과 API 연동

## GFA Performance Attribution Bridge v1

GFA는 새 collector를 만들지 않고 기존 `naver_gfa_performance_daily`를 사용한다.

구현된 연결:

- `ContentArtifact(channel="gfa")`와 실제 GFA `creative_id`를 `ContentGfaCreativeBinding`으로 명시 연결한다.
- Bridge는 정확한 `creative_id` 매칭 성과 row만 `DIRECT` 후보로 사용한다.
- campaign/adgroup aggregate만으로는 `DIRECT`를 허용하지 않는다.
- baseline window와 observation window를 나눠 CTR baseline 대비 delta를 계산한다.
- `record_performance(extra_json=...)`로 Attribution Runtime에 전달한다.
- 동일 Artifact, metric date, baseline window, observation window는 중복 평가하지 않고 기존 `ContentPerformanceDaily`를 재사용한다.

검증된 fixture:

- 정확한 creative_id 매칭 + 충분한 sample + observation window 완료 + baseline 대비 개선 → `DIRECT` / `PROMOTE`
- Creative ID 미연결 → `UNKNOWN` / `OBSERVE`
- Observation window 미완료 → `OBSERVE`
- 표본 부족 → `OBSERVE`
- 동일 window 재평가 → 기존 performance row 재사용

아직 제외:

- GFA API/CDP 신규 수집
- 캠페인/광고그룹 aggregate의 `ASSISTED` 귀속
- Blog / Instagram / Shorts performance bridge
