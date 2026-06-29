# AI 운영 센터 현재 구조

이 문서는 현재 코드 기준의 `AI 운영 센터` 구조와 화면 책임 범위를 간단히 고정한다.

## 목적

- 메뉴를 다시 흔들지 않고 현재 구조를 기준점으로 삼는다.
- 화면 책임, 공통 컴포넌트, 남은 검증 항목을 빠르게 확인할 수 있게 한다.

## 메뉴 구조

- 상위 메뉴: `AI 운영 센터`
- 그룹 구조:
  - `상황판`: `오늘의 실행`
  - `판단 생성`: `상품별 운영 판단`, `광고 운영 판단`, `판매·전환 판단`, `리뷰·VOC 판단`, `Q&A 전환장벽 판단`, `수요·트렌드 판단`
  - `실행`: `실행 큐`
  - `검증`: `검증/설명 로그`
  - `정책 학습`: `SKU 정책 센터`

`판매 분석`, `리뷰 Q&A`는 별도 상위 메뉴로 유지하며, AI 운영 센터는 판단 허브 역할을 맡는다.

## 화면 책임

- `AiOpsHomeView`
  - 오늘 바로 볼 우선순위와 다음 이동 경로를 보여준다.
- `AiOpsProductsView`
  - SKU 단위의 상품 운영 판단과 스냅샷 재생성을 다룬다.
- `AiOpsAdsView`
  - 광고 운영 판단, 잠식, 예산 이동 후보를 다룬다.
- `AiOpsSalesView`
  - 판매·전환 판단과 과투입 후보를 다룬다.
- `AiOpsReviewsView`
  - 리뷰·VOC 기반의 우선 개선 후보를 다룬다.
- `AiOpsQnaView`
  - Q&A 전환 장벽과 FAQ 보강 후보를 다룬다.
- `AiOpsTrendsView`
  - 수요·트렌드 시나리오와 실행 제안을 다룬다.
- `AiOpsActionsView`
  - 승인형 실행 큐와 검토/상태 변경 흐름을 다룬다.
- `AiOpsLogsView`
  - 판단 근거, 승인 결과, 검증 로그를 추적한다.
- `AiOpsPoliciesView`
  - 정책 분포, 정책팩 학습, 정책팩 비교 시뮬레이션을 다룬다.

## 공통 구조

- 공통 카드 계약: `AiOpsDecisionCard`
- 공통 카드 프레임: `AiOpsDecisionCardPanel`
- 공통 매퍼: `AiOpsDecisionCardMappers.ts`
- 공통 매퍼 유틸: `AiOpsDecisionCardMapperUtils.ts`
- 공통 상세 블록: `AiOpsCenterDetails.tsx`
- `actions/logs` 링크 책임: `AiOpsDecisionCardMappers.ts`가 evidence 링크까지 최종 조립
- 리뷰 관리 canonical path: `/analytics/reviews/review-management`
- legacy 리뷰 관리 경로 `/analytics/reviews/analysis`는 redirect로만 유지

화면별 차이는 가능한 한 아래 슬롯으로 분리한다.

- `note`
- `extraContent`
- `actions`

## 파일 경계 원칙

- `index.ts`는 실제 view 파일을 직접 export 한다.
- 이전 호환용 barrel 파일이던 `AiOpsQualitativeViews.tsx`, `AiOpsAdsSalesViews.tsx`는 제거됐다.
- qualitative, ads/sales는 개별 view 파일로 분리된 상태를 유지한다.
- e2e 인증/bootstrap은 `web/tests/analytics-e2e-auth.ts`에서 공통 주입한다.
- AI Ops route 정의는 `web/tests/ai-ops-routes.ts`에서 smoke/live가 함께 사용한다.
- mutation e2e fixture는 `web/tests/ai-ops-mutations.fixtures.ts`에서 공통 관리한다.

## 현재 남은 작업

1. 실제 운영 기준 문구와 링크 흐름이 사용자 관점에서 자연스러운지 점검
2. `policies`/기타 presentation의 중복이 다시 커질 때 primitive 추출 재검토
3. 필요 시 live 스모크 범위를 현재의 route 렌더링 + 기본 이동/query 유지 검증에서 더 깊은 데이터 검증까지 확대

## 검증 기준

- `npm run typecheck`
- `npm run test:e2e:ai-ops:smoke`
- `npm run test:e2e:ai-ops:mutations`
- live 환경일 때 `npm run test:e2e:ai-ops:live`
  - route 렌더링, 공통 플로우 이동, 빠른 이동, action bucket query 유지/해제를 함께 확인
  - `logs` 정책팩 필터와 `policies` 비교 SKU 선택기의 기본 상태, 후보가 여러 개일 때의 읽기 전용 전환도 확인
  - 가능한 경우 선택 결과가 `정책팩 ...` 메타나 `선택 SKU:` 라인에 실제 반영되는지도 함께 확인
- AI Ops 관련 mapper/detail 테스트
- 브라우저 기준 수동/자동 시각 검증

## 자주 쓰는 명령

- 전체 AI Ops e2e: `npm run test:e2e:ai-ops`
- route/이동 smoke만 확인: `npm run test:e2e:ai-ops:smoke`
- 실제 운영 API 기준 live smoke: `npm run test:e2e:ai-ops:live`
- 큐 적재/승인 등 사용자 액션 확인: `npm run test:e2e:ai-ops:mutations`
- 루트에서 전체 검증: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-ai-ops-web.ps1`
- 루트에서 smoke만 검증: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-ai-ops-web.ps1 -Scope smoke`
- 루트에서 live smoke만 검증: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-ai-ops-web.ps1 -Scope live`
  - 실행 전 `5188/5189` preflight를 수행하며, 로컬 스택이 없으면 즉시 실패한다.
- 루트에서 mutation만 검증: `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-ai-ops-web.ps1 -Scope mutations`
