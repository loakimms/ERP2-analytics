---
name: analytics-git-management
description: >-
  Manages ERP2-analytics git hygiene. Classifies the dirty worktree into
  domain branches, excludes release snapshots and local evidence, commits
  source only, and pushes remote branches. Use when the user asks to commit,
  push, branch, sync, or check git status in this repository, or when git
  status is flooded by releases, calibration, backups, or timestamped docker
  copies.
---

# Analytics Git 관리

이 저장소의 작업 트리는 소스와 로컬 스냅샷이 한 폴더에 섞인다. `git status`가 수만 줄이면 소스가 깨진 것이 아니다. 아래 제외 경로가 추적되지 않은 상태다.

## 먼저 실행

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .cursor/skills/analytics-git-management/scripts/brief.ps1
```

브리핑은 한국어로 한다. 원격 비교 전에는 `git fetch`만 한다. `reset`, `clean`, `stash`, force push로 다른 변경을 지우지 않는다.

## 커밋하면 안 되는 경로

- `releases/` — candidate 스냅샷
- `calibration/` — 로컬 검토 증거
- `backups/`, `tmp-local-edit-qa/`, `%LOCALAPPDATA%/`, `$dst`
- `docker/*.analytics_YYYYMMDD_HHMMSS.yml` 와 같은 시각별 compose/lock 복사본
- `tmp_*.py`, 루트 `*.pdf`, `docs/ChatGPT Image *.png`
- `.env`, credential, pem, 서비스 계정 JSON

현재 SoT lock(`docker/analytics.candidate.lock`, `docker/analytics.master.lock`, `docker/analytics.nas.master.lock`)은 추적 대상이다. 시각이 붙은 복사본은 대상이 아니다.

사용자가 경로를 명시하기 전에는 제외 경로를 `git add -f` 하지 않는다.

## 브랜치 단위

한 커밋에 작업 트리 전체를 넣지 않는다. `main`에서 아래 브랜치를 만들고, 파일은 한 브랜치에만 넣는다.

| 브랜치 | 포함 |
|---|---|
| `chore/git-hygiene` | `.gitignore`, 이 스킬 |
| `ops/forward-only-baseline` | `.cursor/rules`, `governance/`, 재빌드·기동 스크립트, 추적 중인 compose/lock |
| `ops/host-agent` | `tools/host-agent.ps1`, Host Chrome, installer, `hostAgentRelease.ts` |
| `feat/content-center` | `api/content_*`, content web, content docs |
| `feat/review-reply-knowledge` | `api/review_reply_*`, reviews web |
| `feat/gfa-creative` | `api/gfa_*`, GFA web, GFA scripts |
| `feat/ads-rank-research` | ads/rank/research/ai web, rank API tests |
| `feat/settings-menu-sync` | menu sync, settings web |
| `feat/why-sku-platform` | why/sku/evidence/external context |
| `integrate/api-web-shell` | `api/main.py`, `api/db.py`, `api/schemas.py`, `App.tsx`, `AppShell*`, `styles.css` |
| `docs/analytics-specs` | 위 표에 안 들어간 `docs/` |

어느 표에도 없는 소스 파일이 있으면 커밋을 멈추고 브랜치를 추가한다. 추측으로 `main`에 몰아넣지 않는다.

## 커밋과 푸시

1. `git restore --staged`로 인덱스에 남은 무관한 파일을 내린다. 작업 트리 내용은 유지한다.
2. 각 브랜치를 현재 `main`에서 만들고, 그 브랜치 파일만 `git add` 한 뒤 커밋한다.
3. 커밋 메시지는 기존 이력처럼 영어 한 문장으로 쓴다. 이유 한 줄을 더한다.
4. 브랜치로 나눈 뒤 Canonical 작업 폴더에 코드를 남기려면, 각 브랜치를 `main`에 `--no-ff`로 병합한다.
5. 사용자가 푸시를 요청한 경우에만 `git push -u origin <branch>`를 한다. `--force`는 쓰지 않는다.
6. 푸시 후 `brief.ps1`로 ahead/behind와 남은 미추적 소스가 0인지 확인한다.

Production 이미지 빌드 입력은 이 작업 트리가 아니다. 빌드는 `scripts/analytics_rebuild_and_verify.ps1`과 candidate snapshot 규칙을 따른다.

## 추가 자료

- 제외 규칙과 브랜치 예시: [reference.md](reference.md)
