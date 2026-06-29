# 불변 태그 → candidate 검증 → PASS 승격 흐름 검증

## 규칙(SoT)

- `.cursor/rules/analytics-roll-back-prevention.mdc` (ERP2-dev에 상주)
- **단일 진실**: `docker/analytics*.lock`의 `ANALYTICS_IMAGE_TAG`
- **불변 태그**: 매 빌드 `analytics_YYYYMMDD_HHMMSS`
- **표준 실행**: `scripts/analytics_rebuild_and_verify.ps1`

## 흐름 일치 여부

| 단계 | 규칙 요구 | 실제 스크립트 | 일치 |
|------|-----------|----------------|------|
| 1. 불변 태그 생성 | 매 빌드 새 태그 | `analytics_build_candidate.ps1` → `analytics_YYYYMMDD_HHMMSS`, `analytics.candidate.lock` 갱신 | ✅ |
| 2. candidate 검증 | lock으로 기동 후 증거 확인 | `analytics_switch_to_candidate_and_verify.ps1` → `--env-file candidate.lock`, version.json / /api/version 확인 | ✅ |
| 3. PASS 승격 | candidate → master | `analytics_promote_or_rollback.ps1 -Result PASS` → candidate.lock 내용을 master.lock에 반영, web/api 재기동 | ✅ |
| 4. FAIL 롤백 | master 유지 | `analytics_promote_or_rollback.ps1 -Result FAIL` → master.lock 기준으로 web/api 재기동 | ✅ |
| 5. 일상 기동 | master lock만 사용 | `analytics_up.ps1` → `--env-file docker/analytics.master.lock` | ✅ |
| 6. compose fail-fast | 태그 없으면 기동 불가 | `analytics.master.yml`에서 `ANALYTICS_IMAGE_TAG`를 `:?`로 필수 처리 | ✅ (수정 반영됨) |

## 스크립트 호출 관계

```
analytics_rebuild_and_verify.ps1
  ├─ analytics_build_candidate.ps1     → 새 태그 + candidate.lock
  ├─ analytics_switch_to_candidate_and_verify.ps1  → candidate로 up + 증거 검증
  └─ analytics_promote_or_rollback.ps1
       ├─ VERIFY OK → -Result PASS (candidate → master.lock, master 기준 재기동)
       └─ VERIFY FAIL → -Result FAIL (master.lock 기준 재기동)
```

## 결론

- **불변 태그 → candidate 검증 → PASS 승격** 로직은 규칙과 맞게 구현되어 있으며, 재빌드/재기동 시 `analytics_rebuild_and_verify.ps1` 한 번으로 위 흐름이 그대로 수행된다.
- `analytics.master.yml`은 기존 `:-latest` 폴백을 제거하고 `:?` fail-fast로 수정해, `--env-file` 없이 기동하면 실패하도록 맞춰 두었다.
