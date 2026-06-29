# AI 운영 센터 구현 명세서

## 1. 문서 목적

이 문서는 `docs/AI_ANALYSIS_MAIN_COMMERCIAL_REDESIGN.md`의 개념 설계를 실제 구현 가능한 수준으로 내리는 명세서다.

목표는 다음 4가지다.

1. 현재 프로젝트의 실제 화면/라우트/API 자산을 최대한 재사용한다.
2. `AI 분석` 메인을 `AI 운영 센터`로 재편한다.
3. `리뷰/Q&A`, `판매 분석`을 AI 메인의 핵심 판단 축으로 편입한다.
4. 향후 유료 서비스 전환을 고려해 `decision mart`, `action_queue`, `decision_log`, `policy pack` 구조까지 확정한다.


## 2. 범위

이 문서의 범위는 다음과 같다.

- 프론트엔드 메뉴/라우팅 구조
- 화면 단위 IA
- 기존 화면 재사용 전략
- 신규 API 제안
- 신규 decision mart / table 제안
- 액션 큐 및 로그 저장 구조
- 1차 구현 범위와 2차 확장 범위

이 문서는 실제 코드 변경 전의 기준 문서이며, 우선순위와 명세의 기준으로 사용한다.


## 3. 현재 자산 요약

### 3.1 현재 프론트 메뉴 구조

현재 `AppShell.tsx` 기준 실제 메뉴는 아래와 같다.

- `AI 분석`
- `키워드(광고/오가닉) 분석`
- `캠페인·광고그룹 분석`
- `검색·쇼핑 순위 분석`
- `판매 분석`
- `리뷰 Q&A`
- `SEO 분석`
- `설정`

### 3.2 현재 AI 관련 서브 라우트

현재 `AI 분석` 하위는 아래 5개 구조로 노출되지만, 실질 구현은 편차가 크다.

- `/analytics/ai/organic-rank`
- `/analytics/ai/organic-rank/trace`
- `/analytics/ai/ads-ops`
- `/analytics/ai/purchase-conv`
- `/analytics/ai/demand-trend`
- `/analytics/ai/sku-policy`

### 3.3 이미 재사용 가능한 화면

#### 오가닉

- `AiOrganicRankA1View`
- `AiOrganicRankA1TraceExplorerView`

#### 광고

- `AdsViews.tsx`
- `AdsKeywordsPerformanceView`
- 캠페인/광고그룹/소재 화면

#### 판매

- `SalesAnalysisView`
- `SalesProductDetailView`

#### 리뷰/Q&A

- `ReviewAnalysisOverviewView`
- `ReviewAnalysisView`
- `QnaAnalysisView`
- `QnaManagementView`

즉, 새 메인을 만들더라도 기존 자산의 대부분은 버리지 않고 재배치 + 요약 + 통합만 하면 된다.


## 4. 새 상위 정보구조

상위 메뉴 `AI 분석`은 그대로 유지할 수 있으나, 서비스형 브랜딩에서는 표시명만 `AI 운영 센터`로 바꾸는 것을 권장한다.

### 4.1 상위 메뉴명

- 내부 코드 id 유지: `menu1-dashboard`
- 표시 라벨 변경 권장: `AI 운영 센터`

### 4.2 새 서브 메뉴 구조

기존 A~E 구조를 해체하고 아래 구조로 교체한다.

1. `오늘의 실행`
2. `상품별 운영 판단`
3. `광고 운영 판단`
4. `판매·전환 판단`
5. `리뷰·VOC 판단`
6. `Q&A 전환장벽 판단`
7. `수요·트렌드 판단`
8. `SKU 정책 센터`
9. `실행 큐`
10. `검증/설명 로그`


## 5. 라우팅 제안

## 5.1 신규 라우트

권장 신규 라우트는 아래와 같다.

- `/analytics/ai/home`
- `/analytics/ai/products`
- `/analytics/ai/ads`
- `/analytics/ai/sales`
- `/analytics/ai/reviews`
- `/analytics/ai/qna`
- `/analytics/ai/trends`
- `/analytics/ai/policies`
- `/analytics/ai/actions`
- `/analytics/ai/logs`

### 5.2 기존 라우트 유지 전략

기존 라우트는 당장 제거하지 않는다.

기존 경로:

- `/analytics/ai/organic-rank`
- `/analytics/ai/organic-rank/trace`
- `/analytics/ai/ads-ops`
- `/analytics/ai/purchase-conv`
- `/analytics/ai/demand-trend`
- `/analytics/ai/sku-policy`

권장 처리:

- 기존 경로를 신규 경로로 리디렉션하거나
- 신규 화면 내부의 특정 탭으로 매핑한다.

예시:

- `/analytics/ai/organic-rank` -> `/analytics/ai/products?tab=organic`
- `/analytics/ai/organic-rank/trace` -> `/analytics/ai/logs?scope=a1-trace`
- `/analytics/ai/ads-ops` -> `/analytics/ai/ads`
- `/analytics/ai/purchase-conv` -> `/analytics/ai/sales`
- `/analytics/ai/demand-trend` -> `/analytics/ai/trends`
- `/analytics/ai/sku-policy` -> `/analytics/ai/policies`


## 6. 화면 명세

## 6.1 오늘의 실행

### 목적

오늘 즉시 승인/검토해야 할 액션을 우선순위 순으로 보여준다.

### 데이터 입력

- `decision_product_health_daily`
- `action_queue`
- `decision_log`
- 광고/판매/리뷰/Q&A 최신 커버리지 요약

### 화면 블록

1. 상단 KPI
- 오늘 중단 후보 수
- 오늘 확대 후보 수
- VOC 위험 SKU 수
- FAQ 보완 필요 SKU 수
- 데이터 신뢰도

2. 위험/기회 카드
- 광고 과투입
- 오가닉 급락
- 리뷰 위험
- Q&A 장벽
- 판매 성장 기회

3. 오늘의 우선 액션 리스트
- entity
- 문제 요약
- 추천 액션
- 우선순위
- 근거
- 큐 담기 / 상세 보기

### 기존 화면 재사용

- 없음. 신규 요약 허브로 구현
- 단, 카드 클릭 시 아래 기존 화면으로 이동:
  - 상품 상세 판단
  - 광고 판단
  - 판매 판단
  - 리뷰/Q&A 판단


## 6.2 상품별 운영 판단

### 목적

상품/SKU 단위로 모든 축의 신호를 통합해 최종 정책과 액션을 제시한다.

### 데이터 입력

- `decision_product_health_daily`
- `decision_sku_daily`
- `tracked_product_meta`
- `a1_sku_map`

### 화면 블록

1. 상품 목록 카드
- 상품명
- 정책 뱃지
- 오가닉 건강도
- 광고 효율도
- 판매 성장도
- 리뷰 위험도
- Q&A 장벽도
- 데이터 신뢰도

2. 상세 모달/상세 화면
- 오가닉 요약
- 광고 요약
- 판매 요약
- 리뷰 요약
- Q&A 요약
- 최종 판단
- 실행 제안 3개
- 설명 로그 링크

### 기존 화면 재사용

- `AiOrganicRankA1View`
- `SalesProductDetailView`
- `ReviewAnalysisOverviewView`
- `QnaAnalysisView`

재사용 방식:

- 신규 상품 판단 화면에서 카드형 요약 제공
- 상세 영역에서 기존 화면 일부 섹션을 임베드하거나 API 재조회


## 6.3 광고 운영 판단

### 목적

광고 키워드/검색어/예산/잠식/소재 판단을 수행하고 액션으로 연결한다.

### 하위 탭

- 키워드 액션
- 검색어 품질
- 잠식 분석
- 예산 재배분
- 소재/지면 판단

### 데이터 입력

- `decision_keyword_daily`
- `decision_campaign_daily`
- `decision_creative_daily`
- `naver_ad_keyword_daily`
- `naver_ad_searchword_daily`
- `naver_ad_creative_daily`

### 기존 화면 재사용

- `AdsViews.tsx`
- `AdsKeywordsPerformanceView`
- 캠페인/광고그룹/소재 화면

### 구현 원칙

- 기존 광고 화면은 원천 분석/집계 화면으로 유지
- 새 광고 운영 판단 화면은 `결정/행동` 중심의 별도 facade로 만든다


## 6.4 판매·전환 판단

### 목적

광고 성과가 아니라 실제 매출/주문 기준으로 확대/축소/보류를 판단한다.

### 데이터 입력

- `decision_sales_daily`
- `naver_commerce_product_sales_daily`
- `naver_smartstore_purchase_keyword_daily`

### 화면 블록

1. 판매 KPI
- 총매출
- 주문수
- 환불 영향
- 상위 매출 SKU 비중

2. SKU 액션 리스트
- 성장형 SKU
- 광고 과투입 SKU
- 환불 리스크 SKU
- 상위 매출 집중 대상

3. 카테고리 관점
- 카테고리 성장 기회
- 특정 카테고리 과투입

### 기존 화면 재사용

- `SalesAnalysisView`
- `SalesProductDetailView`

재사용 방식:

- 판매 화면은 원천 사실 확인용
- AI 판매 판단 화면은 그 결과를 액션 중심으로 재정렬


## 6.5 리뷰·VOC 판단

### 목적

평판 문제와 강점을 광고/판매 판단에 연결한다.

### 데이터 입력

- `decision_review_daily`
- `naver_review_raw`
- `naver_product_review_daily`
- `review_reply_draft`

### 화면 블록

1. 위험 상품 리스트
- 부정 비율
- 평점 변화
- 위험 카테고리
- 광고 확대 금지 여부

2. 강점 상품 리스트
- 강점 카테고리
- 리뷰량 증가율
- 확장 가능성

3. 실행 제안
- VOC 개선
- 답글 정책 개선
- 확대 보류
- 개선 후 재광고

### 기존 화면 재사용

- `ReviewAnalysisOverviewView`
- `ReviewAnalysisView`


## 6.6 Q&A 전환장벽 판단

### 목적

구매 직전 문의를 분석해 상세페이지/FAQ/답변 정책 개선으로 연결한다.

### 데이터 입력

- `decision_qna_daily`
- `commerce_qna_raw`
- `commerce_qna_analysis`
- `commerce_qna_analysis_keyword`
- `commerce_qna_analysis_issue_tag`

### 화면 블록

1. 전환 장벽 상위 SKU
- 구매 직전 문의
- 부정 문의
- FAQ 후보

2. 반복 질문/FAQ 후보
- 상세 설명 부족 영역
- 답변 보완 필요 영역

3. 실행 제안
- FAQ 등록
- 상세페이지 보강
- 답변 정책 보완

### 기존 화면 재사용

- `QnaAnalysisView`
- `QnaManagementView`


## 6.7 수요·트렌드 판단

### 목적

트렌드와 lifecycle을 통해 예산/SEO 방향을 제시한다.

### 데이터 입력

- Datalab 관련 적재 결과 또는 캐시
- `decision_trend_daily` 또는 동등 view

### 구현 메모

- 현재 DB 장기 적재 수준이 약하면 1차에서는 제한적 구현
- 2차부터 정식 판단 축으로 확대


## 6.8 SKU 정책 센터

### 목적

각 상품의 장기 운영 정책을 고정한다.

### 데이터 입력

- `decision_product_health_daily`
- `policy_pack`

### 화면 블록

- 정책 분류별 SKU 분포
- 정책 변경 이력
- 정책별 권장 액션


## 6.9 실행 큐

### 목적

AI 판단 결과를 실제 운영 액션 대기열로 전환한다.

### 데이터 입력

- `action_queue`

### 화면 블록

- 대기중
- 승인됨
- 반려됨
- 실행됨
- 사후평가 필요


## 6.10 검증/설명 로그

### 목적

모든 판단에 대한 근거/검증/사후성과를 추적한다.

### 데이터 입력

- `decision_log`
- `analysis_run`
- `analysis_trace_node`
- `analysis_trace_edge`
- `analysis_action_review`

### 기존 화면 재사용

- `AiOrganicRankA1TraceExplorerView`

재사용 방향:

- A-1 trace 화면을 전체 AI 엔진의 설명/검증 로그 패턴으로 확대


## 7. 신규 decision mart 명세

## 7.1 공통 원칙

- GPT에는 raw 테이블을 직접 전달하지 않는다.
- 모든 판단은 `decision_*` mart를 입력으로 사용한다.
- mart는 일별 스냅샷 또는 기간 집계를 지원해야 한다.
- mart는 재현 가능해야 하며, 입력 raw와 정책 버전이 추적 가능해야 한다.


## 7.2 decision_keyword_daily

### 용도

- 키워드 유지/중단/테스트/제외 후보 판단
- 잠식 판단
- 신규 광고 기회 판단

### 권장 컬럼

- date
- keyword
- campaign_name
- adgroup_name
- impressions
- clicks
- cost
- conversions
- revenue
- roas
- ctr
- cvr
- organic_rank
- rank_change_7d
- rank_volatility_14d
- purchase_cnt_30d
- purchase_amt_30d
- trend_dir
- trend_strength
- is_zero_conversion
- is_organic_strong
- is_purchase_keyword
- is_cannibal_suspect
- data_quality_score


## 7.3 decision_campaign_daily

### 용도

- 캠페인/그룹 단위 예산 이동 판단

### 권장 컬럼

- date
- level
- campaign_name
- adgroup_name
- cost
- revenue
- conversions
- roas
- cost_change_7d
- revenue_change_7d
- elasticity_score
- efficiency_band
- data_quality_score


## 7.4 decision_sales_daily

### 용도

- 판매 기반 확대/축소 판단

### 권장 컬럼

- date
- product_id
- product_name
- amount
- order_count
- quantity
- refund_amount
- refund_ratio
- sales_growth_7d
- sales_growth_30d
- category_large
- category_middle
- category_small
- data_quality_score


## 7.5 decision_review_daily

### 용도

- 리뷰 위험/강점 판단

### 권장 컬럼

- date
- product_url
- product_id_catalog
- product_title
- total_reviews
- average_rating
- positive_ratio
- negative_ratio
- review_growth_rate
- rating_delta
- high_risk_category
- top_positive_category
- risk_score
- strength_score
- data_quality_score


## 7.6 decision_qna_daily

### 용도

- FAQ/상세/답변 정책 판단

### 권장 컬럼

- date
- qna_scope
- product_name
- product_id_catalog
- total_items
- purchase_ready_count
- negative_count
- faq_candidate_count
- unanswered_count
- analysis_coverage_rate
- barrier_score
- faq_need_score
- response_gap_score
- data_quality_score


## 7.7 decision_product_health_daily

### 용도

- 상품별 최종 판단의 진실원

### 권장 컬럼

- date
- sku_id
- product_url
- product_id_catalog
- product_name
- organic_strength_score
- ad_efficiency_score
- sales_growth_score
- review_risk_score
- qna_barrier_score
- trend_momentum_score
- priority_score
- policy_type
- top_issue
- top_action_json
- confidence_score
- data_quality_score


## 8. 신규 운영 테이블 명세

## 8.1 action_queue

### 목적

AI 판단 결과를 실제 액션 대기열로 저장

### 권장 컬럼

- id
- created_at
- source_scope
- entity_type
- entity_id
- action_type
- payload_json
- priority
- source_prompt_id
- decision_log_id
- status
- approved_by
- approved_at
- executed_at
- execution_result_json

### status 권장 enum

- PENDING
- APPROVED
- REJECTED
- EXECUTED
- FAILED
- CANCELLED


## 8.2 decision_log

### 목적

판단 자체를 기록하고 사후 평가 가능하게 함

### 권장 컬럼

- id
- created_at
- scope
- entity_type
- entity_id
- prompt_id
- prompt_version
- model
- policy_pack_id
- input_snapshot_hash
- input_summary_json
- output_json
- final_action
- user_feedback
- after_7d_metrics_json


## 8.3 policy_pack

### 목적

고객/브랜드/운영 성향별 임계값 관리

### 권장 컬럼

- policy_pack_id
- tenant_id
- name
- description
- strategy_type
- params_json
- is_default
- created_at
- updated_at


## 9. 신규 API 명세

## 9.1 홈

- `GET /ai/ops/home`
  - 오늘의 실행 요약

## 9.2 상품 판단

- `GET /ai/ops/products`
  - 상품 카드 목록
- `GET /ai/ops/products/{sku_id}`
  - 상품 상세 판단

## 9.3 광고 판단

- `POST /ai/ops/ads/keyword-actions`
- `POST /ai/ops/ads/searchword-negatives`
- `POST /ai/ops/ads/cannibalization`
- `POST /ai/ops/ads/budget-reallocation`

## 9.4 판매 판단

- `GET /ai/ops/sales/summary`
- `GET /ai/ops/sales/products`
- `GET /ai/ops/sales/categories`

## 9.5 리뷰/VOC 판단

- `GET /ai/ops/reviews/summary`
- `GET /ai/ops/reviews/products`
- `GET /ai/ops/reviews/actions`

## 9.6 Q&A 판단

- `GET /ai/ops/qna/summary`
- `GET /ai/ops/qna/products`
- `GET /ai/ops/qna/actions`

## 9.7 정책/큐/로그

- `GET /ai/ops/policies`
- `POST /ai/ops/policies`
- `GET /ai/ops/actions`
- `POST /ai/ops/actions`
- `POST /ai/ops/actions/{id}/approve`
- `POST /ai/ops/actions/{id}/reject`
- `GET /ai/ops/logs`
- `GET /ai/ops/logs/{id}`


## 10. 응답 스키마 원칙

모든 판단 응답은 공통 envelope를 권장한다.

### 공통 응답 예시

```json
{
  "ok": true,
  "scope": "product-health",
  "date_from": "2026-04-01",
  "date_to": "2026-04-11",
  "policy_pack_id": "default_conservative",
  "data_quality_score": 0.91,
  "items": [],
  "summary": {},
  "actions": [],
  "trace": {
    "available": true,
    "log_id": "..."
  }
}
```

### item 공통 필드 권장

- `entity_type`
- `entity_id`
- `title`
- `score`
- `confidence`
- `severity`
- `reasons`
- `recommended_actions`
- `flags`


## 11. 프론트 구현 전략

## 11.1 1차는 신규 AI 운영 센터 화면을 별도 추가

기존 광고/판매/리뷰/Q&A 화면은 유지한다.

이유:

- 현재 화면은 사실 확인용으로 이미 유용하다.
- 신규 화면은 판단/행동용 overlay 역할로 시작하는 것이 안전하다.

## 11.2 기존 화면을 detail source로 사용

예시:

- 상품 운영 판단 화면 -> 상세 보기 클릭 -> 기존 리뷰/Q&A/판매 상세 이동
- 광고 판단 화면 -> 기존 캠페인/광고그룹/소재 화면으로 drill-down

## 11.3 점진적 전환

1차:

- 새 AI 운영 센터만 추가

2차:

- 기존 A~E 플레이스홀더 제거
- 신규 구조로 완전 교체


## 12. 1차 구현 우선순위

### Phase 1

- `AI 운영 센터` 서브 메뉴/라우트 추가
- `오늘의 실행` 화면 추가
- `상품별 운영 판단` 화면 추가
- `실행 큐` 화면 추가
- `검증/설명 로그` 화면 추가

### Phase 2

- `decision_product_health_daily`
- `action_queue`
- `decision_log`
- 홈/API 연결

### Phase 3

- `광고 운영 판단`
- `리뷰·VOC 판단`
- `Q&A 전환장벽 판단`
- 기존 상세 화면 연동

### Phase 4

- `판매·전환 판단`
- `수요·트렌드 판단`
- `SKU 정책 센터`


## 13. 상용화 전환 준비 항목

상용화 전환 전 반드시 포함해야 하는 항목은 아래다.

- tenant/account 분리
- 정책팩 분리
- 프롬프트 버전 관리
- 감사 로그
- 승인 이력
- 데이터 신뢰도 지표
- 고객용 리포트 모드
- 운영자용 실행 모드


## 14. 최종 결론

실제 구현 관점에서 가장 중요한 결정은 아래 3가지다.

1. 기존 메뉴를 없애는 것이 아니라, `AI 운영 센터`를 `판단/행동 허브`로 새로 세운다.
2. `리뷰/Q&A`, `판매 분석`을 별도 보조 메뉴로 두지 않고, 상품 판단의 핵심 입력으로 끌어온다.
3. 모든 GPT 판단은 `decision mart -> structured output -> action queue -> decision log` 경로로만 흐르게 만든다.

이 구조를 따르면 현재 프로젝트는 기능 나열형 분석 도구를 넘어,
상업적으로 판매 가능한 수준의 `운영 판단 엔진`으로 발전할 수 있다.
