# 메뉴 4-2 전환 기반 메인/서브 키워드 분류 — 구현 계획

## 1. 목표 요약

- **현재**: 메뉴 4-2 "내 상품 추적"은 추적 키워드 + 연관키워드(수기입력 키워드)를 **수동**으로만 관리.
- **목표**: 메뉴 2-1(광고 검색어), 2-2(구매 키워드)의 **최근 30일 전환 데이터**를 이용해 키워드를 **메인/서브(및 관찰)** 로 자동 분류하고, UI에서 그룹·헤더·색상으로 표시. 사용자 오버라이드 시 자동 재계산이 덮어쓰지 않도록 유지.

### 1.1 작업 성격: 데이터 유지, 분류·표시만 변경

- **기존 키워드 데이터는 그대로 유지한다.**
  - `tracked_product_keyword`, `tracked_product_manual_keyword` 테이블 및 레코드는 **추가/삭제/수정하지 않음**.
  - 수기입력 키워드(연관키워드 100개) 목록·추적 키워드 목록은 **현재와 동일**하게 유지.
- **변경되는 것은 다음 세 가지뿐이다.**
  1. **분류(자동 계산)**: 2-1·2-2 전환 데이터를 분석해 각 키워드에 메인/서브/관찰 **역할(role)** 을 **계산**하여 별도 테이블에 저장.
  2. **그룹**: 화면에서 키워드를 **메인 키워드 / 서브 키워드** 그룹으로 나누어 표시.
  3. **표시**: 수기 입력 키워드 표의 헤더를 "추천 키워드" → "키워드 분류"로 변경하고, 셀에 **분류값(MAIN/SUB/WATCH)** 및 **색상**으로 표시.
- **정리**: 수동 분류에서 벗어나, **명확한 근거(2-1·2-2 데이터 분석)** 를 통한 **자동 그룹 분류**로 전환하는 작업이다. 키워드 데이터 자체를 바꾸는 것이 아니라, **데이터의 그룹·분류·표시만** 바꾼다.

---

## 2. 개념·데이터 연결

### 2.1 메인/서브/관찰 정의

| 분류 | 정의 | 특성 |
|------|------|------|
| **메인(MAIN)** | 최근 30일, 2-1/2-2에서 전환이 **지속적**으로 발생해 해당 상품 매출에 실질 기여 | 전환 빈도·발생 일수 높음, 여러 날에 분산 |
| **서브(SUB)** | 전환은 있으나 빈도/일수는 낮거나, 최근 7~14일 내 첫 전환 등 | 잠재 후보, 보조 역할 |
| **관찰(WATCH)** | 클릭은 있으나 전환 0 (옵션) | 노출/클릭용, 추후 메인/서브 후보 |

### 2.2 데이터 소스 연결

| 메뉴 | 테이블 | 식별자 | 전환 관련 컬럼 |
|------|--------|--------|----------------|
| **2-1** 광고 검색어 | `naver_ad_keyword_daily` | date, campaign_name, adgroup_name, **keyword**, device | conversions, revenue, clicks, cvr |
| **2-2** 구매 키워드 | `naver_smartstore_purchase_keyword_daily` | date, **product_id**, channel_*, **keyword** | payments(결제수), amount(결제금액) |
| **4-2** 내 상품 추적 | `tracked_product_keyword`, `tracked_product_manual_keyword` | **product_url**, **keyword** | — |
| **연결** | `tracked_product_meta` | product_url → **product_id_catalog** | — |

- **2-1**: 상품 단위가 없음. 4-2에서 **해당 상품이 추적하는 키워드 집합**만큼 2-1을 키워드별로 집계한 뒤, 그 키워드를 해당 product_url에 귀속.
- **2-2**: `product_id`로만 집계 가능. `product_url` → `tracked_product_meta.product_id_catalog`로 매핑 후, 동일 product_id + keyword 기준 30일 집계.

---

## 3. 분류 기준 (30일 롤링)

### 3.1 분석 범위

- **기간**: 최근 30일 (오늘 기준 0~29일 전).
- **단위**: (product_url, keyword). 키워드 풀 = `tracked_product_keyword` + `tracked_product_manual_keyword` (동일 product_url).

### 3.2 지표 정의 (30일)

| 지표 | 2-1 (광고) | 2-2 (구매) | 합산/통합 |
|------|------------|------------|-----------|
| **CV** | SUM(conversions) | SUM(payments) 또는 결제 건수 | CV_30d = CV_ad + CV_purchase |
| **CV_DAYS** | COUNT(DISTINCT date WHERE conversions > 0) | COUNT(DISTINCT date WHERE payments > 0) | CV_DAYS_30d = 합집합 일수 |
| **CLICK** | SUM(clicks) | — | CLICK_30d (2-1만) |
| **CVR** | 전환수/클릭수 (키워드별) | — | CVR_30d (2-1만, 2-2는 별도 보조) |

- 2-2는 “구매 키워드”이므로 `payments`를 전환 건수로 취급해 CV_30d에 합산하거나, 별도 컬럼(CV_purchase_30d)으로 두고 규칙에서 함께 사용.

### 3.3 메인/서브/관찰 규칙 (안)

- **상품 단위 기준선** (30일):
  - 해당 product_url의 키워드 풀에 대해: CV_30d 상위 20% 임계값, 평균 CVR, CV_DAYS 평균 등.
- **메인(MAIN)**  
  아래 중 **2개 이상** 충족 시 메인:
  - CV_30d ≥ 상품 상위 20% 키워드 CV 임계값
  - CV_DAYS_30d ≥ N일 (권장 5~7일)
  - CV_FREQ_30d (= CV_30d / 30) ≥ 임계값 (예: 0.2)
  - CVR_30d ≥ 상품 평균 CVR (2-1만 해당)
- **서브(SUB)**  
  - CV_30d ≥ 1 이고 메인 조건 미충족  
  - 또는 최근 7~14일 내 첫 전환 발생(신규 전환 키워드).
- **관찰(WATCH)** (옵션)  
  - CLICK_30d ≥ 1, CV_30d = 0.

미충족 시 기본값: **SUB** 또는 **WATCH**(전환 0일 때).  
임계값(N일, CV_FREQ, 상위 20% 등)은 설정 테이블 또는 환경변수로 두고 추후 튜닝.

---

## 4. 데이터 구조 변경

### 4.1 기존 테이블: 변경 없음

- **`tracked_product_keyword`**, **`tracked_product_manual_keyword`** 는 **스키마·데이터 모두 그대로** 둔다.
- 수기입력 키워드 추가/삭제/편집은 기존대로 유지. 이번 작업에서는 **분류용 데이터만 추가**하고, 표시만 바꾼다.

### 4.2 신규 테이블: `tracked_keyword_classification` (분류·표시용만)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| product_url | VARCHAR (PK) | 상품 URL (정규화된 base URL 권장) |
| keyword | VARCHAR (PK) | 키워드 |
| role | VARCHAR | 'MAIN' \| 'SUB' \| 'WATCH' |
| computed_at | TIMESTAMPTZ | 마지막 자동 계산 시각 |
| user_override | BOOLEAN | 사용자가 수동으로 역할을 바꾼 경우 True |
| cv_30d | INTEGER | 30일 전환 합 (참고용) |
| cv_days_30d | INTEGER | 전환 발생 일수 (참고용) |
| source | VARCHAR | 'auto' \| 'manual' |

- **PK**: (product_url, keyword).  
- **역할**: 기존 키워드 목록에 **역할(role)** 과 **근거 지표**를 붙여서 **그룹·표시**할 때만 사용. 키워드 자체를 추가/삭제하는 테이블이 아님.
- **user_override = True** 이면 일일/배치 재계산 시 해당 행을 **덮어쓰지 않음**.

---

## 5. 백엔드 처리 흐름

### 5.1 30일 집계 (product_url 1건 기준)

1. **키워드 풀 수집**  
   - `tracked_product_keyword` + `tracked_product_manual_keyword` 에서 해당 product_url의 (keyword) 리스트.
2. **product_id 조회**  
   - `tracked_product_meta` 에서 product_url → product_id_catalog.
3. **2-1 집계** (keyword 단위)  
   - `naver_ad_keyword_daily` 에서 date >= today-30, keyword IN (키워드 풀)  
   - GROUP BY keyword → SUM(conversions), SUM(clicks), COUNT(DISTINCT date WHERE conversions>0), CVR.
4. **2-2 집계** (product_id + keyword)  
   - product_id_catalog 존재 시 `naver_smartstore_purchase_keyword_daily` 에서 date >= today-30, product_id = product_id_catalog, keyword IN (키워드 풀)  
   - GROUP BY keyword → SUM(payments), COUNT(DISTINCT date WHERE payments>0).
5. **합산**  
   - 키워드별 CV_30d, CV_DAYS_30d, CLICK_30d, CVR_30d (및 필요 시 CV_purchase_30d) 계산.
6. **기준선 계산**  
   - 해당 상품 키워드 풀 기준 CV_30d 상위 20% 값, 평균 CVR 등.
7. **규칙 적용**  
   - 메인/서브/관찰 규칙에 따라 role 결정.
8. **저장**  
   - `tracked_keyword_classification` 에 UPSERT.  
   - 단, user_override = True 인 (product_url, keyword) 는 업데이트하지 않음.

### 5.2 API 설계

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/search-rank/keyword-classification/compute` | 쿼리: product_url (필수). 30일 집계 후 분류 계산 및 저장. user_override 행은 스킵. |
| GET | `/search-rank/keyword-classification` | 쿼리: product_url. 해당 상품의 (keyword, role, cv_30d, cv_days_30d, user_override) 목록 반환. |
| PATCH | `/search-rank/keyword-classification` | Body: product_url, keyword, role. 사용자 지정 role 저장, user_override=True 설정. |

- 조회 시 4-2에서 쓰는 “추적 키워드 + 수기 키워드” 목록과 **같은 product_url**을 넘기면, 해당 목록에 대해 분류 결과를 붙여서 반환하는 형태로 설계.

### 5.3 배치 (선택)

- 매일 새벽 또는 주기적으로, **내 상품 추적에 등록된 product_url** 목록을 대상으로 `keyword-classification/compute` 호출.  
- user_override=True 인 셀은 계속 유지.

---

## 6. 프론트엔드(메뉴 4-2) 변경

- **전제**: 수기입력 키워드·추적 키워드 **목록 자체는 기존 API/데이터 그대로** 사용. 변경하는 것은 **헤더·그룹·칸에 보여주는 분류값과 색상**뿐.

### 6.1 수기 입력 키워드 표

- **헤더**  
  - 기존 "추천 키워드" → **"키워드 분류"** 로 변경.
- **셀 표시**  
  - 각 키워드(기존 목록 그대로)에 대해 **계산된** `role` (MAIN / SUB / WATCH) 표시.  
  - **색상**: 메인 = 진한 초록(또는 빨강 포인트), 서브 = 노랑, 관찰 = 회색.  
  - 텍스트와 색상 동시 사용 (접근성·가독성).
- **데이터 소스**  
  - 기존 수기 키워드 목록 API는 그대로 호출.  
  - GET `/search-rank/keyword-classification?product_url=...` 결과를 키워드 기준으로 **매핑만** 해서 칸에 **분류값·색상**만 채움.  
  - 분류가 없으면 빈 칸 또는 "미분류", 색상 없음.

### 6.2 추적 키워드 영역 (상단)

- **그룹 표시**  
  - "메인 키워드" / "서브 키워드" 두 그룹으로 **표시만** 나누거나,  
  - 한 리스트 안에서 뱃지/색으로 MAIN/SUB 구분.
- **데이터**  
  - 추적 키워드 목록은 **기존대로** TrackedProductKeyword 기준.  
  - `keyword-classification` 결과를 **붙여서** 그룹·뱃지·색상만 적용. 키워드 추가/삭제는 기존 로직 유지.

### 6.3 자동 계산 트리거

- 상품 상세(4-2) 진입 시:  
  - GET classification 호출.  
  - 없거나 오래되었으면 "분류 계산" 버튼 노출 또는 자동으로 POST compute 1회 호출 후 다시 GET.
- "분류 계산" 버튼:  
  - POST `/search-rank/keyword-classification/compute?product_url=...` 호출 후 목록/표 갱신.

### 6.4 사용자 오버라이드

- 수기 입력 키워드 표 또는 추적 키워드에서 role 셀/뱃지를 클릭하면 MAIN/SUB/WATCH 중 선택.  
- PATCH `/search-rank/keyword-classification` 로 저장.  
- 이후 자동 재계산 시 해당 (product_url, keyword) 는 건드리지 않음.

---

## 7. 작업 순서 (권장)

| 단계 | 작업 | 산출물 |
|------|------|--------|
| 1 | DB: `tracked_keyword_classification` 테이블 추가, init_db 반영 | db.py, 마이그레이션(필요 시) |
| 2 | 백엔드: 30일 집계 함수 (2-1 + 2-2, product_url → keyword별 CV/CV_DAYS/CLICK/CVR) | api 내부 모듈 |
| 3 | 백엔드: 메인/서브/관찰 규칙 함수 (임계값 파라미터화) | 동일 |
| 4 | API: POST compute, GET classification, PATCH override | main.py 라우트 |
| 5 | 프론트: GET classification 연동, 수기 입력 키워드 표 헤더 "키워드 분류" + 셀 role/색상 | RankTrackingDetailView 등 |
| 6 | 프론트: 추적 키워드 메인/서브 그룹 또는 뱃지 표시 | 동일 |
| 7 | 프론트: "분류 계산" 버튼 및 PATCH 오버라이드 UI | 동일 |
| 8 | (선택) 배치: 등록 상품에 대해 주기적 compute | 스크립트 또는 스케줄러 |

---

## 8. 주의사항·확장

- **2-1과 상품 연결**: 2-1은 campaign/adgroup/keyword만 있으므로, "이 상품이 추적하는 키워드"에 대해서만 2-1을 집계해 해당 상품에 귀속. 동일 키워드를 여러 상품이 추적하면 각 상품별로 따로 집계·분류.
- **2-2와 product_id**: `tracked_product_meta.product_id_catalog`가 없으면 2-2 집계 불가. 메타 미존재 시 2-1만으로 분류하거나, 2-2는 0으로 두고 진행.
- **임계값**: N일(5~7), CV_FREQ(0.2), 상위 20% 등은 초기값을 두고, 추후 `app_settings` 또는 전용 설정 테이블로 옮겨 운영 중 조정 가능하게 할 수 있음.
- **이력**: 추후 "승격/강등" 분석을 위해 `tracked_keyword_classification_history` (product_url, keyword, role, computed_at) 같은 이력 테이블을 두면, 일 단위 재계산 시 이전 분류를 저장해 둘 수 있음.

---

## 9. 최종 체크리스트

- [ ] **기존 키워드 데이터 유지**: `tracked_product_keyword`, `tracked_product_manual_keyword` 스키마·데이터 변경 없음.
- [ ] `tracked_keyword_classification` 테이블 추가 및 init_db (분류·표시용만).
- [ ] 30일 2-1/2-2 집계 로직 (product_url → 기존 키워드 풀 → CV/CV_DAYS/CLICK/CVR).
- [ ] 메인/서브/관찰 규칙 적용 및 user_override 미덮어쓰기.
- [ ] POST compute, GET classification, PATCH override API.
- [ ] 4-2 수기 입력 키워드 표: 헤더 "키워드 분류", 셀에 role+색상 **표시만** 추가.
- [ ] 4-2 추적 키워드: 메인/서브 **그룹·뱃지 표시**만 추가 (목록 데이터는 기존 유지).
- [ ] 분류 계산 버튼 및 오버라이드 UI.
- [ ] (선택) 배치 및 이력 테이블.

**요약**: 수기입력 키워드는 그대로 두고, **분류 작업(자동 계산) 및 표시(그룹·헤더·색상)** 만 변경한다. 데이터를 바꾸는 것이 아니라 **데이터의 그룹·분류·표시만** 바꾸는 작업이다.

이 계획서대로 진행하면 메뉴 4-2가 "수동 분류"에서 **명확한 근거(데이터 분석)를 통한 자동 그룹 분류**로 전환되며, 2-1·2-2 → 4-2 → 5-1·5-2·5-3 순환 구조의 핵심 축이 된다.
