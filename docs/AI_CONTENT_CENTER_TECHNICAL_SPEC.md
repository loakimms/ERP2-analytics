# AI 콘텐츠 센터 기술서 (계약용)

문서 버전: 2026-08-24  
대상 시스템: ERP2-analytics (Web 5188 / API 5189)  
이 문서는 구현 범위·완료 기준·1차 제외 항목의 계약 SoT다.

## 1. 목적

매일 수집된 NAS 데이터를 분석해 고객 소구(Appeal Point)를 만들고, 그 소구로

1. 신규 GFA 광고 소재
2. 블로그 / Instagram / YouTube Shorts 초안

을 생성한다. 담당자는 검수 후 복사·내보내기하고, 게시한 URL을 수동 연결한다. 게시 성과는 다음날 소구 선정에 다시 반영된다.

완료 기준은 “매일 글을 만든다”가 아니라 **어제 결과가 오늘 선정에 반영된다**.

## 2. 하지 않는 것 (1차 제외)

- 신규 Collector / NAS 재수집
- 기존 GFA 광고분석 > 소재 생성 화면 폐기
- 원천 데이터를 GPT에 넣고 바로 콘텐츠 생성
- 블로그·Instagram·YouTube API 게시
- 7개 중 1차 비활성 2개까지 매일 콘텐츠 큐에 넣기
- 허브팩 4종을 하나의 SKU로 합치기

## 3. SKU 범위

- 유니버스: 광고 분석이 추적하는 상품 7개. 소스 `tracked_product_meta` + `a1_sku_map`.
- 1차 활성: 헤나 1개 상품 + 허브팩 4종 상품 (`phase1_enabled=true`).
- 나머지 2개: 등록·join만, 생성 큐 제외.
- 허브팩 4종은 별도 `sku_id`. Evidence/콘텐츠/성과는 SKU별. 공통 소구는 공유 가능.

## 4. 파이프라인

```
NAS RAW → Insight → Appeal Point → Topic → Channel Strategy → Content
         → Human Review / Export → Publish URL (manual) → Performance → Learning
```

기존 GFA 생성기는 하위 Advertising Generator로 재사용한다. Content Generator(Blog/IG/Shorts)는 분리한다. 공통화는 분석·소구까지다.

## 5. 메뉴

상위 메뉴 `AI 콘텐츠 센터` (`menu10-ai-content`, `/analytics/content/...`).  
GFA 광고분석 > 소재 생성은 유지. 새 센터에서 딥링크.

- 오늘의 콘텐츠
- 고객·시장 인사이트
- 소구 포인트
- 콘텐츠 기획
- 콘텐츠 생성 (GFA / 블로그 / Instagram / Shorts)
- 검수·내보내기
- 게시·성과 연결
- 학습·개선
- 운영 설정

## 6. 데이터 모델 (신규)

원천 테이블은 읽기만 한다.

| 테이블 | 역할 |
| --- | --- |
| `content_sku_scope` | 7개 SKU 핀, product_group, phase1_enabled |
| `content_insight` | 문제/욕구/장벽/고객언어, trend |
| `content_appeal_point` | AP-xxx, Appeal Score, claim/legal, status |
| `content_appeal_evidence` | source_type + source_pk + snippet lineage |
| `content_topic` | 주제 후보 |
| `content_plan_item` | 날짜×SKU×채널×소구 오늘 큐 |
| `content_artifact` | 채널 생성물. GFA는 generation_run FK |
| `content_review_event` | 채택/수정/보류/폐기 |
| `content_publish_link` | 수동 게시 URL/ID |
| `content_performance_daily` | 채널 지표 (수동 입력) |
| `content_claim_policy` | FACT / CUSTOMER_EXPERIENCE / MARKETING_INTERPRETATION / PROHIBITED |

GFA 기존 테이블 `naver_gfa_creative_generation_run`에 `generation_source`, `appeal_point_id`를 추가한다.

## 7. 점수

Appeal Score (무엇을 말할 것인가)

- Demand 20, Purchase Intent 20, Evidence 20, Conversion 20, Novelty 10, Freshness 10

Legal/Claim은 Gate다. 금지 표현(탈모 치료, 두피염 개선 등)은 리뷰에 있어도 생성 문구로 내보내지 않는다.

Creative Score는 기존 GFA 생성기의 표현 품질 평가를 그대로 쓴다.

학습 판정: PROMOTE / MAINTAIN / REVISE / OBSERVE.

- CTR↓ CVR 유지 → Creative 문제 후보 (REVISE)
- CTR↑ CVR↓ → Hook/유입 불일치 후보 (REVISE)
- CTR↑ CVR↑ → PROMOTE
- 데이터 부족 → OBSERVE

성과 귀속과 채널별 판정 기준은 `docs/AI_CONTENT_PERFORMANCE_ATTRIBUTION_CONTRACT_V1.md`를 따른다. 현재 `POST /content/performance`와 `diagnose_performance()`는 계약의 `extra_json`, baseline, attribution level, observation window를 runtime 입력으로 사용한다. 실제 외부 collector는 이 계약을 만족하는 최소 채널부터 별도 구현한다.

에디터의 임시 저장, 다시 생성, human revision, 실제 게시본 기준 성과 귀속은 `docs/AI_CONTENT_EDITOR_REVISION_DRAFT_CONTRACT_V1.md`를 따른다. 생성 화면은 Plan/Artifact Queue와 에디터 진입까지만 담당하고, revision 기능은 에디터에서 명시적으로 처리한다.

## 8. API (prefix `/content`)

- `POST /content/sku-scope/sync` — 7개 핀
- `GET /content/sku-scope`
- `POST /content/insights/run` — 증분 분석
- `GET /content/insights`
- `GET /content/appeals`, `GET /content/appeals/{id}`
- `POST /content/plan/today` — Data Ready Gate 후 오늘 큐
- `GET /content/today`
- `POST /content/artifacts/generate` — blog/instagram/shorts
- `PATCH /content/artifacts/{id}/review`
- `GET /content/artifacts/{id}/export`
- `POST /content/publish-links`
- `POST /content/performance`
- `POST /content/gfa/bindings` — GFA Artifact와 실제 GFA creative_id 연결
- `POST /content/gfa/attribute` — 기존 GFA 성과 row를 creative_id 기준으로 매칭해 Attribution Runtime에 반영
- `GET /content/learning`
- `GET /content/data-ready`

GFA: `POST /gfa/creative-generator/runs`에 `generation_source=appeal|existing`, `appeal_point_id` 추가.

## 9. 일일 운영

기존 수집 04:30~07:00. Q&A(`qna_collect` 07:00) SUCCESS/PARTIAL 후 Data Ready Gate.  
신규 작업 `content_insight_daily`는 수집이 아니라 분석이다.

매일 전량 재분석하지 않는다. 어제 상태 + 당일 증분.

## 10. 블록 완료 기준

0. 7개 핀, 헤나1+허브팩4 `phase1_enabled`, Evidence에 sku_id
1. RAW→Insight→Appeal→Evidence lineage 재현
2. 오늘의 콘텐츠 + 소구 라이브러리 UI
3. GFA 생성 Source에 신규 소구, appeal_point_id 추적
4. Blog/IG/Shorts 초안 + 내보내기
5. Data Ready 이후 오늘 큐 (중복 소구·채널 균형)
6. 게시 URL + 성과 입력이 다음날 선정에 반영

## 11. 검증

- API: `python -m unittest api.test_content_center api.test_content_center_gfa`
- Web: `npm run typecheck`
- 재빌드가 필요하면 `scripts/analytics_rebuild_and_verify.ps1`
