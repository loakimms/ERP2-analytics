# 광고분석(analytics) 메뉴별 데이터 수집·저장 정리

**대상**: http://localhost:5188/analytics/ (Analytics Web)  
**API**: http://localhost:5189 (Analytics API)  
**DB**: PostgreSQL `analytics-db` (analytics DB)

---

## 1. 메뉴 구조 요약

| 대메뉴 | 서브메뉴 | 경로 | 데이터 소스(테이블/API) |
|--------|----------|------|-------------------------|
| **1. AI 분석** | A. 오가닉 순위 분석 | `/analytics/ai/organic-rank` | naver_product_rank_daily, tracked_*, A-1 배치 테이블, OpenAI |
| | A-1 검증(역추적) 트리 | `/analytics/ai/organic-rank/trace` | analysis_run, analysis_trace_node, analysis_blob |
| | B~E (광고/구매/수요/SKU) | `/analytics/ai/...` | 규칙 문서(AI 세팅), 향후 확장 |
| **2. 키워드(광고/오가닉) 분석** | 광고 검색어 분석 | `/analytics/performance/ads-keywords` | naver_ad_keyword_daily, naver_ad_searchword_daily |
| | 구매 키워드 분석 | `/analytics/performance/purchase-keywords` | naver_smartstore_purchase_keyword_daily |
| **3. 캠페인·광고그룹 분석** | 캠페인 분석 | `/analytics/campaign/daily` | naver_ad_keyword_daily 집계 |
| | 광고 그룹 분석 | `/analytics/campaign/adgroups` | naver_ad_keyword_daily 집계 |
| | 소재 분석 | `/analytics/campaign/creatives` | naver_ad_creative_daily, creative_organic_rank_daily_derived |
| **4. 검색·쇼핑 순위 분석** | 키워드 인사이트 | `/analytics/rank/overview` | SearchAd keywordstool, DataLab, naver_product_rank_daily |
| | 내 상품 추적 | `/analytics/rank/tracking` | tracked_product_keyword, naver_product_rank_daily, tracked_product_rank_daily |
| **5. SEO 분석** | 상품명 SEO | `/analytics/research/seo` | SearchAd/DataLab, 수기 키워드, SEO 규칙 |
| | 해시태그 SEO | `/analytics/research/hashtag` | 해시태그 규칙, 수기 태그 |
| | 상품지수분석 | `/analytics/research/product-index` | tracked_product_page_daily, tracked_product_index_* |
| **6. 설정** | 카테고리 사전, SEO규칙, API 세팅, AI 세팅 | `/analytics/settings/...` | app_settings, ai_settings(백업), DB/파일 |

---

## 2. 테이블별 데이터 수집·저장 방식

### 2.1 네이버 광고(SearchAd) 일간 팩트

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **naver_ad_keyword_daily** | 키워드별 일간 지표(노출/클릭/비용/전환/매출 등) | ① SearchAd API(stat report KEYWORD) ② CSV/XLSX 업로드 | `upsert_keyword_daily_from_df` (일자+source 기준 삭제 후 upsert) |
| **naver_ad_searchword_daily** | 검색어별 일간 지표 | ① SearchAd API(검색어 리포트) ② CSV 업로드 `/ads/searchwords/upload` | `upsert_searchword_daily_from_df` (일자+source 기준 삭제 후 upsert) |
| **naver_ad_creative_daily** | 소재(AD)별 일간 지표 | ① SearchAd API(stat report AD + AD_CONVERSION 머지) ② 소재 보고서 CSV 업로드 `/ads/creatives/upload` | `upsert_creative_daily_from_df` (delete_mode: auto 시 삭제 없이 upsert) |

- **수집 트리거**:  
  - **API 수집**: Web에서 “수집” 버튼 → `POST /ads/collect` (기간/캠페인 지정).  
    - 내부: SearchAd stat report 호출 → DataFrame 정규화 → `upsert_keyword_daily_from_df` / `upsert_searchword_daily_from_df` / `upsert_creative_daily_from_df` 호출.  
  - **업로드**: 키워드/검색어/소재 보고서 CSV·XLSX 업로드 → 동일 upsert 함수로 DB 적재.

### 2.2 쇼핑 검색 순위·상품 메타

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **naver_product_rank_daily** | 키워드별 쇼핑 검색 결과 순위(일자 스냅샷) | ① 쇼핑 검색 크롤(Playwright/호스트 Chrome CDP) ② 엑셀/텍스트 순위 업로드 `/search-rank/ranks/import`, `/search-rank/ranks/import-text` | `upsert_product_ranks_for_keyword` (date+keyword+rank PK upsert) |
| **tracked_product_rank_daily** | “내 상품 추적”용 수기·엑셀 순위(상품URL+키워드+일자) | 엑셀/텍스트 업로드 | API에서 동일 키(날짜+product_url+keyword) upsert |
| **tracked_product_keyword** | 추적 대상 (상품 URL + 키워드) | Web “내 상품 추적”에서 추가 / OpenAPI `POST /search-rank/tracked` | DB CRUD |
| **tracked_product_manual_keyword** | 수기 키워드(월검색량 등) 메타 | 상세 화면 등록·엑셀 import `/search-rank/manual-keywords/import` | DB upsert (product_url+keyword PK) |
| **tracked_product_meta** | 상품 URL 기준 메타(제목, 몰명, 가격, 이미지, 카테고리 등) | 쇼핑 상품 페이지(shop.json) 크롤 / `POST /search-rank/refresh-product-metadata` | DB upsert (product_url unique) |
| **tracked_competitor_product** | 추적 키워드별 경쟁 상품(이름, match_text) | Web “내 상품 추적” 경쟁상품 등록 / API `POST .../competitors` | DB CRUD |

- **순위 수집 트리거**:  
  - **쇼핑 검색 크롤**: “쇼핑검색 캡차 세션” 후 키워드·일자 지정 수집 → `upsert_product_ranks_for_keyword` 로 `naver_product_rank_daily` 적재.  
  - **카테고리 크롤**: 카테고리+키워드 기반 배치 수집(취소 가능).  
  - **수기/엑셀**: 사용자 업로드 → `tracked_product_rank_daily` 및 필요 시 `naver_product_rank_daily` 보강.

### 2.3 상품 페이지·판매·상품지수

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **tracked_product_page_daily** | 상품 상세 페이지 일자별 스냅(리뷰수, 평점, 가격, 최근 구매/재구매 배지 등) | Playwright 페이지 크롤 `POST /search-rank/page-metrics/collect-now`, `sync-today` 등 | `upsert_tracked_product_page_daily` (날짜+URL 기준, 성공 데이터 덮어쓰기 방지) |
| **tracked_product_sales_manual** | 상품별 수기 판매/매출 입력 | Web 상품지수·상세 화면 수기 입력 | `upsert_tracked_product_sales_manual` |
| **tracked_product_index_manual** | 상품지수 계산용 수기 입력(조회수, 찜, 판매량, 경과일, 지연/품절 등) | Web 상품지수 화면 | DB upsert (product_url PK) |
| **tracked_product_index_score_daily** | 상품지수 일자별 점수(클릭/판매/리뷰/최신성/패널티, 종합) | `POST /search-rank/product-index/analyze` 등 배치·단건 분석 | DB upsert (date+product_url) |

- **페이지 메트릭 수집**: “캡차 세션 시작” → 상품 URL 대상 스크래핑 → `upsert_tracked_product_page_daily` 호출.

### 2.4 구매 키워드(스마트스토어)

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **naver_smartstore_purchase_keyword_daily** | 스마트스토어 “구매 키워드” 일간(상품ID, 채널, 키워드, 결제수/결제금액) | XLSX/CSV 업로드 `POST /purchase/keywords/upload` | `replace_purchase_keyword_daily_from_df` (해당 일자+source 삭제 후 일괄 insert) |

- **수집**: 네이버 스마트스토어에서 다운로드한 구매 키워드 보고서 파일 업로드로만 적재.

### 2.5 AI 분석·A-1 배치·Trace

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **sku_zone_counts_daily** | SKU별 순위 구간(1~3, 4~6, …) 집계 | A-1 배치 `POST /ai/a1/batch/run` | 배치 시 upsert (date+surface+sku_id) |
| **sku_state_daily** | SKU 상태(VERY_STABLE, RISK_RECOVERY 등) | A-1 배치 | 배치 시 upsert |
| **sku_event_daily** | SKU 이벤트(경보) | A-1 배치 | 배치 시 upsert |
| **sku_keyword_evidence_daily** | 키워드별 근거 수치 | A-1 배치 | 배치 시 upsert |
| **sku_cause_evidence_daily** | SKU 원인 근거 요약 | A-1 배치 | 배치 시 upsert |
| **gpt_action_daily** | GPT 호출 입출력 | A-1 배치 | 배치 시 upsert |
| **ai_decision_log** | AI 판단 로그(입력 스냅샷, 판단, 규칙) | AI 분석 API 호출 시 | 로그 저장 |
| **analysis_run** | 분석 실행 1회 메타 | A-1 Trace | run_id PK |
| **analysis_trace_node** | Trace 노드(스냅샷, 쿼리, 공식 참조) | A-1 Trace | node_id PK |
| **analysis_blob** | 대용량 스냅샷(중복 제거) | A-1 Trace | blob_id, content_hash unique |
| **analysis_trace_edge** | Trace 엣지(DAG) | A-1 Trace | run_id+from+to |
| **analysis_action_review** | 사용자 수락/미수락/의견 | Web 검증 화면 | review_id PK |
| **a1_sku_map** | sku_id ↔ product_url / product_id_catalog | 설정·배치 | DB upsert |

- **수집**: AI 분석 메뉴에서 “A. 오가닉 순위 분석” 실행, “A-1 배치 실행”, “A-1 검증(역추적)” 조회 시 위 테이블들이 채워지거나 조회됨.

### 2.6 설정·시크릿

| 테이블 | 설명 | 수집 경로 | 저장 방식 |
|--------|------|-----------|------------|
| **app_settings** | API 키 등 Key-Value 설정 | Web “API 세팅” / `POST /settings/api` (마이그레이션 등) | key PK upsert |
| **ai_settings** | AI 규칙/프롬프트 등(백업은 별도 키/스토어) | Web “AI 세팅” / 설정 복원 API | ai_settings_store에서 DB/백업 관리 |

- **수집**: 설정 화면에서 입력한 값이 DB에 저장되며, API 호출 시 이 설정을 사용(SearchAd, OpenAI, 네이버 오픈API 등).

---

## 3. 메뉴별 상세 (데이터·수집·저장)

아래는 **각 서브메뉴마다** 사용 데이터, 수집 경로, 저장 방식을 A. 오가닉 순위 분석과 동일한 형식으로 정리한 블록입니다.

---

### 3.1.1 메뉴1 · A. 오가닉(검색/쇼핑) 순위 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/organic-rank` |
| **사용 데이터** | `naver_product_rank_daily`, `tracked_product_keyword`, `tracked_product_rank_daily`, A-1 배치 테이블(`sku_zone_counts_daily`, `sku_state_daily`, `sku_event_daily`, `sku_keyword_evidence_daily`, `sku_cause_evidence_daily`), `gpt_action_daily`, `ai_decision_log`, `a1_sku_map` |
| **수집** | ① 순위: “검색·쇼핑 순위 분석 → 내 상품 추적”에서 쇼핑 검색 크롤(Playwright/CDP) 또는 엑셀/텍스트 업로드(`/search-rank/ranks/import`, `/search-rank/ranks/import-text`). ② A-1 배치/단건 분석 실행 시 집계·GPT 호출. |
| **저장** | 순위 → `naver_product_rank_daily`(upsert_product_ranks_for_keyword), 수기 순위 → `tracked_product_rank_daily`. A-1 결과 → sku_*_daily, gpt_action_daily, ai_decision_log 등 배치 upsert. |

---

### 3.1.2 메뉴1 · A-1 검증(역추적) 트리

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/organic-rank/trace` |
| **사용 데이터** | `analysis_run`, `analysis_trace_node`, `analysis_blob`, `analysis_trace_edge`, `analysis_action_review` |
| **수집** | A-1 분석 실행 시 Trace API가 run/node/edge/blob을 생성·저장. 사용자가 “검증(역추적)” 화면에서 수락/미수락/의견 입력. |
| **저장** | run_id 기준 `analysis_run`; 노드·엣지·blob은 Trace 저장 로직으로 insert/upsert. 사용자 리뷰 → `analysis_action_review`. |

---

### 3.1.3 메뉴1 · B. 광고 운영 판단 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/ads-ops` |
| **사용 데이터** | 규칙 문서(AI 세팅), 향후 `naver_ad_keyword_daily` / `naver_ad_creative_daily` 등 연동 예정 |
| **수집** | 현재: “설정 → AI 세팅”에서 규칙/프롬프트 입력. |
| **저장** | AI 설정 백업 스토어(DB/파일). 아직 광고 팩트 테이블 직접 적재는 없음. |

---

### 3.1.4 메뉴1 · C. 구매·전환 기반 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/purchase-conv` |
| **사용 데이터** | 규칙 문서(AI 세팅), 향후 `naver_smartstore_purchase_keyword_daily` 등 연동 예정 |
| **수집** | 현재: AI 세팅에서 규칙/프롬프트 입력. |
| **저장** | AI 설정 백업 스토어. 구매 키워드 테이블 직접 적재는 “구매 키워드 분석” 메뉴에서만 수행. |

---

### 3.1.5 메뉴1 · D. 수요·트렌드 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/demand-trend` |
| **사용 데이터** | 규칙 문서(AI 세팅), 향후 검색량/트렌드 지표 연동 예정 |
| **수집** | 현재: AI 세팅에서 규칙 입력. |
| **저장** | AI 설정 백업 스토어. |

---

### 3.1.6 메뉴1 · E. SKU 통합 운영 정책

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/ai/sku-policy` |
| **사용 데이터** | 규칙 문서(AI 세팅), A-1 배치 테이블(sku_*_daily) 참조 가능 |
| **수집** | 현재: AI 세팅에서 규칙 입력. A-1 배치 데이터는 “A. 오가닉 순위 분석” 등에서 적재. |
| **저장** | AI 설정 백업 스토어; SKU 집계는 A-1 배치 시 sku_*_daily에 저장. |

---

### 3.2.1 메뉴2 · 광고 검색어 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/performance/ads-keywords` |
| **사용 데이터** | `naver_ad_keyword_daily`, `naver_ad_searchword_daily` |
| **수집** | ① Web “수집” → `POST /ads/collect`(SearchAd API: stat report KEYWORD/검색어). ② 키워드/검색어 보고서 CSV 업로드. |
| **저장** | `upsert_keyword_daily_from_df`, `upsert_searchword_daily_from_df` (일자+source 기준 삭제 후 upsert). |

---

### 3.2.2 메뉴2 · 구매 키워드 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/performance/purchase-keywords` |
| **사용 데이터** | `naver_smartstore_purchase_keyword_daily` |
| **수집** | 스마트스토어 “구매 키워드” 보고서 XLSX/CSV 업로드 → `POST /purchase/keywords/upload`. |
| **저장** | `replace_purchase_keyword_daily_from_df` (해당 일자+source 삭제 후 일괄 insert). |

---

### 3.3.1 메뉴3 · 캠페인 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/campaign/daily` |
| **사용 데이터** | `naver_ad_keyword_daily`를 캠페인 단위로 집계(노출/클릭/비용/전환/매출, CTR/CPC/CVR/ROAS 재계산) |
| **수집** | 키워드 일간 데이터와 동일: SearchAd `POST /ads/collect` 또는 키워드 보고서 CSV 업로드. |
| **저장** | 집계는 API 조회 시 실시간 계산. 원천 데이터는 `naver_ad_keyword_daily`에 저장. |

---

### 3.3.2 메뉴3 · 광고 그룹 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/campaign/adgroups` |
| **사용 데이터** | `naver_ad_keyword_daily`를 광고그룹 단위로 집계 |
| **수집** | 키워드 일간 데이터와 동일: SearchAd 수집 또는 키워드 CSV 업로드. |
| **저장** | 집계는 API 조회 시 실시간. 원천 데이터는 `naver_ad_keyword_daily`. |

---

### 3.3.3 메뉴3 · 소재 분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/campaign/creatives` |
| **사용 데이터** | `naver_ad_creative_daily`, `creative_organic_rank_daily_derived` |
| **수집** | ① SearchAd 소재 수집(`/ads/collect` 시 AD 리포트 + AD_CONVERSION 머지). ② 소재 보고서 CSV 업로드 → `POST /ads/creatives/upload`. |
| **저장** | `upsert_creative_daily_from_df`; 오가닉 파생은 `upsert_creative_organic_derived_many`. |

---

### 3.4.1 메뉴4 · 키워드 인사이트

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/rank/overview` |
| **사용 데이터** | SearchAd keywordstool(월검색량 등), DataLab, `naver_product_rank_daily` |
| **수집** | ① 월검색량 등: API 호출(키워드 도구/DataLab) 실시간. ② 순위: “내 상품 추적”에서 크롤/업로드로 `naver_product_rank_daily` 적재. |
| **저장** | 순위만 DB 저장(naver_product_rank_daily); 키워드 도구/DataLab 결과는 API 응답으로만 사용 가능. |

---

### 3.4.2 메뉴4 · 내 상품 추적

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/rank/tracking` |
| **사용 데이터** | `tracked_product_keyword`, `tracked_competitor_product`, `naver_product_rank_daily`, `tracked_product_rank_daily`, `tracked_product_meta` |
| **수집** | ① 추적 키워드/경쟁상품: Web “내 상품 추적”에서 등록 또는 API `POST /search-rank/tracked`, `POST .../competitors`. ② 순위: 쇼핑 검색 크롤 또는 엑셀/텍스트 업로드(`/search-rank/ranks/import`, `/search-rank/ranks/import-text`). ③ 상품 메타: shop.json 크롤 또는 `POST /search-rank/refresh-product-metadata`. |
| **저장** | 추적/경쟁상품 → CRUD. 순위 → `naver_product_rank_daily`, `tracked_product_rank_daily` upsert. 메타 → `tracked_product_meta` upsert. |

---

### 3.5.1 메뉴5 · 상품명 SEO

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/research/seo` |
| **사용 데이터** | SearchAd/DataLab(월검색량 등), 수기 키워드, SEO 규칙(설정 → SEO규칙등록) |
| **수집** | 규칙·키워드는 “설정 → SEO규칙등록” 및 화면에서 저장. 지표는 API 호출(키워드 도구/DataLab) 또는 기존 DB 조회. |
| **저장** | SEO 규칙/카테고리 사전 등은 설정용 테이블·스토어; 광고/순위 팩트는 각각 해당 테이블에 저장. |

---

### 3.5.2 메뉴5 · 해시태그 SEO

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/research/hashtag` |
| **사용 데이터** | 해시태그 규칙·수기 태그(설정/스토어) |
| **수집** | “해시태그 SEO” 화면에서 규칙·태그 입력. |
| **저장** | 설정/스토어(파일 또는 DB)에 저장. |

---

### 3.5.3 메뉴5 · 상품지수분석

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/research/product-index` |
| **사용 데이터** | `tracked_product_page_daily`, `tracked_product_index_manual`, `tracked_product_index_score_daily`, `tracked_product_sales_manual` |
| **수집** | ① 페이지 메트릭: `POST /search-rank/page-metrics/collect-now`, `sync-today`(Playwright 크롤). ② 수기 입력: 상품지수·상세 화면에서 판매/지수 수기 값 입력. ③ 점수: “상품지수 분석” 실행 → `POST /search-rank/product-index/analyze` 등. |
| **저장** | `upsert_tracked_product_page_daily`; 수기 → `tracked_product_sales_manual`, `tracked_product_index_manual`; 점수 → `tracked_product_index_score_daily` upsert. |

---

### 3.6.1 메뉴6 · 카테고리 사전

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/settings/category-dict` |
| **사용 데이터** | 카테고리 사전(대/중/소/세 등) 설정 |
| **수집** | “설정 → 카테고리 사전” 화면에서 입력. |
| **저장** | 설정용 스토어(DB/파일). |

---

### 3.6.2 메뉴6 · SEO규칙등록

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/settings/seo-rules` |
| **사용 데이터** | SEO 규칙(상품명/타이틀 등 규칙) |
| **수집** | “설정 → SEO규칙등록” 화면에서 입력. |
| **저장** | 설정용 스토어(DB/파일). |

---

### 3.6.3 메뉴6 · API 세팅

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/settings/api` |
| **사용 데이터** | `app_settings` (API 키 등 Key-Value) |
| **수집** | “설정 → API 세팅” 화면에서 키/URL 등 입력. |
| **저장** | `app_settings` 테이블 key PK upsert. SearchAd/OpenAI/네이버 오픈API 호출 시 사용. |

---

### 3.6.4 메뉴6 · AI 세팅

| 항목 | 내용 |
|------|------|
| **경로** | `/analytics/settings/ai` |
| **사용 데이터** | AI 규칙/프롬프트, 백업 목록 |
| **수집** | “설정 → AI 세팅” 화면에서 규칙·프롬프트 입력; 복원 시 백업 키 선택. |
| **저장** | ai_settings_store에서 DB 및 백업 스토어 관리. |

---

## 4. API 엔드포인트 → 테이블 매핑 (조회 위주)

| API (GET) | 테이블(또는 집계 소스) |
|-----------|-------------------------|
| `/keywords/daily` | naver_ad_keyword_daily |
| `/searchwords/daily` | naver_ad_searchword_daily |
| `/campaigns/daily` | naver_ad_keyword_daily 집계 |
| `/adgroups/daily` | naver_ad_keyword_daily 집계 |
| `/creatives/daily` | naver_ad_creative_daily |
| `/search-rank/products` | naver_product_rank_daily |
| `/search-rank/history` | naver_product_rank_daily (자사 브랜드) |
| `/search-rank/product-summary` | naver_product_rank_daily |
| `/search-rank/tracked` | tracked_product_keyword |
| `/search-rank/tracked/:id/competitors` | tracked_competitor_product |
| `/search-rank/history/comparison` | naver_product_rank_daily + tracked_* |
| `/purchase/keywords/daily` | naver_smartstore_purchase_keyword_daily |
| `/search-rank/page-metrics/*` | tracked_product_page_daily |
| `/search-rank/product-index/*` | tracked_product_index_*, tracked_product_page_daily 등 |

---

## 5. 요약

- **광고 일간 데이터**: SearchAd API 수집 또는 키워드/검색어/소재 CSV·XLSX 업로드 → `naver_ad_keyword_daily`, `naver_ad_searchword_daily`, `naver_ad_creative_daily`에 저장.  
- **쇼핑 순위**: 쇼핑 검색 크롤(Playwright/CDP) 또는 엑셀/텍스트 업로드 → `naver_product_rank_daily`, `tracked_product_rank_daily` 등에 저장.  
- **내 상품 추적·경쟁상품**: Web/API로 등록 → `tracked_product_keyword`, `tracked_competitor_product`.  
- **상품 페이지·상품지수**: 페이지 크롤 → `tracked_product_page_daily`; 수기 입력 → `tracked_product_sales_manual`, `tracked_product_index_manual`; 분석 실행 → `tracked_product_index_score_daily`.  
- **구매 키워드**: 스마트스토어 보고서 업로드 → `naver_smartstore_purchase_keyword_daily`.  
- **AI/A-1**: A-1 배치·Trace·AI 분석 호출 시 `sku_*_daily`, `gpt_action_daily`, `ai_decision_log`, `analysis_*` 테이블에 저장.  
- **설정**: Web 설정 → `app_settings` 등 DB 저장.

이 문서는 `analytics/api/db.py`, `analytics/api/main.py`, `analytics/openapi.json`, `analytics/web/.../AppShell.tsx` 기준으로 정리했습니다.
