# Block 1 + Block 2 Minimal Implementation Scope Lock v1

상태: LOCKED
범위: 첫 구현 Sprint 범위 고정 문서
기준 SoT:
- `docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`
- `docs/ai-situation-room/phase9-architecture-to-repository-implementation-mapping-v1.md`
- Block 1 + Block 2 Read-only Audit 결과
작성일: 2026-08-20
Lock 기준: 사용자 검토 승인, Existing Program Integration & Menu Placement Lock 완료 후 2026-08-20 14:59 KST

## 0. 실행 계약

이번 문서는 첫 실제 구현 Sprint의 범위를 LOCK하기 위한 문서다.

아직 구현하지 않는다.

이번 작업에서 허용되는 것은 Scope Lock 문서 작성뿐이다.

다음은 수정하지 않는다.

- runtime code
- DB schema/data
- API runtime
- UI
- Runner
- AI Ops
- A-1
- Trace
- action_queue
- collection logic
- Phase 8 LOCKED 문서
- Phase 9 LOCKED 문서

Git add / commit도 하지 않는다.

## 1. 목적

이번 문서의 목적은 다음 첫 구현 Sprint에서 아래를 정확하게 고정하는 것이다.

- 무엇을 실제로 구현하는가
- 어떤 기존 asset을 재사용하는가
- 어떤 기존 파일을 확장하는가
- 어떤 신규 파일이 필요한가
- 어떤 파일은 건드리지 않는가
- persistence를 어디까지 허용하는가
- 완료를 무엇으로 판정하는가
- 언제 Block 3으로 넘어갈 수 있는가

목표는 전체 Foundation 완성이 아니다.

목표는 Block 3 External 6-key Boundary Runtime을 거쳐 SKU P01 Vertical Slice로 안전하게 진입할 수 있는 최소 Block 1 + Block 2 runtime foundation이다.

## 2. 구현 원칙

모든 판단은 Phase 9의 순서를 따른다.

```text
REUSE
  -> EXTEND
  -> NEW
  -> HOLD
```

기존 자산과 동일 기능을 가진 새로운 병렬 시스템을 만들지 않는다.

우선 재사용/확장 대상으로 보는 기존 자산:

- `A1SkuMap`
- `DecisionProductHealthDaily`
- collection hub
- URL canonicalization
- AI Ops freshness
- A-1 batch pattern
- A-1 trace store
- AI Ops product-health rebuild pattern
- `ai_decision_log`
- `action_queue`

단, 위 자산을 Phase 1~9 계약을 이미 충족하는 구현체라고 간주하지 않는다.

## 3. Block 1 LOCK 범위

Block 1은 P01 진입에 필요한 Identity / Quality / Baseline 최소 runtime foundation만 포함한다.

| Contract | Scope | Action | Implementation Owner | Status |
| --- | --- | --- | --- | --- |
| SKU Scope Registry | P01 canonical SKU identity와 분석 대상 scope | NEW | `api/sku_identity.py` | LOCKED |
| Identity Bridge | `sku_id`, `product_url`, catalog product id, channel product id 연결 | NEW + EXTEND | `api/sku_identity.py` | LOCKED |
| Forbidden Join Guard | P01/Event Bundle 보호용 identity/date/lineage guard | NEW | `api/sku_identity.py` | LOCKED |
| Keyword Coverage Boundary | P01에서 사용 가능한 keyword evidence 범위만 표시 | HOLD in Sprint 1 | PATH_NOT_LOCKABLE | LOCKED as HOLD |
| Weekday / 4-week Baseline | P01용 weekday/4-week baseline contract | NEW + EXTEND | `api/sku_baseline.py` | LOCKED |
| WHY Health Gate | WHY 실행 가능성 판단 | NEW + EXTEND | `api/why_health_gate.py` | LOCKED |

### 3.1 SKU Scope / Identity

필수 최소 계약:

- SKU P01을 대표할 canonical SKU identity가 있어야 한다.
- 기존 상품 ID, channel product id, URL, catalog product id를 연결할 수 있어야 한다.
- P01 분석에서 사용할 cross-domain identity bridge가 있어야 한다.
- 잘못된 SKU/domain join을 차단해야 한다.

Implementation owner는 `api/sku_identity.py`로 고정한다.

근거:

- repo에는 `api/situation_room/` 패키지가 없다.
- repo에는 `api/a1_trace_store.py`, `api/ai_settings_store.py`, `api/menu_sync_tracking.py`처럼 domain helper가 flat `api/` 모듈로 존재한다.
- Block 1 identity 범위를 여러 파일로 쪼개면 첫 Sprint에서 ownership이 다시 흔들린다.

### 3.2 Identity Bridge

우선 재사용할 기존 asset:

- `A1SkuMap`
- `TrackedProductMeta`
- `DecisionProductHealthDaily`
- `CreativeOrganicDerived.matched_product_url`
- `api/main.py`의 SmartStore URL canonicalization primitive
- `api/a1_automation_batch.py`의 SKU to URL resolver pattern

첫 Sprint의 최소 목표:

```text
P01
  -> canonical product identity
  -> sales
  -> organic
  -> SA
  -> purchase
  -> review/Q&A
  -> index
```

실제 데이터가 없거나 identity가 불충분한 domain은 억지로 연결하지 않는다. 그런 경우 WHY Health Gate 또는 Bundle의 missing evidence로 남긴다.

### 3.3 Forbidden Join Guard

Implementation owner는 `api/sku_identity.py`로 고정한다.

최소 Guard 대상:

- SKU mismatch
- product/channelProductId mismatch
- URL identity mismatch
- invalid date window
- domain identity mismatch
- lineage 없는 join

전체 generic validation framework는 만들지 않는다. P01과 Event Evidence Bundle을 보호하기 위한 최소 Guard만 구현 범위다.

### 3.4 Keyword Coverage Boundary

CORE56 또는 전체 keyword ontology는 첫 Sprint 범위가 아니다.

판정:

- `api/keyword_coverage.py`는 만들지 않는다.
- keyword coverage boundary는 Sprint 1에서 독립 runtime owner를 갖지 않는다.
- P01 runner가 keyword evidence를 사용할 때 source provenance와 missing evidence로만 표현한다.

Status:

```text
PATH_NOT_LOCKABLE as implementation file
HOLD as Sprint 1 contract owner
```

Block 4 SKU P01 Vertical Slice에서 실제 keyword class가 completion blocker가 되면 별도 Scope Lock으로 다시 연다.

### 3.5 Weekday / 4-week Baseline

Implementation owner는 `api/sku_baseline.py`로 고정한다.

첫 Sprint 범위:

- P01용 weekday baseline 계산 contract
- P01용 4-week baseline 계산 contract
- 동일 input에 대해 deterministic output shape 유지
- usable / partial / missing 상태 반환

기존 primitive는 재사용/이식 대상으로만 본다.

- `api/main.py`의 `_baseline_range`, `_weekday_label`, `_day_of_week_share_from_points`
- rank exposure baseline 관련 pattern
- A-1 7d / prev-7d trend pattern

새 baseline engine 전체는 만들지 않는다.

### 3.6 WHY Health Gate

Implementation owner는 `api/why_health_gate.py`로 고정한다.

우선 재사용할 기존 asset:

- collection hub
- `CollectionTaskConfig.freshness_days`
- `CollectionJobRun`
- `CollectionJobEvent`
- menu sync reconcile 결과
- AI Ops freshness payload pattern

최소 출력 enum은 아래로 고정한다.

```text
USABLE
PARTIAL
STALE
MISSING
BLOCKED
```

WHY Health Gate는 새 monitoring system이 아니다. WHY 실행 전에 현재 데이터로 분석을 실행해도 되는지 판단하는 최소 gate다.

## 4. Block 2 LOCK 범위

Block 2는 Evidence Bundle + WHY 최소 Runner + Minimal Causality Guard만 포함한다.

| Contract | Scope | Action | Implementation Owner | Status |
| --- | --- | --- | --- | --- |
| WHY Registry 최소형 | P01 및 foundation 검증용 최소 WHY | NEW | `api/why_registry.py` | LOCKED |
| Event Evidence Bundle | Phase 4 6-block runtime contract | NEW | `api/event_evidence_bundle.py` | LOCKED |
| Candidate 0..N | STOP/UNKNOWN에서 candidate 0 허용 | NEW | `api/event_evidence_bundle.py` | LOCKED |
| Minimal Causality Guard | root/related/temporal/recommendation guard | NEW | `api/causality_guard.py` | LOCKED |
| WHY 최소 Runner | registry + health + bundle + guard orchestration | NEW + EXTEND | `api/why_runner.py` | LOCKED |
| Trace / Provenance | existing blob/hash/provenance reuse | REUSE | `api/a1_trace_store.py` | LOCKED |

### 4.1 WHY Registry 최소형

37 WHY 전체를 구현하지 않는다.

포함 WHY:

- `SKU_P01_SALES_DROP_WHY`

제외 WHY:

- full 37-WHY catalog
- Keyword/Organic room WHY
- SA room WHY
- GFA room WHY
- External Deep Investigation WHY
- Human Decision Rail WHY

Implementation owner는 `api/why_registry.py`로 고정한다.

### 4.2 Event Evidence Bundle

Implementation owner는 `api/event_evidence_bundle.py`로 고정한다.

`api/situation_room/bundle.py`는 선택하지 않는다.

근거:

- 현재 repo에 `api/situation_room/` 패키지가 없다.
- 첫 Sprint에서 새 package boundary까지 만들면 ownership이 커진다.
- 기존 repo는 `api/a1_trace_store.py`, `api/ai_settings_store.py`, `api/menu_sync_collection_status.py`처럼 기능 단위 flat module을 사용한다.

최소 포함:

- Observation
- Candidate 0..N
- supporting evidence
- contradicting evidence
- missing evidence
- source/provenance
- conclusion/stop state

기존 `evidence_json`은 Event Evidence Bundle로 rename하지 않는다. 기존 데이터는 reference/migration source로만 재사용한다.

### 4.3 Candidate Cardinality

반드시 candidate 0..N을 지원한다.

STOP / UNKNOWN 상태에서는 candidate 0이 가능해야 한다.

원인을 하나 강제로 생성하는 fallback은 금지한다.

### 4.4 Minimal Causality Guard

Implementation owner는 `api/causality_guard.py`로 고정한다.

첫 runtime부터 아래 Guard는 필수다.

- `rootDeclared=false`
- Related != Cause
- Temporal overlap != Cause
- Candidate != Root
- Recommendation != Decision

이 Guard는 선택 기능이 아니다. Event Evidence Bundle 최소 runtime의 완료 조건이다.

### 4.5 WHY 최소 Runner

Implementation owner는 `api/why_runner.py`로 고정한다.

전략:

- A-1 batch의 per-entity loop / failure isolation / trace persistence pattern을 EXTEND 대상으로 본다.
- AI Ops product-health rebuild의 multi-source aggregation pattern을 EXTEND 대상으로 본다.
- 실제 runner owner는 신규 `api/why_runner.py`가 가진다.

`api/main.py`에 바로 route를 추가하지 않는다. 첫 Sprint는 module-level runtime + tests로 완료한다.

### 4.6 Trace / Provenance

`api/a1_trace_store.py`의 blob/hash/provenance 패턴을 REUSE한다.

첫 Sprint에서는 Trace Explorer 전체를 Situation Room용으로 재작성하지 않는다.

Event Evidence Bundle이 source provenance를 잃지 않는 최소 연결만 허용한다.

## 5. Exact EXTEND Files

| File | Existing Responsibility | Minimal Change | Why Needed | Do Not Change |
| --- | --- | --- | --- | --- |
| `api/a1_trace_store.py` | `AnalysisRun`, trace node/edge, blob/hash persistence helper | 함수 변경 없이 REUSE 우선. 필요 시 WHY analysis_type을 받을 수 있는 existing parameter 사용 | Bundle source/provenance 보존 | Trace schema, Trace Explorer 의미, A-1 node semantics |
| `api/test_a1_trace_api.py` 또는 신규 WHY test | Trace API/trace helper 검증 | 기존 테스트는 수정하지 않는 것을 우선. 새 test에서 helper behavior를 검증 | provenance regression 방지 | A-1 trace API contract |

첫 Sprint에서 `api/main.py`, `api/db.py`, `api/a1_automation_batch.py`, `api/ai_settings_store.py`, `api/services/ai_ops_execution.py`는 EXTEND하지 않는다.

## 6. Exact NEW Files

| File | Contract Owner | Why NEW Is Required | Dependency |
| --- | --- | --- | --- |
| `api/sku_identity.py` | SKU scope registry, identity bridge, forbidden join guard | 통합 SKU scope registry와 forbidden join guard runtime이 없음 | `api/db.py` models, URL canonicalization evidence |
| `api/sku_baseline.py` | P01 weekday/4-week baseline contract | 공통 baseline service가 없음 | existing baseline primitives in `api/main.py` |
| `api/why_health_gate.py` | WHY 실행 가능성 gate | collection freshness와 AI Ops freshness가 WHY gate로 연결되어 있지 않음 | collection job/status models |
| `api/why_registry.py` | Minimal WHY registry | 37 WHY runtime registry가 없음 | Phase 9 Block 2 |
| `api/event_evidence_bundle.py` | Event Evidence Bundle DTO/validator | 6-block Bundle contract와 candidate 0..N validation이 없음 | Phase 4/8/9 contracts |
| `api/causality_guard.py` | Minimal Causality Guard | root/related/temporal/recommendation guard runtime이 없음 | `api/event_evidence_bundle.py` |
| `api/why_runner.py` | Minimal WHY runner orchestration | Phase 3 step orchestration이 없음 | `api/why_registry.py`, `api/why_health_gate.py`, `api/event_evidence_bundle.py`, `api/causality_guard.py` |
| `api/test_sku_identity.py` | Block 1 identity/guard tests | existing tests do not cover P01 identity foundation | `api/sku_identity.py` |
| `api/test_sku_baseline.py` | baseline contract tests | existing tests do not cover shared P01 baseline | `api/sku_baseline.py` |
| `api/test_why_health_gate.py` | health gate tests | existing tests do not cover WHY gate | `api/why_health_gate.py` |
| `api/test_event_evidence_bundle.py` | Bundle contract tests | no Bundle contract tests exist | `api/event_evidence_bundle.py` |
| `api/test_causality_guard.py` | Minimal guard tests | no causality guard tests exist | `api/causality_guard.py` |
| `api/test_why_runner.py` | minimal runner tests | no WHY runner tests exist | `api/why_runner.py` |

## 7. Explicit No-Touch Files / Areas

| File / Area | Reason |
| --- | --- |
| `api/menu_sync_*.py` | menu sync bundle domain is unrelated |
| `docker/*.lock` | Analytics immutable tag SoT |
| rebuild / promote / NAS deployment scripts | deployment flow unrelated |
| `api/a1_automation_batch.py` existing GPT schema | `primary_cause` is existing A-1 contract; do not mutate during foundation Sprint |
| `api/main.py` routes | first Sprint completes through module runtime + tests, not API surface |
| `api/db.py` schema/classes | persistence boundary is HOLD; no new table/column in first Sprint |
| existing AI Ops UI | UI is not completion condition |
| existing `DecisionProductHealthDaily` meaning | consume as input/reference only |
| `action_queue` workflow | full Human Decision Rail is Block 5 |
| Phase 8 LOCKED document | SoT; do not mutate |
| Phase 9 LOCKED document | SoT; do not mutate |
| ERP2-dev ports/stacks/scripts | cross-project contamination forbidden |

## 8. Persistence Boundary

Persistence decision:

```text
LOCKED: no new DB table, no new DB column, no db.py schema change in first Sprint.
```

Allowed:

- module-level runtime objects
- deterministic JSON contract output
- tests using in-memory/sample payloads
- existing `AnalysisRun` / `AnalysisBlob` / trace helper only if provenance must be persisted

Not allowed:

- new Event Evidence Bundle table
- new Bundle JSON column on existing tables
- mutation of `DecisionProductHealthDaily` meaning
- mutation of `AiDecisionLog` shape
- action_queue workflow change

Rationale:

Event Evidence Bundle 최소 Sprint는 persistence 없이 실행, 검증, trace shape, test가 가능하다. 저장 요구가 실제 Block 3 또는 Block 4 소비에서 증명되기 전까지 별도 persistence 계층은 HOLD한다.

## 9. Test Scope

첫 Sprint 테스트는 계약 중심으로 고정한다.

Identity:

- valid P01 bind
- mismatched SKU reject
- mismatched product identity reject
- forbidden join reject

Baseline / Quality:

- weekday baseline usable
- 4-week baseline usable
- stale/missing source -> WHY blocked 또는 제한 상태

Evidence Bundle:

- candidate 0
- candidate 1
- candidate N
- supporting/contradicting/missing 구조
- source provenance 보존

Causality Guard:

- default `rootDeclared=false`
- temporal overlap only -> root 금지
- related only -> root 금지
- candidate 존재 -> 자동 root 금지
- recommendation 존재 -> decision 자동 생성 금지

Runner:

- 최소 WHY registry 항목 실행
- STOP/UNKNOWN 허용
- trace 생성 가능
- 동일 input의 contract shape 재현

UI test는 이번 Sprint 범위가 아니다.

## 10. Completion Gate

Block 1 + Block 2 최소 구현은 다음이 모두 PASS해야 완료다.

- P01용 canonical identity boundary 존재
- 허용 join / 금지 join 구분 가능
- 최소 forbidden join guard 존재
- weekday baseline 제공 가능
- 4-week baseline 제공 가능
- WHY health gate 존재
- WHY 최소 registry 존재
- 최소 WHY runner 존재
- Event Evidence Bundle contract 생성 가능
- Candidate 0..N 지원
- supporting / contradicting / missing evidence 유지
- source/provenance 유지
- `rootDeclared=false` 기본값
- Minimal Causality Guard PASS
- STOP / UNKNOWN 가능
- 기존 AI Ops/A-1 핵심 의미 변경 없음
- Block 3에서 소비할 수 있는 runtime foundation 준비

화면 표시 여부는 완료 조건이 아니다.

## 11. Block 3 Entry Gate

다음이 모두 PASS해야 Block 3으로 넘어간다.

```text
IDENTITY_GATE = PASS
JOIN_GUARD = PASS
BASELINE_GATE = PASS
DATA_HEALTH_GATE = PASS
WHY_REGISTRY_MIN = PASS
WHY_RUNNER_MIN = PASS
EVENT_BUNDLE_MIN = PASS
CAUSALITY_GUARD_MIN = PASS
TRACE_PROVENANCE = PASS
```

하나라도 실패하면 External 6-key Runtime으로 넘어가지 않는다.

## 12. HOLD

이번 구현 Scope에 넣지 않는다.

- Block 3 External 6-key runtime
- SKU P01 사용자 화면
- Block 4 Vertical Slice 실행
- Full Human Decision Rail
- `rootDeclared` approval workflow
- Decision audit workflow 완성
- `action_queue` workflow 변경
- External Deep Investigation
- Advanced External Causality
- external APIs
- weather/news/policy/holiday crawler
- competitor price/promotion crawler
- full 37-WHY Engine
- Executive Situation Room
- Sub Situation Room UI
- Keyword/Organic / SA / GFA room 구현
- 기존 A-1 GPT `primary_cause` 계약 변경

## 13. 계약 충돌 검토

충돌 없음.

보정된 사항:

- Block 1의 implementation owner를 `api/sku_identity.py`, `api/sku_baseline.py`, `api/why_health_gate.py`로 LOCK했다.
- Block 2의 Event Evidence Bundle owner는 `api/event_evidence_bundle.py`로 LOCK했다.
- `api/event_evidence_bundle.py` 또는 `api/situation_room/bundle.py` 같은 대체 경로 표현을 제거했다.
- `api/situation_room/bundle.py`는 현재 repo structure 기준으로 선택하지 않는다.
- `api/db.py` schema 변경은 첫 Sprint에서 HOLD로 LOCK했다.
- `api/main.py` route 변경은 첫 Sprint에서 HOLD로 LOCK했다.

## 14. 최종 상태

```text
LOCKED
```

LOCKED 조건:

- Block 1 contract scope: LOCKED
- Block 1 file ownership: LOCKED
- Block 2 contract scope: LOCKED
- Block 2 file ownership: LOCKED
- Modification set: LOCKED
- Forbidden set: LOCKED
- Persistence boundary: LOCKED
- Completion Gate: LOCKED
- Block 3 Entry Gate: LOCKED

