# Phase 8 - External Intelligence Architecture v1

상태: LOCKED
범위: 아키텍처 설계 전용
기준 SoT: `c:\Users\김명수\Desktop\ai-analytics Phase1_7.html`
작성일: 2026-08-20
Lock 기준: 사용자 검토 승인, 2026-08-20 10:20 KST

## 0. 실행 계약

이 문서는 Phase 8 아키텍처 계약 문서다. 런타임 구현 작업이 아니다.

이번 Phase에서는 런타임 코드, DB 스키마, API, UI, 크롤러, 수집기, Runner, WHY Engine, 외부 요인 자동 Root 판정 로직을 수정하지 않는다.

이번 Phase에서 승인된 산출물은 아래 계약 문서 1개뿐이다.

`docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`

## 1. 목적

Phase 1~7은 외부 HTML 설계 SoT 안에서 Internal Decision Intelligence Architecture를 정의한다. Phase 8은 그 설계 체계 위에 External Intelligence Architecture를 추가한다.

목적은 외부 요인이 WHY 분석에 어떻게 들어오는지 정의하는 것이다.

- 외부 맥락을 언제 관찰하는가
- 어떤 외부 signal을 조사할 수 있는가
- 어떤 Evidence가 필요한가
- External Evidence가 Internal / Historical Evidence와 어떻게 연결되는가
- 외부 signal이 어느 수준까지 Candidate로 인정되는가
- 언제 UNKNOWN으로 유지해야 하는가
- 언제 Human 판단으로 넘겨야 하는가

Phase 8은 외부 데이터 수집 구현을 하지 않는다.

## 2. 상태 분리

Architecture 상태와 현재 Repository 구현 상태를 혼합하지 않는다.

아래 두 상태 축을 반드시 분리해서 사용한다.

### 2.1 Architecture Status

- DEFINED
- PARTIAL
- OPEN
- HOLD

### 2.2 Current Repository Implementation Status

- IMPLEMENTED
- PARTIAL
- NOT_AVAILABLE
- NOT_VERIFIED

예시:

| 계약 | Architecture Status | Current Repository Implementation Status |
| --- | --- | --- |
| Event Evidence Bundle | Phase 4 SoT에서 DEFINED | NOT_AVAILABLE |
| External Evidence as sub-evidence | Phase 8에서 DEFINED | NOT_AVAILABLE |
| Market Demand source | PARTIAL | PARTIAL |
| Weather source | OPEN | NOT_AVAILABLE |

설계에 존재하는 개념을 현재 런타임 코드에 이미 구현된 것처럼 표현하지 않는다.

## 3. 기존 계약 기준선

아래 Phase 1~7 계약은 유지한다.

### 3.1 WHY 흐름

WHY 분석은 기존 순서를 유지한다.

```text
Detect
  -> Decompose
  -> Compare
  -> Connect
  -> Explain
  -> Evidence
  -> Recommend
  -> Verify
```

Fact, Interpretation, Hypothesis를 하나로 섞지 않는다.

### 3.2 Event Evidence Bundle

Event Evidence Bundle은 Evidence의 단일 기준 구조로 유지한다.

모든 Cause Candidate는 아래 3가지를 유지해야 한다.

- supporting evidence
- contradicting evidence
- missing evidence

External Evidence는 이 Bundle에 포함되는 하위 Evidence다. 별도 Truth System을 만들지 않는다.

### 3.3 Root 선언

기본값은 아래와 같다.

```text
rootDeclared=false
```

External Candidate, 날짜 겹침, 강한 signal만으로 Root Cause를 선언하지 않는다.

### 3.4 Recommendation과 Decision

Recommendation과 Human Decision은 분리한다.

시스템은 조사 또는 실행을 제안할 수 있다. 수락, 기각, 보류, Root 선언은 사람이 결정한다.

## 4. Core Architecture

External Intelligence는 내부 조사가 실패한 뒤 실행되는 fallback이 아니다.

Phase 8의 기본 구조는 아래와 같다.

```text
Internal Investigation
        <-> Historical Comparison
        <-> External Context
                  |
                  +-- Trigger -> External Deep Investigation
```

Internal, Historical, External Context는 병렬 Context Lane이다.

External Deep Investigation은 더 깊고 비용이 큰 조사 계층이다. 명시적인 Trigger가 있을 때만 조사 깊이를 확장한다.

## 5. External Context와 External Deep Investigation

### 5.1 External Context

External Context는 WHY 분석 중 기본적으로 관찰 가능한 가벼운 외부 맥락 계층이다.

Source availability와 coarse external signal status를 포함할 수 있다. 외부 source가 없는 경우에도 그 상태를 숨기지 않는다.

허용 상태:

- AVAILABLE
- PARTIAL
- NOT_AVAILABLE
- UNKNOWN
- DESIGN_REQUIRED

External Context는 L1 또는 L2에서 availability나 signal status로 표시될 수 있다. 단독으로 Cause를 만들 수 없다.

### 5.2 External Context 6-key 최소 계약

Phase 1~7 SoT에는 External Context Status가 "항상 6키"로 정의되어 있다.

기존 6키:

- MARKET_DEMAND
- COMPETITOR
- POLICY
- NEWS
- WEATHER
- HOLIDAY

기존 SoT의 현재 상태값:

| Key | SoT Status | 의미 |
| --- | --- | --- |
| MARKET_DEMAND | PARTIAL | DataLab 실시간만 있음 |
| COMPETITOR | PARTIAL | SERP mall 점유만 있음 |
| POLICY | NOT_AVAILABLE | 정책 변화 로그 없음 |
| NEWS | NOT_AVAILABLE | 뉴스/소셜 시계열 없음 |
| WEATHER | NOT_AVAILABLE | 날씨 source 없음 |
| HOLIDAY | NOT_AVAILABLE | 공휴일/명절/calendar source 없음 |

Phase 8은 이 6키를 삭제하거나 rename하지 않는다. 다만 Architecture-level 최소 구조를 아래처럼 확정한다.

```text
ExternalContextItem
  key
  sourceType
  availability
  signalStatus
  observedAt
  scope
  evidenceStatus
  limitation
```

필드 의미:

| Field | 의미 | 필수 여부 |
| --- | --- | --- |
| key | 6키 중 하나. MARKET_DEMAND / COMPETITOR / POLICY / NEWS / WEATHER / HOLIDAY | required |
| sourceType | 외부 source 분류. Source Taxonomy와 연결 | required |
| availability | AVAILABLE / PARTIAL / NOT_AVAILABLE / UNKNOWN / DESIGN_REQUIRED | required |
| signalStatus | NO_SIGNAL / SIGNAL_OBSERVED / SIGNAL_RELEVANT / SIGNAL_CONFLICTING / UNKNOWN / NOT_CHECKED | required |
| observedAt | Context가 관찰되거나 평가된 시점. source가 없으면 null 가능 | optional |
| scope | 관련 market / product / keyword / channel / region / platform 범위 | required |
| evidenceStatus | NONE / PARTIAL / SUPPORTING / CONTRADICTING / MISSING / INSUFFICIENT | required |
| limitation | 원인으로 해석할 수 없는 제한 사유 | required |

최소 규칙:

- 6키는 항상 존재해야 한다.
- source가 없어도 항목을 생략하지 않는다.
- NOT_AVAILABLE은 원인이 아니라 source boundary다.
- PARTIAL은 candidate가 아니라 제한된 관찰 가능 상태다.
- signalStatus가 SIGNAL_OBSERVED여도 rootDeclared는 false다.
- L1/L2에서는 6키 상태를 보여줄 수 있지만, Candidate는 Event Evidence Bundle 규칙을 통과해야 한다.
- `evidenceStatus`의 SUPPORTING / CONTRADICTING은 Event Evidence Bundle의 특정 Candidate와 연결된 경우에만 사용한다.
- Candidate linkage가 없는 External Context 단계에서는 NONE / PARTIAL / MISSING / INSUFFICIENT / UNKNOWN만 사용한다.
- Runtime JSON schema, DB column, API response shape는 이 문서에서 확정하지 않는다.

이로써 External Context 6-key는 Architecture Contract로 닫는다. 구현 직렬화 방식은 이후 implementation phase에서 결정한다.

### 5.3 6-key와 Source Taxonomy의 관계

External Context 6-key는 WHY 분석에서 관찰하는 외부 축이다.

External Source Taxonomy는 Evidence source의 분류다.

둘은 1:1 관계를 강제하지 않는다.

매핑 원칙:

- 하나의 External Context Key는 하나 이상의 Source Type에서 Evidence를 받을 수 있다.
- 하나의 Source Type은 상황에 따라 하나 이상의 External Context Key에 연결될 수 있다.
- Source Taxonomy 항목 자체가 새로운 External Context Key를 생성하지 않는다.
- External Context Key는 Phase 1~7 SoT의 6키를 유지한다.

예시:

| External Context Key | 연결 가능한 Source Type 예시 | 비고 |
| --- | --- | --- |
| MARKET_DEMAND | Market Demand, Calendar / Holiday / Seasonality | 수요 변화와 시즌성 signal |
| COMPETITOR | Competitor | SERP mall, 경쟁 상품, 향후 가격/프로모션 source |
| POLICY | Government / Regulation / Policy, Commerce Platform / Naver Ecosystem Change | 정책·플랫폼 변경 source |
| NEWS | News / Social Issue | 뉴스, 사회 이슈, 평판 signal |
| WEATHER | Weather / Environment | 날씨·환경 signal |
| HOLIDAY | Calendar / Holiday / Seasonality | 공휴일·명절·시즌 calendar signal |

`Platform Incident / Service Degradation`은 기본적으로 외부 원인 축이라기보다 data-quality / system-health evidence로 취급한다.

다만 플랫폼 장애가 내부 KPI 또는 수집 결과에 영향을 주는 독립 사건으로 관찰되는 경우, 관련된 6-key의 missingEvidence 또는 contradictingEvidence로 연결할 수 있다. 이때도 새 External Context Key를 만들지 않는다.

### 5.4 External Deep Investigation

External Deep Investigation은 확장 조사 계층이다.

Source별 조회, 더 강한 Evidence, entity binding, Human review가 필요할 수 있다. Trigger 기반으로만 실행한다.

예상 Trigger class:

- 복수 SKU 또는 전체 SKU 이상
- Historical baseline 이탈
- 내부 Candidate 설명력 부족
- External Context signal 발견
- Internal Evidence와 External signal의 모순
- Missing Evidence가 External Source로만 확인 가능한 경우
- Human Decision 전 외부 확인이 필요한 경우

Trigger는 조사 깊이를 허용할 뿐 Root 선언을 허용하지 않는다.

## 6. External Source Taxonomy v1

| Source Type | 목적 | 관련 내부 KPI / 도메인 | Entity Scope | Time Scope | 현재 확보 가능성 | Architecture Status | Current Implementation Status | Evidence 제한 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Calendar / Holiday / Seasonality | 요일 baseline 밖의 달력·시즌 충격 설명 | Sales, conversion, demand, collection anomaly | date, region, market, campaign period | day, week, season | holiday/calendar 테이블 없음 | OPEN | NOT_AVAILABLE | 요일은 내부 계산 가능하나 공휴일/명절은 검증 불가 |
| Weather / Environment | 환경·날씨 기반 수요 또는 물류 영향 설명 | Sales, traffic proxy, Q&A, reviews, purchase keywords | region, product category, date | day, event window | weather source 없음 | OPEN | NOT_AVAILABLE | 내부 움직임으로 날씨를 추론하지 않음 |
| Market Demand | 시장 검색량 또는 수요 변화 탐지 | SKU sales, organic rank, purchase keyword, SA keyword | keyword, category, demographic | day, week, month | DataLab / keyword insight 존재, 일별 market fact 없음 | PARTIAL | PARTIAL | realtime/API snapshot은 적재된 evidence series가 아님 |
| News / Social Issue | 사회 이슈, 뉴스 충격, 평판, 카테고리 이슈 탐지 | Sales, reviews, Q&A, keyword demand | brand, keyword, category, event | event window | news/social source 없음 | OPEN | NOT_AVAILABLE | source가 없으면 주장하지 않음 |
| Government / Regulation / Policy | 규제 또는 공공 정책 변화 탐지 | ad operations, platform restrictions, product demand | product category, channel, market | effective date, notice date | policy log source 없음 | OPEN | NOT_AVAILABLE | KPI 움직임으로 정책을 추정하지 않음 |
| Competitor | 경쟁사 노출, SERP 점유, 프로모션, 가격 압력 탐지 | organic rank, ad rank, sales, GFA/SA efficiency | keyword, SERP mall, competitor product | day, week | SERP mall 데이터와 제한적 competitor 테이블 존재 | PARTIAL | PARTIAL | 프로모션, 가격, 광고비, 배송 변화는 없음 |
| Commerce Platform / Naver Ecosystem Change | 커머스·검색·광고 플랫폼 생태계 변화 탐지 | rank, ad delivery, collection health, conversion | platform, menu, keyword, ad account | event window | explicit ecosystem change source 없음 | OPEN | DESIGN_REQUIRED | 플랫폼 변화는 가정하지 않음 |
| Platform Incident / Service Degradation | source/API/collector 또는 플랫폼 장애 탐지 | data freshness, collection success, missing data | source, collector, endpoint, task | minute, hour, day | collection job status 존재, 외부 incident source 없음 | PARTIAL | PARTIAL | collector failure가 곧 platform incident는 아님 |

## 7. External Trigger Contract v1

External Trigger는 두 계층으로 구분한다.

### 7.1 Layer 1 - External Context

External Context는 모든 WHY 분석 중 관찰될 수 있다.

답해야 하는 질문:

- 이 축에 외부 source가 있는가
- 이미 알려진 external signal이 있는가
- 해당 축이 NOT_AVAILABLE인가
- 확인하지 않았기 때문에 UNKNOWN인가

Layer 1은 단독으로 Candidate를 만들지 않는다.

### 7.2 Layer 2 - External Deep Investigation

Deep Investigation은 최소 하나 이상의 Trigger가 있을 때 시작할 수 있다.

| Trigger | 의미 | Deep Investigation 허용 여부 |
| --- | --- | --- |
| multi_entity_anomaly | 여러 SKU, keyword, campaign, room이 함께 움직임 | yes |
| historical_out_of_band | 요일 또는 historical baseline을 벗어남 | yes |
| internal_explanation_weak | 내부 Candidate가 변화량 또는 방향을 충분히 설명하지 못함 | yes |
| external_signal_observed | 외부 Context source에서 관련 signal이 이미 관찰됨 | yes |
| evidence_conflict | Internal Candidate와 External signal이 모순됨 | yes |
| missing_external_evidence | Missing Evidence가 외부 source에서만 해결 가능함 | yes |
| human_decision_requires_context | Human Decision 전에 외부 검증이 필요함 | yes |

Deep Investigation은 External Root Cause를 뜻하지 않는다.

## 8. External Evidence Bundle Contract v1

External Evidence는 기존 Event Evidence Bundle에 연결된다.

필수 필드:

| Field | 의미 |
| --- | --- |
| source | source 이름 또는 source type |
| event / observation | 외부 event 또는 관찰 signal |
| observedAt | signal 관찰 또는 기록 시점 |
| impactWindow | 영향 가능 기간 |
| entityScope | market, product, keyword, channel, platform, region |
| expectedImpactDirection | 예상 영향 방향 |
| relationToInternalObservation | before, concurrent, after, unclear |
| supportingEvidence | 관련성을 지지하는 evidence |
| contradictingEvidence | 관련성을 반박하는 evidence |
| missingEvidence | 필요하지만 없는 evidence |
| sourceReliability | source 신뢰도 |
| evidenceStrength | evidence 강도 |
| causalityLimitation | 아직 cause로 볼 수 없는 이유 |

허용 External Evidence 상태:

- external_signal_observed
- relevant_external_candidate
- supporting_external_evidence
- contradicting_external_evidence
- missing_external_evidence
- insufficient_evidence
- external_unknown

## 9. Candidate, Contradiction, Missing Evidence 규칙

External signal 발견은 Root Cause 발견이 아니다.

아래 구분은 필수다.

```text
Related != Cause
Temporal overlap != Cause
External Candidate != Root Cause
Recommendation != Human Decision
```

Signal strength가 높아도 External Candidate는 hypothesis로 남을 수 있다.

모든 External Candidate는 아래를 가져야 한다.

- 왜 관련 가능성이 있는가
- 무엇이 지지하는가
- 무엇이 반박하는가
- 무엇이 없는가
- 무엇이 있어야 승격 또는 기각할 수 있는가

## 10. Causality Guard v1

External Candidate가 Root 평가에 기여하려면 아래를 확인해야 한다.

- temporal order
- impact window
- entity scope match
- expected impact direction
- historical pattern
- internal counter evidence
- external counter evidence
- alternative candidate
- missing evidence

Evidence가 부족하면 아래를 유지한다.

```text
rootDeclared=false
```

그리고 external item은 candidate, hypothesis, unknown 중 하나로 분류한다.

## 11. EXTERNAL_STOP Operational Interpretation

이 문서는 Phase 3의 EXTERNAL_STOP 계약을 삭제, rename, 또는 소급 변경하지 않는다.

Phase 8은 그 operational interpretation을 명확히 한다.

EXTERNAL_STOP은 아래를 의미하지 않는다.

```text
external cause confirmed
```

EXTERNAL_STOP은 아래 중 하나 이상을 의미한다.

- external source가 없음
- evidence가 부족함
- 현재 source boundary 안에서 deep investigation을 진행할 수 없음
- 현재 investigation boundary에 도달함
- 원인을 만들어내는 대신 UNKNOWN을 유지해야 함

EXTERNAL_STOP은 Internal, Historical, External Context에서 확인한 fact를 보존한 채 UNKNOWN으로 전이할 수 있다.

## 12. INTERNAL_QUIET_EXTERNAL_UNKNOWN

기존 상태는 유지한다.

이 상태는 최소한 아래를 설명할 수 있어야 한다.

- Internal Investigation에서 확인한 것
- Historical Comparison에서 확인한 것
- External Context에서 확인한 것
- 사용 불가능한 External Source
- 여전히 UNKNOWN인 External Source
- Root Cause를 선언하지 않는 이유
- Deep Investigation 필요 여부
- Human Handoff 필요 여부
- Human에게 넘겨야 할 질문

UNKNOWN은 유효한 분석 결과다. 실패가 아니다.

## 13. Human Handoff Contract v1

Human Handoff는 단순한 "확인 필요" 메시지가 되어서는 안 된다.

가능하면 아래 구조를 가진다.

- Observation
- Candidate
- Supporting Evidence
- Contradicting Evidence
- Missing Evidence
- Open Question
- Suggested next human action

Human Handoff가 필요한 경우:

- External Evidence가 서로 충돌
- source reliability가 약함
- market 또는 competitor context 해석 필요
- policy scope가 불명확
- internal KPI 방향과 external signal 방향이 맞지 않음
- missing evidence가 root 선언을 막음
- decision risk가 높음

시스템은 추천할 수 있다. 결정은 사람이 한다.

## 14. Sub Situation Room 연결

Phase 8은 독립 External Situation Room을 먼저 만들지 않는다.

External Intelligence는 기존 L1~L4 정보 밀도 안에 표현된다.

| Level | External 역할 | 금지 |
| --- | --- | --- |
| L1 | availability/status chip, signal 존재, UNKNOWN marker | root statement, invented external cause |
| L2 | external context summary, signal count, missing external source | deep evidence wall, fake candidate |
| L3 | 실제 external candidate가 있을 때 candidate evidence | candidate가 0인데 L3를 여는 것 |
| L4 | source pointer, raw provenance, query/source metadata | 새 dashboard 또는 fabricated raw data |

Stop 상태에서는 화면 표시를 위해 Candidate를 만들지 않는다.

## 15. OPEN and HOLD

### 15.1 OPEN

| 항목 | 현재 처리 |
| --- | --- |
| External Context runtime serialization / API response shape | IMPLEMENTATION_DECISION_REQUIRED |
| Market Demand acquisition/storage choice | IMPLEMENTATION_DECISION_REQUIRED |
| Competitor intelligence scope | IMPLEMENTATION_DECISION_REQUIRED |

### 15.2 HOLD

아래는 범위 밖으로 유지한다.

- External API implementation
- weather API
- news/social API
- competitor crawler
- policy crawler
- platform incident monitor
- new DB table
- new runtime API
- External Situation Room UI
- mock external data
- automatic external root decision engine

## 16. Phase 3~4 호환성

아래가 유지되면 Phase 8은 Phase 3~4와 호환된다.

- WHY flow 유지
- Event Evidence Bundle이 evidence truth structure로 유지
- Candidate cardinality rule 유지
- Stop state는 candidate 0 가능
- Supporting, contradicting, missing evidence 유지
- rootDeclared 기본값 false 유지
- Human Decision과 Recommendation 분리
- External Evidence는 별도 truth system이 아니라 sub-evidence

## 17. Phase 5~7 호환성

아래가 유지되면 Phase 8은 Phase 5~7과 호환된다.

- L1은 압축 표시이며 Root를 선언하지 않음
- L2는 context와 candidate summary 표시
- L3는 선택된 candidate evidence만 열림
- L4는 raw source/provenance를 가리킴
- Sub Situation Room은 Candidate를 생성하지 않음
- Related / Chain은 Root가 아님
- External Unknown을 숨기지 않음
- Decision rail은 Human 소유

## 18. Current Implementation Snapshot - 2026-08-20

| Source Area | Architecture Status | Current Repository Implementation Status |
| --- | --- | --- |
| Internal Sales / SKU / Organic / SA / GFA / Review / Q&A / Index | Phase 1~7에서 DEFINED | 도메인별 PARTIAL~IMPLEMENTED |
| Historical weekday / 4-week baseline | DEFINED | PARTIAL |
| Event Evidence Bundle contract | DEFINED | NOT_AVAILABLE |
| External Context 6-key status | DEFINED | NOT_AVAILABLE |
| Market Demand | PARTIAL | PARTIAL |
| Competitor SERP | PARTIAL | PARTIAL |
| Holiday / Calendar | OPEN | NOT_AVAILABLE |
| Weather | OPEN | NOT_AVAILABLE |
| News / Social | OPEN | NOT_AVAILABLE |
| Government / Platform Policy | OPEN | NOT_AVAILABLE |
| Human Decision Rail | DEFINED | PARTIAL |
| Sub Situation Room L1~L4 | DEFINED | NOT_AVAILABLE |

## 19. Self-Check

| Check | Result |
| --- | --- |
| External을 fallback-only로 만들지 않았는가 | PASS |
| Internal / Historical / External 병렬 구조를 유지했는가 | PASS |
| External Evidence를 별도 Truth System으로 만들지 않았는가 | PASS |
| Related를 Cause로 승격하지 않았는가 | PASS |
| Temporal overlap을 Cause로 취급하지 않았는가 | PASS |
| rootDeclared=false 기본값을 유지했는가 | PASS |
| UNKNOWN을 유효한 결과로 허용했는가 | PASS |
| External Context 6-key 최소 Architecture Contract를 확정했는가 | PASS |
| 6-key와 Source Taxonomy의 관계를 관찰 축과 source 분류로 구분했는가 | PASS |
| Context 단계의 evidenceStatus와 Candidate Evidence의 경계를 분리했는가 | PASS |
| 기존 EXTERNAL_STOP을 삭제하거나 소급 변경하지 않았는가 | PASS |
| Architecture와 현재 repo 구현 상태를 분리했는가 | PASS |
| 없는 source/API/DB/UI를 구현된 것으로 표현하지 않았는가 | PASS |
| 구현 선택을 조기에 확정하지 않았는가 | PASS |
| Runtime code / DB / API / UI / runner를 수정하지 않았는가 | PASS |
| Phase 8에서 이 문서 외 추가 산출물을 만들지 않았는가 | PASS |

## 20. 최종 권고

Phase 8 External Intelligence Architecture v1은 `LOCKED` 상태다.

6-key External Context, Source Taxonomy mapping semantics, Candidate-linked evidenceStatus 경계가 Architecture 수준에서 정리되었고, 사용자 검토 승인으로 Phase 8 design contract를 닫는다.

Phase 8 승인 이후에도 즉시 runtime implementation으로 넘어가지 않는다. 다음 판단은 Phase 1~8 architecture contract를 어떤 순서로 repository implementation phase에 이식할지, 그리고 이 계약이 Keyword / Organic, SA, GFA Sub Situation Room 설계에 어떤 영향을 주는지 정하는 것이다.
