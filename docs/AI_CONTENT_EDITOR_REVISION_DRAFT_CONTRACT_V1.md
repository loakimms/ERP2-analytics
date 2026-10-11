# AI Content Editor Revision / Draft Save Contract v1

작성일: 2026-08-25

## 목적

AI 콘텐츠 센터의 에디터에서 사람의 수정, 임시 저장, 다시 생성, 검수 승인, 게시 연결을 다룰 때 AI 원본과 Human revision, 실제 게시본, 성과 귀속 대상이 섞이지 않도록 계약을 고정한다.

이번 문서는 구현 계약이다. 이 문서가 통과된 뒤 React Live UI와 Editor API를 연결한다.

## 핵심 경계

Static HTML:

- 디자인 reference다.
- 운영 UI가 아니다.
- 실제 구현은 React/AppShell/Auth/API 구조 안에서 동작한다.

콘텐츠 생성 화면:

- Daily Plan을 보여준다.
- 자동 생성된 Artifact Queue를 보여준다.
- 에디터로 진입시킨다.
- 콘텐츠 수정, 임시 저장, 다시 생성은 담당하지 않는다.

콘텐츠 에디터:

- Artifact를 선택한다.
- AI 원본과 현재 편집본을 보여준다.
- 카피, 본문, 이미지, CTA를 수정한다.
- 임시 저장한다.
- 명시적 다시 생성으로 Revision을 만든다.
- 미리보기와 검수 승인, 게시 URL 연결을 처리한다.

자동 생성과 Human Revision:

- Daily scheduler idempotency는 기존 계약을 유지한다.
- scheduler 재실행은 같은 Plan의 최초 Artifact를 중복 생성하지 않는다.
- 사용자의 다시 생성은 scheduler 재실행이 아니라 명시적 Revision 동작이다.
- 성과는 최신 Revision이 아니라 실제 게시된 Revision에 귀속한다.

## 필수 식별자

Revision-aware Artifact에는 최소 다음 식별자가 필요하다.

- `artifact_id`: 현재 버전의 고유 ID.
- `parent_artifact_id`: 직전 revision의 artifact ID.
- `original_artifact_id`: revision chain의 최초 AI-generated artifact ID.
- `revision_no`: original 기준 revision 번호. 최초 AI 원본은 `1`.
- `revision_reason`: revision 발생 이유.
- `source`: `ai_original`, `human_edit`, `ai_regenerate`, `system_regenerate` 등 생성 주체.
- `status`: 현재 workflow 상태.
- `is_published_version`: 이 revision이 실제 게시본인지 여부.

예시 lineage:

- `ART-100`, revision 1, source `ai_original`, original `ART-100`.
- `ART-101`, revision 2, source `human_edit`, parent `ART-100`, original `ART-100`.
- `ART-102`, revision 3, source `ai_regenerate`, parent `ART-101`, original `ART-100`.
- `ART-103`, revision 4, source `human_edit`, parent `ART-102`, original `ART-100`, 실제 게시본.

## 상태 계약

기본 상태 흐름:

1. `generated`
2. `draft`
3. `review_pending`
4. `accepted`
5. `published`

보조 상태:

- `hold`: 검수 보류.
- `rejected`: 폐기.
- `generation_failed`: 자동 생성 실패.

중요 규칙:

- `accepted` 상태의 Artifact를 조용히 수정하지 않는다.
- 승인 후 수정이 필요하면 새 Revision을 만든다.
- 새 Revision은 다시 `draft` 또는 `review_pending` 상태에서 검수 흐름을 탄다.
- `published`는 실제 게시 URL 또는 외부 ID가 연결된 상태다.

## 임시 저장 계약

임시 저장은 현재 Revision의 human-edited draft를 저장하는 동작이다.

규칙:

- AI Original을 덮어쓰지 않는다.
- 저장했다고 승인되는 것은 아니다.
- 저장 결과 상태는 `draft`다.
- `revision_reason`은 `human_edit`이다.
- 편집 전 AI 원본과 편집 후 draft를 구분할 수 있어야 한다.

저장 대상:

- 제목
- 본문 또는 채널별 structured body
- CTA
- 이미지/비주얼 지시문
- 해시태그/태그
- 검수자 note

## 다시 생성 계약

다시 생성은 현재 Revision과 context를 바탕으로 새 AI Revision을 만드는 명시적 사용자 동작이다.

입력:

- 현재 `artifact_id`
- 현재 `appeal_id`
- 현재 `topic_id`
- 현재 Evidence snapshot
- 사용자 수정 내용
- 사용자 지시문

출력:

- 새 `artifact_id`
- 동일 `original_artifact_id`
- `parent_artifact_id = 현재 artifact_id`
- `revision_no = 이전 revision_no + 1`
- `revision_reason = user_regenerate`
- `source = ai_regenerate`
- `status = draft` 또는 `review_pending`

금지:

- 기존 Artifact 삭제.
- 기존 Artifact overwrite.
- Daily Plan materialization idempotency를 깨는 방식의 재생성.

## 검수 승인 계약

검수 승인은 특정 Revision을 “사용 가능” 상태로 확정하는 동작이다.

규칙:

- 승인 대상은 현재 선택된 revision이다.
- 상태는 `accepted`.
- 승인 event는 `ContentReviewEvent` 또는 동등 event log에 남긴다.
- 승인 후 게시 URL 연결 전까지는 성과 귀속 대상이 아니다.

## 게시 연결 계약

게시 URL 또는 외부 ID 연결은 실제 게시본을 지정하는 동작이다.

규칙:

- 게시 연결 대상 revision만 `is_published_version = true`.
- 같은 original chain에서 실제 게시본이 여러 개 있을 수 있으나, 각 performance row는 반드시 특정 published revision에 귀속한다.
- 기존 `ContentPublishLink`는 게시 URL/외부 ID 저장에 사용한다.
- 성과는 `original_artifact_id`가 아니라 실제 게시된 `artifact_id`에 1차 귀속한다.
- Appeal 학습은 published revision의 performance를 통해 누적한다.

## 성과 귀속 계약과의 연결

Performance attribution 기준:

- `ContentPerformanceDaily.artifact_id`는 실제 게시된 revision을 가리켜야 한다.
- GFA Bridge binding도 실제 게시/사용된 GFA revision artifact에 연결한다.
- 최신 revision이라는 이유만으로 성과를 귀속하지 않는다.
- 실제 게시본이 v4라면 performance는 v4에 저장하고, 그 뒤 `appeal_id`, `insight_id`, `evidence`로 역추적한다.

## UI 버튼 계약

콘텐츠 생성 화면:

- `에디터 열기`: 지원.
- `검수하기`: 에디터로 이동.
- `생성 실패 상태 확인`: 지원.
- `임시 저장`: 표시하지 않는다.
- `다시 생성`: 표시하지 않는다.

콘텐츠 에디터:

- `임시 저장`: draft 저장. Revision/Draft API 구현 후 활성화.
- `다시 생성`: 새 AI Revision 생성. Revision API 구현 후 활성화.
- `미리보기`: 현재 revision preview.
- `검수 승인`: 현재 revision을 `accepted`로 전환.
- `게시 URL 연결`: 실제 게시 revision에 publish link 저장.

## 필요한 구현 단위

1. Revision metadata 저장.
2. 현재 Artifact 조회 시 revision chain 포함.
3. Draft save API.
4. Regenerate revision API.
5. Published revision pointer 또는 `is_published_version`.
6. Performance attribution이 published revision을 사용하도록 검증.
7. React 에디터 UI에서 revision chain과 current revision 표시.

## 현재 코드와의 차이

현재 `ContentArtifact`는 `artifact_id`, `plan_id`, `sku_id`, `appeal_id`, `topic_id`, `channel`, `body_json`, `export_text`, `reviewer_status` 중심이다.

아직 명시적으로 없는 것:

- `parent_artifact_id`
- `original_artifact_id`
- `revision_no`
- `revision_reason`
- `source`
- `is_published_version`

따라서 React Editor의 `임시 저장`과 `다시 생성` 버튼은 이 계약 구현 전에는 실제 저장 동작으로 활성화하지 않는다.
