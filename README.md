# Allreva Harness

Allreva의 Agent 실행 자산을 관리하는 로컬 Git 저장소다. 사람이 읽는 아키텍처, 결정, 협업 규칙은 [Allreva_Docs](../Allreva_Docs/README.md)에 둔다.

## 현재 구성

- `skills/development-flow/`: 변경 작업에서 필요한 탐색·구현·검증 흐름을 짧게 안내한다.
- `agents/scout.md`: 읽기 전용 영향 범위 탐색 역할이다.
- `agents/reviewer.md`: 읽기 전용 요구사항·검증 누락 점검 역할이다.
- `agents/explain-diff.md`: diff·PR을 사람이 이해하고 퀴즈로 확인하도록 돕는 Human-in-the-loop 역할이다.
- `skills/explain-diff/`: 필요한 변경에서 HTML 학습 자료를 만드는 Skill이다.
- `integrations/`: Codex, Claude Code, Pi에서 같은 explain-diff 계약을 읽도록 하는 연결 템플릿이다.

이 저장소는 아직 Git 도구, 자동 subagent 실행, CI를 포함하지 않는다. 실제 작업에서 필요한 부분만 추가한다.

## 사용 원칙

- Skill과 subagent는 필요한 작업에서만 명시적으로 사용한다.
- 기본값은 main session 단독 작업이다.
- 탐색과 점검은 fresh context의 읽기 전용 subagent로 분리한다.
- 같은 worktree를 수정하는 writer는 하나만 둔다.
- 영구 기록은 Issue, RFC, ADR, PR에만 남긴다.
