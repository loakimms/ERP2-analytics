# Analytics 개선 기획/실행 문서 (ERP2 “되돌림 방지” 체계 이식)

> 목적: “확인한 최신 UI/기능이 재기동/정리(prune)/복구 이후에도 동일하게 재현”되도록, ERP2에서 정립된 **되돌림 방지(Immutable Tag + Lock + Verify/Promote + Evidence + Backup)** 체계를 Analytics 운영/개발에 이식한다.
>
> 참고(ERP2 기준 문서/원칙):
> - `ERP2-dev/docs/UI_ROLLBACK_POSTMORTEM.md`
> - `ERP2-dev/docs/OPS_CHECKLIST.md`
> - `ERP2-dev/docs/FOLDER_POLICY.md`
> - `ERP2-dev/docker/master.lock`, `ERP2-dev/docker/candidate.lock`

---

## 1) 배경 / 문제 정의 (Analytics의 현재 증상)

- **증상**: “분명 마지막에 확인한 최신 UI(예: 핵심 키워드만 로딩)가 있었는데, 어느 순간 옛날 UI로 보임” 또는 “백업에 web 이미지가 없다/최신이 안 보인다”로 체감.
- **핵심 위험**: 실제 코드가 되돌아간 게 아니라도, 운영 절차가 흔들리면 사용자 입장에서는 “되돌림”이 반복적으로 체감된다.

ERP2의 결론(재발 원인 패턴)은 Analytics에도 그대로 적용된다.

- **R1. latest 태그 덮어쓰기**: “최신”을 구분 없이 덮어써서 최신이 사라진 것처럼 보임
- **R2. lock 부재/미준수**: 기동 시점에 어떤 이미지가 선택되는지 흔들림
- **R3. 스택/포트/프로젝트 혼선**: 다른 컨테이너/다른 포트를 보고 “되돌림”으로 체감
- **R4. prune 영향**: 태그가 불명확하거나 미참조 이미지가 정리되어 “사라짐”
- **R5. 컨테이너 내부/번들 혼용(있었다면)**: `docker cp` 류 덮어쓰기 후 재기동 시 원본 이미지로 돌아가 “되돌림” 착시

---

## 2) 목표(성공 기준)

- **G1. 되돌림 불가능**: “확인한 버전”이 재기동/정리(prune)/복원 이후에도 동일하게 재현
- **G2. 단일 진실(SoT)**: “현재 운영 중인 Analytics 버전”은 **lock 파일 1개**로만 결정
- **G3. 증거 3종 세트로 즉시 판정**(감으로 판단 금지)
  - Docker: `docker ps` 에서 **실제 컨테이너의 이미지 태그**
  - Web: `http://localhost:<webPort>/version.json` 의 `imageTag/buildTime/gitSha`
  - API: `http://localhost:<apiPort>/api/version`(또는 동등 엔드포인트) 의 `imageTag/buildTime/gitSha`
- **G4. 완전 백업**: 프로젝트 폴더가 사라져도 “백업 폴더만으로” 복구/기동 가능

---

## 3) 현재 상태(확인된 구현/파일)

### 3.1 운영/배포 뼈대(Analytics 레포 내부에 구축됨)

이제 Analytics는 ERP와 **완전히 분리 운영**한다. 따라서 운영의 단일 진실(SoT)인 lock/compose/scripts는 **`C:\dev\ERP2-analytics` 레포 내부**에 존재한다.

- **Lock(SoT)**:
  - `docker/analytics.master.lock`
  - `docker/analytics.candidate.lock`
- **Compose(고정 스택)**:
  - `docker/analytics.master.yml` (프로젝트명/포트 고정)
- **스크립트(허용 경로만)**:
  - `scripts/analytics_build_candidate.ps1` (불변 태그 빌드 + candidate.lock 갱신)
  - `scripts/analytics_switch_to_candidate_and_verify.ps1` (candidate 전환 + 증거 검증)
  - `scripts/analytics_promote_or_rollback.ps1` (PASS 승격/FAIL 롤백 + 자동 백업)
- **백업 산출물(완전복구용)**:
  - `_backups/<target>/<tag>/`
    - `analytics_images_<tag>.tar` (web/api 이미지)
    - `manifest.json` (증거/메타)
    - `restore.ps1` (백업만으로 재기동)
    - `analytics.master.yml`, `analytics.master.lock` (동봉본)

### 3.2 Analytics 스택 고정값(이미 확정된 값)

ERP2-dev의 compose 기준으로 “혼선 방지용 확정값”은 다음과 같다.

- **Local(개발/운영 단일 스택)**:
  - 프로젝트명: `analytics_master`
  - web: `5188`
  - api: `5189`
  - db: `5442`
- **NAS(운영 단일 스택)**:
  - 프로젝트명: `analytics_nas`
  - web: `6188`
  - api: `6189`
  - db: `6442`

### 3.3 Analytics 코드 측(이 레포: `C:\dev\ERP2-analytics`)

이 레포에는 이미 아래 요소들이 존재한다.

- **API(FastAPI)**: `api/`
  - `api/firebase_auth.py` (Firebase 토큰 검증 로직 존재)
  - `api/main.py`
  - 관련 테스트 파일들이 존재(예: `api/test_auth_middleware.py`, `api/test_firebase_auth_verify.py`)
- **Web**: `web/` (Vite 기반)
- **기존 운영 파일**: 루트 `docker-compose.yml`, `backup-analytics.ps1` 등

> 트랜스크립트 기준으로 Web의 “로그인 화면 + 설정 메뉴의 버전 관리 UI”는 구현된 것으로 기록되어 있으며,
> 남은 핵심은 **(A) API에서 토큰 검증을 ‘구조적으로 강제’**하고,
> **(B) version.json + /api/version 증거 경로를 완성**하여 운영 판단이 흔들리지 않게 하는 것이다.

---

## 4) 핵심 해결 전략(ERP2 패턴 그대로)

### S1. 불변 태그(Immutable Tag)만 사용

- **금지**: `latest` 를 “검증 완료 버전”으로 사용
- **표준**: 매 빌드마다 새로운 태그
  - 예: `analytics_<yyyymmdd_hhmmss>` 또는 `analytics-web:<version>_<ts>`, `analytics-api:<version>_<ts>`

### S2. 2단계 lock(검증 → 승격)

- `analytics.candidate.lock` : 후보 태그
- 검증 PASS 시 `analytics.master.lock` 로 승격
- FAIL 시 즉시 master로 롤백

### S3. 단일 스택 원칙(프로젝트명/포트 고정)

- 로컬은 `analytics_master` 1개만, NAS는 `analytics_nas` 1개만
- verify가 필요하면 “필요할 때만” 격리된 별도 스택으로 (상시 다중 스택 금지)

### S4. 빌드/기동/검증/승격을 스크립트로 강제(사람이 compose 직접 치지 않게)

운영/검증은 “허용 스크립트만”으로 한다.

- 후보 빌드 + lock 갱신: `analytics_build_candidate.ps1`
- candidate로 전환 + 증거 검증: `analytics_switch_to_candidate_and_verify.ps1`
- PASS/FAIL 반영: `analytics_promote_or_rollback.ps1`

### S5. “확인 완료 즉시” 이미지 백업 자동화(누락 방지)

PASS 시점에 다음을 자동 수행(필수화):

- `docker save` 로 web/api 이미지 tar 생성
- `manifest.json`(또는 텍스트)로 다음을 기록
  - 태그, buildTime, gitSha, web/api image digest, compose 파일/lock 파일 스냅샷

> 이 부분은 현재 스크립트 체계에 “추가 구현”이 필요할 수 있다. (G4/“web 이미지 누락” 재발을 구조적으로 제거하는 핵심)

### S6. 단일 폴더 실행 강제(CANONICAL_ROOT)

- 복사본/백업폴더에서 실행하면 스택이 섞여 “되돌림”이 재발한다.
- ERP2 방식처럼 “정본 폴더에서만 실행”을 스크립트에서 강제한다.

---

## 5) 증거(Version Evidence) 설계 — 되돌림 판정의 기준

### 5.1 Web: `/version.json` (정적 파일)

- 빌드 산출물(`dist/`)에 반드시 포함
- 최소 필드:
  - `appVersion`
  - `imageTag`
  - `buildTime`
  - `gitSha`
- Nginx에서 **`location = /version.json`** 을 별도로 두어 SPA 폴백(index.html)로 “가짜 200”이 나오지 않게 한다.

### 5.2 API: `/api/version` (무인증 조회 허용)

- 운영 검증 스크립트가 호출할 수 있도록 **무인증**으로 조회 가능해야 한다.
- 최소 필드:
  - `imageTag`
  - `buildTime`
  - `gitSha`
- 단, 나머지 API는 인증을 요구하도록 “구조적으로” 고정한다.

### 5.3 Docker: `docker ps` 이미지 태그

- 최종 판정은 반드시 `docker ps`의 실체로 확인한다.
- “버전이 맞다”는 판단을 **UI 느낌/브라우저 캐시/추측**으로 하지 않는다.

---

## 6) 요구사항 3가지(로그인/버전관리/되돌림방지) 연결 정리

### (1) 로그인 + Firebase 토큰 적용

- Web에 로그인 화면이 있어도, API가 인증을 강제하지 않으면 “구조적 차단”이 아니다.
- 목표는 “API에서 Firebase 토큰 검증을 강제 + public endpoint만 예외”다.
  - 예외(권장): `/health`, `/api/version`
  - 그 외: Authorization Bearer 토큰 필수(401)

### (2) 설정 메뉴에서 버전 관리 추가

- “버전 관리 화면”은 단순 UI가 아니라, **증거 3종 세트를 사용자에게 보여주는 창**이어야 한다.
- 권장 표시:
  - Web: `/version.json` 결과
  - API: `/api/version` 결과
  - (선택) 현재 baseUrl, authMode(로컬/운영), 마지막 검증 시각

### (3) ERP와 동일한 재발 방지 만들기

- Immutable Tag + Lock + Verify/Promote + Evidence + Backup의 5종 세트로 완성한다.

---

## 7) 실행 단계(추천 순서)

### Phase A (1회 구축/정착)

- lock/compose/scripts 체계를 “Analytics 운영 표준”으로 문서화
- Web `/version.json`, API `/api/version` 증거 경로를 확정
- 검증 스크립트가 “증거 3종 세트”로 PASS/FAIL을 판정하도록 고정

### Phase B (현 이슈 해결)

- “핵심 키워드만 로딩” 최적화 등 기능 변경이 있다면 candidate로 빌드
- candidate 전환 → 검증 PASS → master 승격
- UI가 “되돌림”으로 느껴지면, 무조건 증거 3종으로 먼저 판정

### Phase C (재발 방지 고도화)

- 승격 시점 자동 백업(docker save + manifest + restore.ps1) 완성
- prune/정리 전 master.lock 기준 이미지 선백업 규칙을 체크리스트로 고정

---

## 8) 운영 규칙(반드시 문서로 고정)

- **O1. 검증 완료 버전은 불변 태그 + master.lock에만 존재**
- **O2. latest는 개발 임시용으로만(운영/백업/검증 기준 금지)**
- **O3. 스택 1개만 유지(verify는 정말 필요할 때만)**
- **O4. prune 전에 master.lock 기준 이미지 docker save로 먼저 보관**
- **O5. 증거 3종 세트로만 판단(감으로 판단 금지)**
- **O6. 컨테이너 내부 파일 덮어쓰기(`docker cp` 류) 금지**

---

## 9) 체크리스트(구현/검증 관점)

### 9.1 API 인증(구조적 차단)
- [ ] `REQUIRE_FIREBASE_AUTH=1`에서 보호된 엔드포인트가 무토큰 시 401
- [ ] `/health`, `/api/version`은 무인증 OK
- [ ] clock skew 대응(`FIREBASE_AUTH_CLOCK_SKEW_SECONDS`) 확인

### 9.2 버전 증거
- [ ] Web `/version.json`이 **실제 JSON**을 반환(index.html 폴백 금지)
- [ ] API `/api/version`이 lock의 `ANALYTICS_IMAGE_TAG`와 일치
- [ ] 스크립트 검증이 mismatch 시 즉시 실패하도록 동작

### 9.3 운영 자동화/백업
- [ ] PASS 승격 시 `docker save`로 web/api 이미지 백업이 자동 생성
- [ ] 백업 폴더에 `manifest`와 `restore.ps1`(또는 동등 절차)가 포함

---

## 10) 다음 액션(실제 개발 작업으로 연결)

1. **(필수) API `/api/version` + 인증 강제(401 차단) 상태를 테스트로 확정**
2. **(필수) Web `/version.json` 생성/서빙을 빌드 산출물로 강제**
3. **(필수) PASS 시 자동 이미지 백업(docker save) 추가**
4. **(선택) 운영 파일(lock/compose/scripts)을 Analytics 레포로 이관하여 G4(완전복구) 강화**

---

## 부록 A) 운영 흐름(표준: Analytics 레포에서 단독 운영)

> 아래 절차만 사용한다(직접 `docker compose up/build` 금지).

- 표준(추천): **빌드→검증→승격/롤백**을 한 번에 자동 수행

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_rebuild_and_verify.ps1
```

- 후보 빌드(불변 태그 생성 + `docker/analytics.candidate.lock` 갱신):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_build_candidate.ps1
```

- candidate로 전환 + 증거 검증(웹 `version.json` / API `health` / API `api/version`):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_switch_to_candidate_and_verify.ps1
```

- PASS 승격(= master.lock 갱신 + 재기동 + 자동 백업 + restore.ps1 생성):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_promote_or_rollback.ps1 -Result PASS
```

- FAIL 롤백(= master.lock으로 복귀 재기동):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_promote_or_rollback.ps1 -Result FAIL
```

### 재기동만 필요할 때(빌드 없음)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\analytics_up.ps1
```

### “멈춤”처럼 보일 때(반복 로그)

- Nginx의 `start worker process ...` 로그는 **정상 기동 로그**이며, 그 자체로 멈춤이 아니다.
- 실제로 오래 걸리는 구간은 보통 **이미지 백업(docker save)** 이다.
  - 스크립트는 반복 실행 시 `_backups/.../*.tar`가 이미 있으면 **기본으로 docker save를 스킵**한다.
  - 정말 다시 만들고 싶으면 `-ForceBackup`을 사용한다.

