# Analytics 2개 스택 vs ERP2 1개 스택 분석

## 1. NAS 동기화 시 이미지 생성이 analytics_nas를 쓰는가?

**아니요. 이미지 생성은 analytics_nas를 사용하지 않습니다.**

- **이미지 빌드**는 `analytics_build_candidate.ps1`(또는 `analytics_rebuild_and_verify.ps1`)에서 수행하며,  
  동일한 Dockerfile로 **한 번만** 빌드해 `analytics-analytics-api:태그`, `analytics-analytics-web:태그`를 만듭니다.
- **analytics_nas**는 “이미지를 만드는 스택”이 아니라,  
  **이미 만든 이미지**를 다른 프로젝트 이름·다른 포트·다른 환경으로 **띄우는 두 번째 스택**입니다.
- NAS 동기화(`cmd-analytics-nas-sync.ps1`)는 **코드·lock·compose 파일**을 NAS로 복사할 뿐,  
  **이미지 빌드는 하지 않습니다.**  
  (NAS에 이미지를 올리는 절차가 따로 있다면, 그때도 로컬에서 빌드한 **같은 이미지**를 사용합니다.)

정리하면:

- **이미지 생성**: analytics_master용과 동일한 빌드(같은 Dockerfile, 같은 이미지 이름).
- **analytics_nas**: 그 이미지를 `analytics.nas.master.lock`에 적힌 태그로 **사용**만 함.

---

## 2. Analytics는 왜 2개 스택(analytics_master, analytics_nas)인가?

| 구분 | analytics_master | analytics_nas |
|------|------------------|----------------|
| **목적** | 로컬 표준 운영·검증 (일상 개발) | NAS 모드 구성을 **로컬 Docker에서** 시뮬레이션 |
| **Compose** | `docker/analytics.master.yml` | `docker/analytics.nas.master.yml` |
| **프로젝트 이름** | `analytics_master` | `analytics_nas` |
| **Web 포트** | 5188 | 6188 |
| **API 포트** | 5189 | 6189 |
| **DB 포트** | 5442 | 6442 |
| **기동 스크립트** | `analytics_up.ps1`, `analytics_rebuild_and_verify.ps1` 등 | `cmd-analytics-nas.ps1` |
| **Lock** | `analytics.master.lock` | `analytics.nas.master.lock` |
| **환경** | 로컬 개발용(인증 등 완화 가능) | NAS와 유사(REQUIRE_FIREBASE_AUTH 등 강제) |

두 스택이 공존하는 이유:

1. **포트 분리**  
   서로 다른 포트(5188/5189 vs 6188/6189)를 쓰므로 **동시에** 띄워 둘 수 있습니다.
2. **용도 분리**  
   - **analytics_master**: 평소 개발·검증(5188).  
   - **analytics_nas**: “NAS에서 돌 때와 비슷한 설정”을 **로컬에서** 검증(6188).
3. **규칙상 정의**  
   `.cursor/rules/command-phrases.mdc`에서  
   - “analytics 로컬 기동” → 5188/5189 (analytics_master)  
   - “analytics nas 기동” → **로컬 Docker에서** NAS 모드 시뮬레이션(6188/6189)  
   으로 정의되어 있어, **로컬에 두 종류의 기동 방식**이 있음.

즉, **실제 NAS 서버**에 배포하는 것이 아니라,  
“NAS용 설정으로 로컬에서 한 번 더 띄워서 확인하는 스택”이 analytics_nas입니다.

---

## 3. ERP2는 왜 1개 스택(erp2)만 있는가?

| 구분 | ERP2 (erp2) |
|------|-------------|
| **로컬 기동** | `cmd-erp2-local.ps1` → **한 스택** (web 5299, api 8086) |
| **NAS** | “erp2 nas 기동”은 **NAS 쪽**에서 컨테이너 up. 로컬에 “erp2_nas” 스택을 띄우지 않음. |

- ERP2-dev에서는 **로컬 = erp2 한 스택**만 쓰고,  
  NAS 배포/기동은 **별도 서버(NAS)**에서 하므로,  
  로컬 Docker에 “erp2_nas” 같은 두 번째 스택이 없습니다.
- 반면 Analytics는  
  “analytics nas 기동”을 **로컬 Docker에서 NAS 모드로 한 번 더 띄우는 것**으로 정의해 두었기 때문에,  
  **analytics_master**(5188)와 **analytics_nas**(6188) 두 스택이 함께 존재합니다.

---

## 4. 요약

- **NAS 동기화를 위한 이미지 생성**  
  → **analytics_nas를 사용하지 않음.**  
  → master와 동일한 빌드로 만든 **같은 이미지**를, 두 스택이 각자 lock에 맞는 태그로 사용.
- **Analytics가 2개 스택인 이유**  
  → 로컬에서 “표준(5188)”과 “NAS 모드 시뮬레이션(6188)”을 **동시에** 쓸 수 있도록,  
  → 프로젝트 이름·포트·환경을 나눈 **두 개의 Compose 스택**을 쓰기 때문.
- **ERP2가 1개 스택인 이유**  
  → 로컬은 erp2 한 스택만 쓰고, NAS는 로컬이 아니라 **NAS 서버**에서만 기동하기 때문.
