# Block 3 - External 6-key Boundary Runtime Minimal Implementation Scope Lock v1

상태: LOCKED
범위: External Context 6-key Boundary Runtime 첫 구현 범위 고정
기준 SoT:
- `docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`
- `docs/ai-situation-room/phase9-architecture-to-repository-implementation-mapping-v1.md`
- `docs/ai-situation-room/existing-program-integration-menu-placement-lock-v1.md`
- `docs/ai-situation-room/block1-block2-minimal-implementation-scope-lock-v1.md`
- `docs/ai-situation-room/block1-block2-minimal-implementation-execution-contract-v1.md`
- Block 3 Read-only Source/Ownership Audit 결과
작성일: 2026-08-20
Lock 기준: 사용자 검토 승인, sourceType runtime cardinality clarification 반영 후 2026-08-20 16:49 KST
Closeout 결과: PASS_BLOCK3_IMPLEMENTATION_CLOSEOUT - CLOSED, 사용자 승인 2026-08-20 17:09 KST

## 0. 실행 계약

이번 작업은 Block 3의 첫 구현 범위를 LOCK하기 위한 문서화 작업이다.

아직 구현하지 않는다.

사용자 승인 전 다음을 수정하지 않는다.

- Block 1+2 구현 코드
- `api/main.py`
- `api/db.py`
- DB schema/data
- UI
- `AppShell.tsx`
- `/ai/situation-room/*`
- `/ai/ops/*`
- A-1
- Trace API
- `action_queue`
- collection logic
- crawler
- External API
- Phase 8/9 LOCKED 문서
- Existing Program Integration LOCKED 문서
- Block 1+2 LOCKED Scope 문서

Git add / commit도 하지 않는다.

## 1. 기준 상태

다음은 완료된 기준선이다.

| Item | Status |
| --- | --- |
| Phase 8 | LOCKED |
| Phase 9 | LOCKED |
| Existing Program Integration | LOCKED |
| Block 1+2 Scope | LOCKED |
| Block 1+2 Implementation | IMPLEMENTED_AND_TESTED |
| Block 1+2 Closeout | PASS_BLOCK1_BLOCK2_IMPLEMENTATION_CLOSEOUT |
| Block 3 Entry Gate | 9/9 PASS |

Block 1+2는 재오픈하지 않는다.

이번 작업은 Block 3만 다룬다.

## 2. Block 3 목적

Block 3의 목적은 External Source를 새로 구축하는 것이 아니다.

목적은 Phase 8에서 LOCK한 External Context 6-key를 runtime에서 항상 같은 contract shape로 제공하는 것이다.

고정 Key:

- `MARKET_DEMAND`
- `COMPETITOR`
- `POLICY`
- `NEWS`
- `WEATHER`
- `HOLIDAY`

6개 key는 항상 존재해야 한다.

source가 없더라도 key를 삭제하지 않는다.

## 3. 현재 Source Boundary

Read-only Audit 기준:

| Key | Existing Source | Availability |
| --- | --- | --- |
| `MARKET_DEMAND` | DataLab / keyword insight / SearchAd keyword-volume 관련 기존 source | PARTIAL |
| `COMPETITOR` | `TrackedCompetitorProduct` / rank / SERP mall-product 비교 | PARTIAL |
| `POLICY` | 확인된 source 없음 | NOT_AVAILABLE |
| `NEWS` | 확인된 source 없음 | NOT_AVAILABLE |
| `WEATHER` | 확인된 source 없음 | NOT_AVAILABLE |
| `HOLIDAY` | 확인된 source 없음 | NOT_AVAILABLE |

이 availability를 외부 원인으로 해석하지 않는다.

## 4. Availability와 SignalStatus 경계

다음 두 개념을 혼합하지 않는다.

```text
availability = source를 관찰할 수 있는가
signalStatus = 실제 관련 signal을 관찰했는가
```

금지:

```text
PARTIAL -> 자동 SIGNAL_OBSERVED
NOT_AVAILABLE -> External Cause
```

Source가 PARTIAL이어도 해당 analysis window에서 실제 observation을 하지 않았다면 `SIGNAL_OBSERVED`를 생성하지 않는다.

첫 구현에서 signalStatus owner는 `api/external_context.py`다.

Scope Lock 규칙:

- existing source availability는 static boundary로 제공한다.
- observation이 실제 수행되지 않은 경우 `signalStatus=NOT_CHECKED`를 기본값으로 둔다.
- source가 없으면 `signalStatus=NOT_CHECKED` 또는 `UNKNOWN`만 허용한다.
- `SIGNAL_OBSERVED`는 caller가 명시적으로 observation result를 제공한 경우에만 허용한다.
- 근거 없는 signal을 생성하지 않는다.

## 5. ExternalContextItem Runtime Contract

Phase 8 Architecture Contract를 변경하지 않는다.

Runtime에서 최소한 아래 field를 제공해야 한다.

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

Field를 삭제하거나 rename하지 않는다.

Runtime serialization은 dict/JSON-compatible shape로 고정한다.

`sourceType` field 이름은 Phase 8 계약대로 유지한다.

단 runtime value cardinality는 아래로 고정한다.

```text
sourceType: list[str]
```

의미:

```text
sourceType = 이 Context Key가 받을 수 있는 Evidence source taxonomy
availability = 현재 실제 source 확보 상태
```

따라서 `sourceType`에 taxonomy가 존재해도 `availability=NOT_AVAILABLE`일 수 있다.

예:

```text
POLICY
sourceType = [
  "Government / Regulation / Policy",
  "Commerce Platform / Naver Ecosystem Change"
]
availability = NOT_AVAILABLE
```

이는 정책 계열 source taxonomy는 정의되어 있지만 현재 실제 source는 없다는 뜻이다.

## 6. Candidate Linkage 경계

External Context는 단독으로 Candidate를 만들지 않는다.

금지:

```text
External Context -> Cause Candidate 자동 생성
```

Candidate linkage가 없는 Context 단계에서는 `evidenceStatus`에 아래 계열만 허용한다.

- `NONE`
- `PARTIAL`
- `MISSING`
- `INSUFFICIENT`
- `UNKNOWN`

`SUPPORTING` / `CONTRADICTING`은 특정 Event Evidence Bundle Candidate와 명시적으로 연결된 경우에만 사용할 수 있다.

Block 3에서는 Candidate linkage 구현을 기본 요구사항으로 만들지 않는다.

필요하다면 Block 4가 소비할 boundary만 제공한다.

## 7. Root / Causality Boundary

Block 1+2 Minimal Causality Guard를 그대로 소비한다.

Block 3은 이를 변경하지 않는다.

반드시 유지:

- `rootDeclared=false`
- Related != Cause
- Temporal overlap != Cause
- External Candidate != Root
- Recommendation != Decision

추가 규칙:

- NOT_AVAILABLE != Cause
- PARTIAL != Candidate
- SIGNAL_OBSERVED != Root
- External Context 자체가 `rootDeclared=true`를 만들 수 없다.

## 8. Implementation Owner

Block 3 runtime의 단일 implementation owner는 아래로 고정한다.

```text
OWNER_PATH_LOCKED: api/external_context.py
```

근거:

- repo는 현재 `api/a1_trace_store.py`, `api/ai_settings_store.py`, `api/menu_sync_collection_status.py`처럼 flat `api/` helper module 구조를 사용한다.
- 첫 Sprint에서 unnecessary package hierarchy를 만들지 않는다.
- Block 3은 6-key boundary contract 하나가 핵심이므로 하나의 owner가 충분하다.

테스트 owner:

```text
api/test_external_context.py
```

## 9. MARKET_DEMAND 연결 범위

Block 3에서는 새 DataLab collector/API를 만들지 않는다.

기존 source를 소비하는 최소 boundary만 허용한다.

확인된 기존 source:

- DataLab trend / shopping keyword insight logic
- keyword insight response builder
- SearchAd keyword-volume related values

현재 판정:

```text
availability = PARTIAL
```

주의:

- 실시간/query result 성격이 강하며 안정적인 External Context fact table은 없다.
- observation timestamp는 caller-provided 또는 evaluation time으로만 표현한다.
- 데이터가 있다고 과장해서 AVAILABLE로 올리지 않는다.

## 10. COMPETITOR 연결 범위

Block 3에서는 competitor crawler를 만들지 않는다.

확인된 기존 source:

- `TrackedCompetitorProduct`
- rank / SERP mall-product 비교
- product comparison history pattern

현재 확보되지 않은 source:

- competitor 가격 전체 추적
- promotion
- 광고비
- 배송 변화

현재 판정:

```text
availability = PARTIAL
```

## 11. NOT_AVAILABLE 4-key

다음은 첫 Block 3 구현에서 실제 source를 추가하지 않는다.

- `POLICY`
- `NEWS`
- `WEATHER`
- `HOLIDAY`

Runtime에서는 반드시 item을 생성한다.

고정 상태:

```text
availability = NOT_AVAILABLE
```

limitation에는 왜 현재 Cause 판단에 사용할 수 없는지를 표현한다.

빈 key 생략 금지.

mock external evidence 생성 금지.

## 12. Source Type Mapping

Phase 8의 Source Taxonomy를 유지한다.

6-key와 Source Taxonomy는 1:1 구조가 아니다.

Source taxonomy entry 때문에 새로운 External Context Key를 만들지 않는다.

특히 `Platform Incident / Service Degradation`은 7번째 key로 만들지 않는다.

기존 Phase 8 계약대로 data-quality/system-health evidence로 유지한다.

초기 runtime taxonomy mapping은 아래로 고정한다.

| External Context Key | sourceType runtime value |
| --- | --- |
| `MARKET_DEMAND` | `["Market Demand"]` |
| `COMPETITOR` | `["Competitor"]` |
| `POLICY` | `["Government / Regulation / Policy", "Commerce Platform / Naver Ecosystem Change"]` |
| `NEWS` | `["News / Social Issue"]` |
| `WEATHER` | `["Weather / Environment"]` |
| `HOLIDAY` | `["Calendar / Holiday / Seasonality"]` |

이 mapping은 source taxonomy 후보를 뜻한다.

현재 source availability와 동일한 값이 아니다.

구현자는 `sourceType`을 string으로 직렬화하지 않는다.

## 13. Persistence Boundary

Block 3 첫 Sprint에서도 기본 원칙은 아래다.

```text
NEW DB TABLE = 0
NEW DB COLUMN = 0
api/db.py SCHEMA CHANGE = 0
```

6-key runtime contract는 우선 module-level deterministic output과 test로 검증한다.

기존 source read를 위해 기존 model/query를 소비할 수 있지만 schema 의미를 바꾸지 않는다.

Block 3에서 External Context persistence가 반드시 필요하다는 실제 증거가 없으므로 persistence는 HOLD한다.

## 14. API / UI Boundary

Block 3은 backend boundary runtime이다.

이번 구현에서는 다음을 만들지 않는다.

- `/ai/situation-room/*` route
- 종합상황실 UI
- Sub Situation Room UI
- `AppShell` menu
- L4 link UI

Existing Program Integration LOCK은 향후 placement 계약이며 Block 3 completion condition이 아니다.

## 15. Block 1+2 Dependency Boundary

Block 3은 Block 1+2를 소비할 수 있다.

허용:

- EventEvidenceBundle contract 참조
- Causality Guard 참조
- WHY runner integration boundary 준비
- source/provenance contract 재사용

금지:

- Block 1+2 code 수정
- 기존 test 의미 변경
- Bundle contract rename
- Causality Guard 약화
- WHY Runner 구조 변경을 Block 3 편의 때문에 수행

필요한 integration이 Block 1+2 수정 없이는 불가능하면 `CONTRACT_DEPENDENCY_CONFLICT`로 보고하고 임의 수정하지 않는다.

## 16. Exact Implementation Set

### NEW Files

| File | Contract Owner | Why NEW |
| --- | --- | --- |
| `api/external_context.py` | ExternalContextItem, 6-key invariant, availability/signal/evidence boundary | 현재 runtime 6-key output 없음 |
| `api/test_external_context.py` | Block 3 contract tests | 6-key boundary test 없음 |

### EXTEND Files

없음.

첫 Block 3 구현에서는 기존 파일을 수정하지 않는다.

### REUSE Only

| File / Asset | Usage |
| --- | --- |
| `api/event_evidence_bundle.py` | evidence linkage rule과 source/provenance contract 참조 가능 |
| `api/causality_guard.py` | root/causality boundary 참조 가능 |
| existing DataLab / keyword insight logic | MARKET_DEMAND source boundary 근거 |
| `TrackedCompetitorProduct` / rank facts | COMPETITOR source boundary 근거 |

### No-Touch Files

- `api/main.py`
- `api/db.py`
- `api/why_runner.py`
- `api/event_evidence_bundle.py`
- `api/causality_guard.py`
- `api/sku_identity.py`
- `api/sku_baseline.py`
- `api/why_health_gate.py`
- UI / AppShell
- `/ai/ops/*`
- `/ai/situation-room/*`
- A-1 / Trace API
- `action_queue`
- collection logic

## 17. Test Scope

Block 3 최소 테스트에 포함한다.

6-key Contract:

- 항상 정확히 6 key 존재
- key 누락 금지
- duplicate key 금지
- 허용되지 않은 7번째 key 금지

Availability:

- `MARKET_DEMAND = PARTIAL`
- `COMPETITOR = PARTIAL`
- `POLICY = NOT_AVAILABLE`
- `NEWS = NOT_AVAILABLE`
- `WEATHER = NOT_AVAILABLE`
- `HOLIDAY = NOT_AVAILABLE`

Signal Boundary:

- PARTIAL만으로 SIGNAL_OBSERVED 생성 금지
- NOT_AVAILABLE에서 fabricated signal 생성 금지
- actual observation이 있을 때만 signal 상태 변화 가능

Evidence Boundary:

- Candidate linkage 없는 context에서 SUPPORTING 금지
- Candidate linkage 없는 context에서 CONTRADICTING 금지
- missing/insufficient/unknown 표현 가능

Causality:

- SIGNAL_OBSERVED만으로 root 금지
- PARTIAL만으로 Candidate 생성 금지
- NOT_AVAILABLE만으로 Candidate 생성 금지
- `rootDeclared=false` 유지

Determinism:

- 동일 입력의 6-key contract shape가 재현되어야 한다.

## 18. HOLD

Block 3에서 하지 않는다.

- External Deep Investigation
- Advanced External Causality
- weather API
- news/social API
- policy crawler
- holiday/calendar source 구축
- competitor price crawler
- competitor promotion crawler
- platform incident monitor 신규 구축
- External automatic root decision
- new External DB
- `/ai/situation-room/*` route
- Situation Room UI
- Block 4 P01 UI
- Human Decision Rail
- Block 1+2 재수정

## 19. Completion Gate

Block 3 완료 기준:

- ExternalContextItem runtime contract 존재
- 정확히 6 key 항상 생성
- duplicate/missing key 방지
- MARKET_DEMAND availability boundary 표현
- COMPETITOR availability boundary 표현
- POLICY NOT_AVAILABLE 표현
- NEWS NOT_AVAILABLE 표현
- WEATHER NOT_AVAILABLE 표현
- HOLIDAY NOT_AVAILABLE 표현
- availability와 signalStatus 분리
- Candidate 없는 Context에서 SUPPORTING/CONTRADICTING 방지
- NOT_AVAILABLE이 Cause를 만들지 않음
- PARTIAL이 Candidate를 만들지 않음
- SIGNAL_OBSERVED가 Root를 만들지 않음
- `rootDeclared=false` 유지
- source/provenance/limitation 표현 가능
- deterministic output contract
- Block 1+2 의미 변경 없음
- 신규 external source/crawler/API/DB/UI 0

## 20. Block 4 Entry Gate

Block 4 SKU P01 Vertical Slice에 들어가기 전 최소:

```text
EXTERNAL_CONTEXT_CONTRACT = PASS
SIX_KEY_INVARIANT = PASS
SOURCE_AVAILABILITY_BOUNDARY = PASS
SIGNAL_BOUNDARY = PASS
EVIDENCE_LINKAGE_BOUNDARY = PASS
EXTERNAL_CAUSALITY_GUARD = PASS
EXTERNAL_PROVENANCE = PASS
BLOCK1_2_REGRESSION = PASS
OUT_OF_SCOPE_CHANGE = 0
```

## 21. 계약 충돌 여부

충돌 없음.

Block 3은 Block 1+2를 수정하지 않고 소비만 한다.

API namespace와 UI placement는 Existing Program Integration Lock을 따른다. 단, 이번 Block 3 구현에서는 route/UI를 만들지 않는다.

## 22. 최종 상태

```text
LOCKED
```

LOCKED 조건:

- exact implementation owner: LOCKED
- exact NEW files: LOCKED
- exact EXTEND files: LOCKED as none
- exact no-touch files: LOCKED
- source access boundary: LOCKED
- ExternalContextItem serialization: LOCKED
- availability/signalStatus mapping rule: LOCKED
- Evidence linkage rule: LOCKED
- Persistence decision: LOCKED
- Test scope: LOCKED
- Completion Gate: LOCKED
- Block 4 Entry Gate: LOCKED
- HOLD: LOCKED

