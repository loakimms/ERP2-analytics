# 분류 예시

## 제외 후 남는 소스만 커밋

`brief.ps1`의 `KEEP`가 소스다. `JUNK`는 스냅샷·증거·임시 파일이며 커밋하지 않는다.

2026-10-11 작업 트리 기준 대략적인 크기:

- `releases/` 약 1.5GB
- `calibration/` 약 1.0GB
- `backups/` 약 3.7GB
- `tmp-local-edit-qa/` 약 151MB

이 경로를 브랜치에 넣으면 원격 저장소가 소스 저장소가 아니게 된다.

## 공유 파일

`api/main.py`, `api/db.py`, `web/src/modules/layout/AppShell.tsx`, `web/src/modules/ads/adsApi.ts`, `web/src/modules/ads/AdsViews.tsx`는 여러 메뉴가 같이 쓴다. 기능 브랜치로 쪼개지 말고 `integrate/api-web-shell` 또는 ads 브랜치 중 실제로 수정된 쪽에 한 번만 넣는다.

## 푸시 확인

```text
main ... origin/main [ahead 0]
topic branches pushed with -u
KEEP untracked source = 0
```

ahead가 남아 있으면 푸시가 끝난 것이 아니다. 제외 경로가 다시 `??`로 보이면 `.gitignore`가 그 브랜치에 없는 것이다.
