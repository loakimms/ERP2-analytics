# Block 1 + Block 2 Minimal Implementation Execution Contract v1

상태: IMPLEMENTED_AND_TESTED
범위: LOCKED Scope 그대로 첫 backend/runtime foundation 구현
기준 SoT:
- `docs/ai-situation-room/phase8-external-intelligence-architecture-v1.md`
- `docs/ai-situation-room/phase9-architecture-to-repository-implementation-mapping-v1.md`
- `docs/ai-situation-room/existing-program-integration-menu-placement-lock-v1.md`
- `docs/ai-situation-room/block1-block2-minimal-implementation-scope-lock-v1.md`
작성일: 2026-08-20
구현 결과: 신규 backend/runtime 모듈 및 계약 테스트 22개 PASS, 2026-08-20
Closeout 결과: PASS_BLOCK1_BLOCK2_IMPLEMENTATION_CLOSEOUT, 사용자 승인 2026-08-20 15:17 KST

## 0. 실행 원칙

이번 구현은 설계 확장이 아니다.

LOCKED Scope 안의 backend/runtime foundation만 구현한다.

구현 중 새 필요사항이 발견되어도 Scope를 자동 확대하지 않는다. 필요한 항목은 HOLD 또는 FOLLOW_UP으로 기록한다.

## 1. 구현 허용

신규 파일:

- `api/sku_identity.py`
- `api/sku_baseline.py`
- `api/why_health_gate.py`
- `api/why_registry.py`
- `api/event_evidence_bundle.py`
- `api/causality_guard.py`
- `api/why_runner.py`
- 관련 `api/test_*.py`

허용 범위:

- module-level runtime contract
- deterministic JSON/dataclass-like output
- candidate 0..N
- STOP / UNKNOWN
- `rootDeclared=false`
- Raw Business Evidence와 Analysis Trace를 구분할 수 있는 provenance/link payload
- pytest/unittest 기반 계약 테스트

## 2. 구현 금지

- `api/main.py` route 추가/수정
- `api/db.py` schema/class 추가/수정
- 신규 DB table
- 신규 DB column
- UI/AppShell/menu 변경
- `/ai/situation-room/*` 실제 route 노출
- `action_queue` workflow 변경
- 기존 A-1 GPT `primary_cause` 계약 변경
- AI Ops endpoint 복제
- Block 3 External 6-key runtime
- 종합상황실 UI
- contextual Sub Situation Room UI

## 3. 완료 Gate

아래가 테스트로 확인되어야 한다.

- P01 canonical identity boundary
- 허용 join / 금지 join 구분
- weekday baseline
- 4-week baseline
- WHY health gate
- minimal WHY registry
- minimal WHY runner
- Event Evidence Bundle contract
- candidate 0, 1, N
- supporting / contradicting / missing evidence
- source/provenance 유지
- `rootDeclared=false`
- Related != Cause
- Temporal overlap != Cause
- Candidate != Root
- Recommendation != Decision
- STOP / UNKNOWN
- 기존 AI Ops/A-1 핵심 의미 no-touch

## 4. 실행 결과 판정

최종 보고는 아래 중 하나로 한다.

- IMPLEMENTED_AND_TESTED
- IMPLEMENTED_WITH_TEST_GAP
- HOLD_SCOPE_EXPANSION_REQUIRED
- BLOCKED_BY_EXISTING_CONTRACT

