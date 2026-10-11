# Phase 9 - Architecture-to-Repository Implementation Mapping v1

상태: LOCKED
범위: Read-only Audit 기반 구현 경계 매핑
기준 SoT:
- `c:\Users\김명수\Desktop\ai-analytics Phase1_7.html`
- `docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`
작성일: 2026-08-20
Lock 기준: 사용자 검토 승인, 2026-08-20 11:32 KST

## 0. 실행 계약

이 문서는 Phase 1~8 Architecture Contract를 현재 repository 구현 상태에 매핑하는 문서다.

이번 Phase에서는 새 Architecture를 만들지 않는다.

이번 Phase에서는 런타임 코드, DB, API, UI, 수집기, Runner, WHY Engine을 수정하지 않는다.

허용 산출물은 아래 문서 1개다.

`docs/ai-situation-room/phase9-architecture-to-repository-implementation-mapping-v1.md`

## 1. 목적

Phase 9의 목적은 구현 Sprint를 바로 시작하는 것이 아니라, Phase 1~8 계약을 실제 repository에 어떤 순서로 이식할지 결정할 수 있도록 경계를 닫는 것이다.

핵심 질문:

- Phase 1~8 Contract 중 현재 repo에 이미 존재하는 것은 무엇인가
- 부분 구현된 것은 무엇인가
- 미구현은 무엇인가
- 기존 AI Ops / A-1 / Trace / action queue 중 무엇을 재사용할 수 있는가
- 무엇을 확장해야 하는가
- 무엇을 새로 만들어야 하는가
- 무엇을 HOLD해야 하는가
- 첫 번째 실제 Vertical Slice는 무엇인가

## 2. 현재 전체 판정

현재 repo는 분석 재료를 많이 가지고 있다.

이미 존재하는 주요 자산:

- AI Ops Center
- A-1 automation
- A-1 Trace / Trace Explorer
- action queue / 일부 human review
- sales / ads / GFA / rank / review / Q&A / index / collection fact
- DataLab / keyword insight 일부
- competitor SERP / tracked competitor 일부
- collection status
- menu sync

하지만 Phase 1~8이 정의한 판단 계약 객체와 실행 흐름은 아직 runtime에 이식되지 않았다.

미구현 핵심:

- 37 WHY runtime registry
- WHY orchestration
- Event Evidence Bundle 6-block runtime contract
- supporting / contradicting / missing evidence runtime contract
- External Context 6-key runtime output
- rootDeclared / causality guard runtime
- L1~L4 Sub Situation Room
- Executive / Sub Situation Room routes

따라서 현재 상태는 아래와 같다.

```text
Data primitives: strong
AI Ops / A-1 assets: strong
Situation Room decision contract runtime: not yet implemented
```

## 3. 구현 판단 원칙

새로운 Phase 1~8 Architecture를 기존 AI Ops / A-1과 별도 시스템으로 만들지 않는다.

모든 항목은 아래 순서로 판단한다.

```text
REUSE
  -> EXTEND
  -> NEW
  -> HOLD
```

의미:

- REUSE: 기존 구현을 그대로 사용
- EXTEND: 기존 구현을 확장
- NEW: 새 runtime contract 또는 화면/API가 필요
- HOLD: 현재 구현하지 않음

중요:

AI Ops Center와 A-1 Trace는 폐기 대상이 아니다. Phase 1~8 계약을 repository에 이식할 때 우선 재사용하거나 확장해야 할 자산이다.

## 4. 구현 순서

최종 구현 순서는 아래 7개 Block으로 고정한다.

```text
1. Identity / Quality / Baseline Foundation
        ↓
2. Evidence Bundle + WHY 최소 Runner
   + Minimal Causality Guard
        ↓
3. External 6-key Boundary Runtime
        ↓
4. SKU P01 Vertical Slice
   + Minimal Human Handoff Contract
        ↓
5. Human Decision Rail 연결
        ↓
6. External Deep Investigation
   + Advanced External Causality
        ↓
7. Keyword/Organic → SA → GFA 확장
```

주의:

Causality Guard 전체를 External Deep Investigation 단계까지 미루지 않는다.

첫 Evidence Bundle runtime부터 최소한 아래 Guard가 적용되어야 한다.

- rootDeclared=false
- Related != Cause
- Temporal overlap != Cause
- Candidate != Root
- Recommendation != Decision

External source 연결 이후에 필요한 더 정교한 impactWindow, entity scope, counter evidence, source reliability 평가는 Block 6의 Advanced External Causality에서 확장한다.

## 5. Contract Mapping Matrix

### 5.1 Identity / Quality / Baseline

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| SKU 7 hub | Phase 2 | commerce sales, URL/product rows | SKU scope registry 없음 | EXTEND | current fact coverage |
| URL / product identity bridge | Phase 1~2 | product_url, channel product_id, A-1 관련 map 일부 | unified cross-domain bind 없음 | EXTEND | SKU hub |
| Keyword coverage class | Phase 2 | SA/Organic/Purchase fact 존재 | CORE56 등 class runtime 없음 | NEW | keyword overlap audit |
| Forbidden join guard | Phase 1~4 | 설계 SoT에 존재 | runtime validation 없음 | NEW | identity bridge |
| Weekday / 4-week baseline | Phase 2~3 | 일부 trend/baseline primitive | 공통 baseline service 없음 | EXTEND | date coverage |
| Data quality / freshness gate | Phase 2~3 | collection_job_run, task status | WHY health gate 없음 | EXTEND | collection status |

### 5.2 Decision Contract Runtime Foundation

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| 37 WHY registry | Phase 3 | 없음 | runtime registry 없음 | NEW | identity/quality |
| WHY 최소 Runner | Phase 3 | A-1 runner, AI Ops rebuild 패턴 | Phase 3 step orchestration 없음 | EXTEND / NEW | WHY registry |
| Event Evidence Bundle | Phase 4 | evidence_json 일부, A-1 trace blob | 6-block Bundle contract 없음 | NEW CONTRACT | WHY runner |
| Candidate evidence 3종 | Phase 4 | evidence_json 일부 | supporting/contradicting/missing 구조 없음 | NEW | Event Bundle |
| Candidate cardinality | Phase 4 | 없음 | Stop 시 candidate=0 validation 없음 | NEW | Event Bundle |
| Stop / UNKNOWN | Phase 3~4, Phase 8 | 일부 status 개념 | IN_BAND/HEALTH/EXTERNAL_STOP 등 runtime enum 없음 | NEW | Bundle conclusionClass |
| Minimal Causality Guard | Phase 4~8 | 없음 | rootDeclared/Related/Candidate 경계 없음 | NEW | Event Bundle |

### 5.3 External 6-key Boundary Runtime

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| External Context 6-key | Phase 4, Phase 8 | DataLab, competitor 일부 | 항상 6-key output 없음 | NEW | Event Bundle |
| ExternalContextItem | Phase 8 | 없음 | runtime DTO 없음 | NEW | 6-key contract |
| MARKET_DEMAND | Phase 2, Phase 8 | DataLab / keyword insight | Bundle 연결 없음 | EXTEND | 6-key DTO |
| COMPETITOR | Phase 2, Phase 8 | naver_product_rank_daily, tracked_competitor_product | Bundle 연결 제한적 | EXTEND | 6-key DTO |
| POLICY / NEWS / WEATHER / HOLIDAY | Phase 8 | 없음 | NOT_AVAILABLE boundary만 가능 | NEW boundary only | 6-key DTO |

### 5.4 SKU P01 Vertical Slice

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| P01 SKU 매출 하락 WHY | Phase 3 | sales, organic, purchase, SA, GFA, review, Q&A, index facts | P01 runner 없음 | NEW slice | Block 1~3 |
| Sales decomposition | Phase 3 | sales fact | Bundle block 연결 없음 | EXTEND | baseline |
| Organic / Purchase / SA / VOC / Index evidence | Phase 3 | 각 도메인 facts | Candidate evidence 연결 없음 | EXTEND | Event Bundle |
| External UNKNOWN / NOT_AVAILABLE 표시 | Phase 8 | 6-key boundary 예정 | UI 연결 없음 | NEW | External boundary |
| L1~L4 drill | Phase 5~7 | AI Ops cards, A-1 trace UI patterns | Sub Room UI 없음 | NEW / EXTEND UI patterns | Bundle |
| Minimal Human Handoff | Phase 8 | action_queue / A-1 review 참고 가능 | Full Decision Rail 없이 handoff payload만 필요 | NEW minimal contract | Event Bundle |

### 5.5 Human Decision Rail

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| Recommendation vs Decision separation | Phase 3~5 | AI Ops recommendation/action_queue | L1/L3 placement 규칙 미적용 | EXTEND | SKU slice |
| Human Handoff | Phase 8 | action_queue note/status, A-1 review | Observation/Candidate/Evidence/Open Question payload 없음 | EXTEND | Event Bundle |
| rootDeclared approval | Phase 4~8 | action_queue approval 개념 | rootDeclared field/workflow 없음 | NEW | Minimal Causality Guard |
| Decision audit | Phase 5~8 | ai_decision_log, action_queue | Situation Room decision audit 없음 | EXTEND | decision rail |

### 5.6 External Deep Investigation

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| Deep Investigation triggers | Phase 8 | 없음 | trigger controller 없음 | NEW | External boundary |
| Advanced External Causality | Phase 8 | 없음 | impactWindow/entityScope/sourceReliability 평가 없음 | NEW | external sources |
| Market Demand acquisition/storage | Phase 8 OPEN | DataLab API | 실시간 vs daily fact 결정 필요 | HOLD / IMPLEMENTATION_DECISION_REQUIRED | Phase 9 이후 |
| Competitor intelligence scope | Phase 8 OPEN | SERP mall, tracked competitor | 가격/프로모션/광고/배송 범위 미결정 | HOLD / IMPLEMENTATION_DECISION_REQUIRED | Phase 9 이후 |
| Weather / News / Holiday / Policy source | Phase 8 | 없음 | source 없음 | HOLD | source decision |

### 5.7 Keyword/Organic → SA → GFA 확장

| Contract | Architecture SoT | Repo Asset | Gap | Action | Dependency |
| --- | --- | --- | --- | --- | --- |
| Keyword/Organic room | Phase 6 | rank, keyword facts, A-1 organic UI | Phase 6 room skeleton 없음 | NEW after SKU | SKU slice validated |
| SA room | Phase 6 | ad keyword/searchword facts, AI Ops ads | L1~L4 situation room 없음 | NEW / EXTEND AI Ops Ads | Event Bundle |
| GFA room | Phase 6 | GFA perf/detail, creative analysis | L1~L4 situation room 없음 | NEW / EXTEND GFA assets | Event Bundle |
| Cross-room chain | Phase 4~6 | 없음 | Related/Chain graph 없음 | NEW | multiple room bundles |

## 6. First Vertical Slice

첫 Vertical Slice는 아래로 고정한다.

```text
SKU P01 - 왜 이 SKU 매출이 떨어졌나?
```

선정 이유:

- SKU 7 hub가 가장 강하다.
- Phase 7 SKU mockup이 이미 존재한다.
- sales decomposition이 가능하다.
- Organic / Purchase / SA / Review / Q&A / Index 연결성이 좋다.
- External 실데이터가 없어도 6-key boundary 상태를 표시할 수 있다.
- Event Evidence Bundle, Minimal Causality Guard, L1~L4, Human Handoff를 가장 작은 단위로 검증할 수 있다.

## 7. First Vertical Slice 완료 기준

완료 기준은 화면 표시가 아니라 계약 준수다.

최소 완료 조건:

- 1 SKU
- 1 analysis window
- weekday baseline
- 4-week baseline
- sales decomposition
- Event Evidence Bundle 생성
- Candidate 0~N 허용
- supporting / contradicting / missing evidence 존재
- External 6-key 항상 출력
- source가 없으면 NOT_AVAILABLE / UNKNOWN 유지
- rootDeclared=false 기본
- Related != Cause
- Temporal overlap != Cause
- Candidate != Root
- Recommendation != Decision
- L1 → L2 → L3 → L4 추적 가능
- Minimal Human Handoff 가능
  - Observation
  - Candidate
  - Supporting / Contradicting / Missing
  - Open Question
  - handoff 상태 생성
- 사용 가능한 source가 없을 때 원인을 만들지 않고 STOP / UNKNOWN 가능

주의:

Block 4의 Minimal Human Handoff는 Full Human Decision Rail이 아니다.

Block 4에서는 사람에게 넘길 구조화된 handoff payload를 만들 수 있으면 충분하다. 수락, 기각, 보류, rootDeclared approval, Decision audit, action_queue workflow 완성은 Block 5의 책임이다.

## 8. Reuse Targets

Phase 9 이후 구현에서는 아래 기존 자산을 우선 재사용한다.

| Repo Asset | Reuse Direction |
| --- | --- |
| AI Ops Center | 판단 카드, action queue, domain UI 패턴 재사용 |
| A-1 Trace / Trace Explorer | Evidence provenance, trace verification, raw drilldown 패턴 재사용 |
| evidence_json fields | Event Bundle로 직접 쓰지는 않되 migration/reference source로 활용 |
| action_queue | Human Decision Rail의 초기 연결 지점 |
| ai_decision_log | decision audit 확장 후보 |
| collection_job_run / collection_job_event | data freshness / source health gate |
| DataLab keyword insights | MARKET_DEMAND PARTIAL source |
| naver_product_rank_daily / tracked_competitor_product | COMPETITOR PARTIAL source |
| Menu Sync / Collection reconcile | local/NAS 데이터 상태 반영 보조 자산 |

## 9. HOLD Boundary

Phase 9 이후 첫 구현 전에도 아래는 HOLD다.

- External weather API
- news/social API
- holiday/calendar DB
- policy crawler
- competitor price/promotion crawler
- external root auto decision
- full WHY Engine for all 37 WHYs
- full Executive Situation Room
- Keyword/SA/GFA room full implementation before SKU slice validation

## 10. Phase 9 결론

Phase 9는 `LOCKED` 상태다.

핵심 판단:

- 분석 재료는 충분히 강하다.
- 판단 계약 객체는 runtime에 아직 없다.
- 첫 구현은 화면부터가 아니라 Contract Runtime Foundation부터 시작해야 한다.
- Minimal Causality Guard는 첫 Evidence Bundle runtime부터 포함해야 한다.
- External Deep Investigation과 Advanced External Causality는 이후 source 확장 단계로 미룬다.
- 첫 사용자-facing Vertical Slice는 SKU P01이 가장 합리적이다.

## 11. 다음 단계

사용자 검토 승인으로 Phase 9를 LOCK한다.

그 다음 단계는 구현이 아니라 첫 구현 Sprint의 범위를 결정하는 것이다.

추천 첫 구현 Sprint:

```text
Block 1 + Block 2 최소형

Identity / Quality / Baseline Foundation
+ Event Evidence Bundle 최소 runtime
+ WHY Registry 최소형
+ Minimal Causality Guard
```

그 다음 순서:

```text
Block 3 External 6-key Boundary Runtime
        ↓
Block 4 SKU P01 Vertical Slice
        + Minimal Human Handoff Contract
```

Block 3 없이 SKU P01 Vertical Slice로 넘어가지 않는다. P01 완료 조건에는 External 6-key 항상 출력과 NOT_AVAILABLE / UNKNOWN boundary 표시가 포함되기 때문이다.
