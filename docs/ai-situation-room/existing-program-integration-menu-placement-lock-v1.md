# Existing Program Integration & Menu Placement Lock v1

상태: LOCKED
범위: 기존 ERP2 Analytics 제품 안에서 Situation Room 계층의 위치, 진입, Evidence, API 책임 고정
기준 SoT:
- `docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`
- `docs/ai-situation-room/phase9-architecture-to-repository-implementation-mapping-v1.md`
- `docs/ai-situation-room/block1-block2-minimal-implementation-scope-lock-v1.md`
- `docs/AI_OPS_CENTER_CURRENT_STRUCTURE.md`
- Existing Program / Menu Read-only Audit 결과
작성일: 2026-08-20
Lock 기준: 사용자 검토 승인, 2026-08-20 14:49 KST

## 0. 실행 계약

이번 문서는 구현 문서가 아니다.

이번 문서는 기존 ERP2 Analytics 제품 안에 Phase 1~9 Situation Room 체계를 어디에 넣고, 기존 메뉴/API/Trace/Evidence와 어떤 관계로 동작시킬지 잠그는 Integration Placement Lock 문서다.

이번 작업에서는 다음을 수정하지 않는다.

- runtime code
- DB schema/data
- API runtime
- UI
- Router
- AI Ops
- A-1
- Trace
- action_queue
- collection logic
- Phase 8 LOCKED 문서
- Phase 9 LOCKED 문서
- Block 1+2 Runtime Scope Lock 문서

Git add / commit도 하지 않는다.

## 1. 현재 제품 구조 근거

현재 실제 Web 메뉴와 route tree의 단일 소유자는 `web/src/modules/layout/AppShell.tsx`다.

현재 상위 메뉴:

- AI 운영 센터
- 키워드(광고/오가닉) 분석
- SA 광고분석
- GFA 광고분석
- 검색·쇼핑 순위 분석
- 판매 분석
- 리뷰 Q&A
- SEO 분석
- 설정

현재 AI 운영 센터 그룹:

- 상황판: 오늘의 실행
- 판단 생성: 상품별 운영 판단, 광고 운영 판단, 판매·전환 판단, 리뷰·VOC 판단, Q&A 전환장벽 판단, 수요·트렌드 판단
- 실행: 실행 큐
- 검증: 검증/설명 로그
- 정책 학습: SKU 정책 센터

따라서 Situation Room은 기존 상세 분석 메뉴를 대체하거나 별도 제품으로 분리하지 않는다.

기존 상세 분석 메뉴는 L4 Raw Business Evidence Source로 유지한다.

## 2. Integration 결론 요약

| 항목 | 결론 | 상태 |
| --- | --- | --- |
| 종합상황실 위치 | `AI 운영 센터 > 상황판 > 종합상황실` | LOCKED |
| `ai-home` / 오늘의 실행 | 유지. 종합상황실로 대체하지 않음 | LOCKED |
| Sub Situation Room | sidebar menu item 생성 금지. contextual route로 진입 | LOCKED |
| L4 Evidence | Raw Business Evidence와 Analysis Trace를 분리 | LOCKED |
| Navigation State | Bundle context는 URL/query 기반 return pointer로 복원 | LOCKED |
| API Ownership | `/ai/situation-room/*`를 Situation Room composition namespace로 예약 | LOCKED |
| P01 End-to-End Flow | AI 운영 센터에서 기존 상세 메뉴/Trace까지 흐름 고정 | LOCKED |

## 3. 결론 1 - 종합상황실 위치

종합상황실은 새 최상위 메뉴가 아니다.

종합상황실은 기존 `AI 운영 센터` 안의 `상황판` 그룹 첫 번째 항목으로 둔다.

고정 구조:

```text
AI 운영 센터
│
├─ 상황판
│   ├─ 종합상황실
│   └─ 오늘의 실행
│
├─ 판단 생성
│   ├─ 상품별 운영 판단
│   ├─ 광고 운영 판단
│   ├─ 판매·전환 판단
│   ├─ 리뷰·VOC 판단
│   ├─ Q&A 전환장벽 판단
│   └─ 수요·트렌드 판단
│
├─ 실행
├─ 검증
└─ 정책 학습
```

권장 route:

```text
/analytics/ai/situation-room
```

권장 menu id:

```text
ai-situation-room
```

금지:

- `종합상황실`을 새 top-level menu로 추가하지 않는다.
- 기존 `AI 운영 센터`를 제거하거나 이름을 바꾸지 않는다.
- 기존 상세 메뉴를 종합상황실 하위 메뉴로 흡수하지 않는다.

## 4. 결론 2 - `ai-home` 유지

`/analytics/ai/home`은 유지한다.

`ai-home`의 책임:

```text
오늘의 실행 = 오늘 실제로 무엇을 해야 하는가
```

종합상황실의 책임:

```text
종합상황실 = 지금 사업 전체에서 무엇이 정상/이상이고 무엇을 먼저 조사해야 하는가
```

따라서 `ai-home`을 종합상황실로 대체하지 않는다.

Integration 이후에도 `ai-home`은 실행 우선순위 화면으로 남고, 종합상황실은 판단/관제의 시작점이 된다.

## 5. 결론 3 - Sub Situation Room 진입 방식

Sub Situation Room은 독립 좌측 메뉴가 아니다.

금지:

```text
SKU 상황실
Keyword 상황실
SA 상황실
GFA 상황실
VOC 상황실
```

위와 같은 sidebar menu item을 만들지 않는다.

고정 진입:

```text
종합상황실
  -> Issue 선택
  -> Contextual Sub Situation Room
  -> Candidate 선택
  -> L3 Evidence
  -> L4 Raw Evidence / Analysis Trace
```

권장 route pattern:

```text
/analytics/ai/situation-room/events/:eventId
/analytics/ai/situation-room/events/:eventId/candidates/:candidateId
```

route pattern은 Situation Room UI 구현 시 `AppShell.tsx` route tree에 추가할 수 있지만, 첫 Block 1+2 runtime 구현의 완료 조건은 아니다.

## 6. 결론 4 - L4 Evidence 이원 계약

L4는 하나의 `근거 보기` 버튼으로 처리하지 않는다.

L4 Evidence 목적지는 두 종류로 분리한다.

### 6.1 Raw Business Evidence

의미:

```text
실제 원천 데이터, 그래프, 행, 상품, 키워드 수치를 확인한다.
```

버튼 라벨:

```text
원본 근거 보기
```

기본 우선순위:

Raw Business Evidence가 직접 연결 가능하면 L4의 기본 목적지는 기존 도메인 상세 메뉴다.

### 6.2 Analysis Trace

의미:

```text
왜 이런 판단 결과가 만들어졌는지, 어떤 source/step/hash를 거쳤는지, 분석 과정이 재현 가능한지 확인한다.
```

버튼 라벨:

```text
분석 추적 보기
```

목적지:

```text
/analytics/ai/organic-rank/trace
```

A-1 또는 WHY 과정 자체의 provenance 검증이 필요할 때 사용한다.

### 6.3 둘 다 존재할 때

둘 다 제공한다.

```text
[원본 근거 보기]
[분석 추적 보기]
```

금지:

- 하나의 `근거 보기` 버튼이 상황에 따라 Raw Business Evidence와 Analysis Trace를 번갈아 가리키게 하지 않는다.
- `evidence_json`을 Event Evidence Bundle 또는 Raw Evidence 화면으로 rename하지 않는다.
- Trace Explorer를 기존 도메인 상세 메뉴의 대체 화면으로 사용하지 않는다.

## 7. 결론 5 - L4 Evidence 목적지

기존 메뉴별 L4 Raw Business Evidence destination은 아래로 고정한다.

| Evidence kind | L4 default destination |
| --- | --- |
| Organic Rank | `/analytics/rank/tracking` |
| Ad Rank | `/analytics/rank/ad-tracking` |
| Purchase Keyword | `/analytics/performance/purchase-keywords` |
| SA Searchword / Keyword | `/analytics/performance/ads-keywords` |
| SA Campaign | `/analytics/campaign/campaigns` |
| SA Adgroup | `/analytics/campaign/adgroups` |
| SA Creative | `/analytics/campaign/creatives` |
| GFA Raw | `/analytics/gfa/raw-analysis` |
| GFA Creative | `/analytics/gfa/creative-analysis` |
| Sales | `/analytics/sales/dashboard` 또는 `/analytics/sales/product?product_id=...` |
| Review | `/analytics/reviews/review-analysis` |
| Q&A | `/analytics/reviews/qna-analysis` |
| Product Index | `/analytics/seo/product-index` |
| Keyword Demand / Insight | `/analytics/rank/insights` |

기존 상세 분석 메뉴는 폐기하지 않는다.

Situation Room은 필요한 source/grain pointer를 만들어 기존 메뉴로 내려보낸다.

## 8. 결론 6 - Navigation State 복원 규칙

Sub Room 또는 L4로 이동한 뒤 사용자가 돌아오면 기존 Bundle/Candidate/Depth 맥락을 잃지 않아야 한다.

고정 규칙:

- Event Bundle context는 URL query 또는 route param으로 복원 가능해야 한다.
- L4 Raw Evidence 링크에는 가능한 범위에서 source/grain pointer를 포함한다.
- L4 링크에는 돌아올 수 있는 `return_to` 또는 동등한 parent context pointer를 포함한다.
- client-only global state에만 의존하지 않는다.
- 새 탭/새로고침 후에도 최소한 event id, candidate id, source kind, date window는 복원 가능해야 한다.

최소 pointer:

```text
event_id
candidate_id
source_kind
entity_id or product_url or keyword
from_date
to_date
return_to
```

## 9. 결론 7 - API Ownership

기존 `/ai/ops/*`는 기존 운영 판단, 실행, 로그, 정책 책임을 유지한다.

Situation Room API namespace는 아래로 예약한다.

```text
/ai/situation-room/*
```

책임:

```text
Situation Room API
= Event Bundle들을 화면에 전달하는 Composition Boundary
```

금지:

- `/ai/ops/situation/*`를 만들지 않는다.
- `/ai/ops/products`, `/ai/ops/sales`, `/ai/ops/ads`의 판단 카드 API를 복제하지 않는다.
- `/ai/a1/trace/*`를 Situation Room 전용 Trace API로 fork하지 않는다.
- 기존 Domain API를 Situation Room 전용으로 재계산하지 않는다.

역할 경계:

| Layer | Responsibility |
| --- | --- |
| 기존 Domain API | Fact 제공 |
| 기존 `/ai/ops/*` | 기존 운영 판단 / 실행 / 로그 / 정책 |
| A-1 APIs | 분석 실행 / Trace / Provenance |
| Block 1~3 Runtime | Situation Room이 소비하는 Decision Contract Foundation |
| `/ai/situation-room/*` | Bundle composition and presentation payload |

주의:

Block 1+2 Minimal Runtime Scope에서는 아직 API route를 만들지 않는다. `/ai/situation-room/*`는 이후 Situation Room 표현 계층을 붙일 때 사용할 reserved namespace다.

## 10. P01 End-to-End 사용자 흐름

P01 Integration 검증 흐름은 아래로 고정한다.

```text
AI 운영 센터
  -> 종합상황실
  -> "SKU A 매출 이상" Event 선택
  -> SKU Sub Situation Room
  -> P01 - 왜 이 SKU 매출이 떨어졌나?
  -> Candidate A - 오가닉 순위 하락
  -> L3 Supporting / Contradicting / Missing
  -> 원본 근거 보기
       -> 기존 검색·쇼핑 순위 분석 > 내 상품 추적
  -> 분석 추적 보기
       -> A-1 Trace
```

P01에서 화면이 늘어나는 지점:

- 종합상황실
- contextual SKU Sub Situation Room

P01에서 늘어나지 않는 지점:

- 검색·쇼핑 순위 분석 sidebar
- 키워드 분석 sidebar
- SA/GFA sidebar
- 판매 분석 sidebar
- 리뷰/Q&A sidebar
- SEO 분석 sidebar

## 11. Block 1+2 Runtime의 제품 내 위치

Block 1+2 runtime 파일은 사용자 메뉴가 아니다.

역할:

```text
기존 ERP2 데이터/분석
          ↓
[Block 1]
Identity / Baseline / Health
          ↓
[Block 2]
WHY / Evidence / Guard
          ↓
[Block 3]
External Boundary
          ↓
Situation Room 표현 계층
```

따라서 Block 1+2를 구현해도 기존 메뉴에는 당장 변화가 없어도 정상이다.

Block 1+2의 완료 기준은 backend/runtime contract이며, 사용자-facing Situation Room UI는 이후 Integration Lock을 따른다.

## 12. Modification Boundary

Integration 구현이 승인되기 전까지 아래는 수정하지 않는다.

| File / Area | Decision |
| --- | --- |
| `web/src/modules/layout/AppShell.tsx` | Integration UI 구현 승인 전까지 no-touch |
| `web/src/modules/ai/AiOpsHomeView.tsx` | `ai-home` 유지. 종합상황실로 대체 금지 |
| `web/src/modules/ai/AiOps*` | 기존 AI Ops 책임 유지 |
| `web/src/shared/navigation/analyticsNavigation.ts` | L4 이원 계약 구현 전까지 drift만 기록 |
| `api/main.py` `/ai/ops/*` | 복제/흡수 금지 |
| `api/a1_trace_api.py` `/ai/a1/trace/*` | provenance API로 유지 |
| `api/db.py` | Integration Lock 단계에서 schema 변경 없음 |
| `action_queue` | Full Human Decision Rail 전까지 workflow 변경 없음 |
| 기존 상세 메뉴 | Evidence Source로 유지 |

## 13. 이후 구현 시 Touch 후보

이 문서는 구현을 승인하지 않는다.

다만 Integration UI 구현이 승인되면 예상 touch 후보는 아래다.

| File / Area | Expected change |
| --- | --- |
| `web/src/modules/layout/AppShell.tsx` | `ai-situation-room` submenu/path/route 추가 |
| `web/src/modules/ai/AiSituationRoomView.tsx` | 종합상황실 신규 view |
| `web/src/modules/ai/AiSubSituationRoomView.tsx` | contextual Sub Room 신규 view |
| `web/src/shared/navigation/analyticsNavigation.ts` | Raw Evidence / Analysis Trace 링크 분리 helper |
| `web/src/modules/ai/AiOpsDecisionCardMappers.ts` | 기존 mapper drift 정리 시 조정 가능 |
| `api/main.py` | `/ai/situation-room/*` route 등록 시에만 최소 touch |

이 touch 후보는 Block 1+2 runtime 구현 범위가 아니다.

## 14. 구현 순서 보정

현재 순서는 아래로 고정한다.

```text
Phase 8
  -> LOCKED

Phase 9
  -> LOCKED

Block 1+2 Minimal Runtime Scope
  -> LOCK_READY

Existing Program Integration & Menu Placement
  -> LOCKED

Block 1+2 실제 구현
  -> user approval required
```

구현 승인 전에는 Block 1+2 backend 파일도 만들지 않는다.

## 15. 최종 상태

```text
LOCKED
```

LOCKED 조건:

- 종합상황실 placement: LOCKED
- `ai-home` coexistence: LOCKED
- Sub Situation Room entry: LOCKED
- L4 Evidence dual contract: LOCKED
- Navigation state restore: LOCKED
- API ownership boundary: LOCKED
- P01 End-to-End flow: LOCKED

