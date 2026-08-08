# Allreva Harness

Allreva의 Agent 실행 자산을 관리하는 로컬 Git 저장소다. 사람이 읽는 아키텍처, 결정, 협업 규칙은 [Allreva_Docs](../Allreva_Docs/README.md)에 둔다.

## 현재 구성

- `skills/development-flow/`: 변경 작업에서 필요한 탐색·구현·검증 흐름을 짧게 안내한다.
- `agents/scout.md`: 읽기 전용 영향 범위 탐색 역할이다.
- `agents/reviewer.md`: 읽기 전용 요구사항·검증 누락 점검 역할이다.
- `agents/explain-diff.md`: diff·PR을 사람이 이해하고 퀴즈로 확인하도록 돕는 Human-in-the-loop 역할이다.
- `skills/explain-diff/`: 필요한 변경에서 HTML 학습 자료를 만드는 Skill이다.
- `integrations/`: Codex, Claude Code, Pi의 explain-diff와 bounded Git write adapter 연결 템플릿이다.
- `integrations/git-write/`: native-approval Git write protocol과 audit receipt schema다.
- `scripts/install-adapter.sh`: 대상 프로젝트에 Pi·Claude Code·Codex adapter를 설치한다.
- `packages/git-workflow-core/`: 프로젝트 규칙, Git 상태, worktree·PR·cleanup 읽기 전용 preflight를 제공하는 공통 core다.
- `packages/git-workflow-cli/`: core 검증·계획 결과를 JSON으로 출력하는 CLI다.

Core와 CLI는 Git/GitHub 쓰기를 하지 않는다. Platform adapter가 native human UI 확인 뒤 protocol-derived fixed argv만 실행한다. Preflight 결과와 audit receipt는 기록·검증용이며, 쓰기 권한이 아니다. Pi custom tool은 adapter-only write boundary를 제공한다. Codex·Claude Code asset은 native approval을 요구하는 policy-only adapter이며 user config가 약화할 수 있다. PR merge, stage/commit, arbitrary shell, remote deletion, forced cleanup은 지원하지 않는다. 이 저장소는 자동 subagent 실행과 CI를 포함하지 않는다. 실제 작업에서 필요한 부분만 추가한다.

## 다른 coding harness에 연결

`integrations/README.md`의 설치 방법을 따른다. 대상 프로젝트에는 플랫폼별 adapter만 복사되고, 공통 역할 계약과 Skill은 이 저장소에서 관리한다.

## 사용 원칙

- Skill과 subagent는 필요한 작업에서만 명시적으로 사용한다.
- 기본값은 main session 단독 작업이다.
- 탐색과 점검은 fresh context의 읽기 전용 subagent로 분리한다.
- 조사·논의 뒤 main session이 짧은 계획을 제시하고, 사용자 승인 뒤 Issue를 만든다. Issue에는 문제·범위·완료 조건을 남긴다.
- 중요한 지속 결정이 여러 작업의 기준이 될 때만 ADR을 작성한다.
- Issue와 필요한 ADR을 남긴 뒤 development workflow에 진입한다. 사용자 개발 workflow 전환 승인 뒤에만 repository 내부 `.worktrees/`에 작업별 worktree를 만들며, 구현은 그 worktree에서만 한다. 같은 worktree를 수정하는 writer는 하나만 둔다.
- 큰 변경이나 학습이 필요한 변경은 `explain-diff`로 사람이 이해한 뒤 다음 행동을 결정한다.
- 모든 PR 생성 전에는 `explain-diff` 이해 확인과 PR 제목·본문·검증·남은 위험의 별도 생성 승인을 순서대로 받는다. PR merge는 항상 사용자가 수동으로 수행한다.
- 영구 기록은 Issue, 필요한 ADR, PR에만 남긴다.
