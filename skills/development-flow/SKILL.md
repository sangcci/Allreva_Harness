---
name: development-flow
description: Allreva에서 여러 파일·설계·운영 영향이 있는 변경을 짧은 컨텍스트로 계획, 구현, 검증할 때 사용한다. 필요한 탐색·점검은 subagent로 분리하고, 사람이 변경을 이해한 뒤 다음 행동을 결정하는 explain-diff Human-in-the-loop 단계를 포함한다.
---

# Allreva Development Flow

이 Skill은 모든 작업을 강제하지 않는다. 한 파일의 명확한 수정처럼 작은 작업에는 사용하지 않는다.

## 1. Workflow 진입

개발 workflow는 아래 순서로 진입한다.

1. main session이 필요한 조사와 사용자 논의를 마친다.
2. main session이 짧은 계획을 제시하고 사용자 승인을 받는다.
3. 승인한 계획으로 Issue를 만든다. Issue에는 문제, 이번 범위, 확인 가능한 완료 조건을 남긴다.
4. 중요한 지속 결정이 여러 작업의 기준이 될 때만 ADR을 작성한다. ADR은 모든 Issue에 항상 필요한 것은 아니다.
5. Issue와 필요한 ADR을 남긴 뒤 이 Skill과 development workflow를 시작한다.

현재 프로젝트의 `AGENTS.md`를 읽고, 아래를 짧게 확인한다.

- Issue의 완료 조건과 관련 코드·문서 경로
- 필요한 ADR
- 현재 worktree와 테스트 명령
- 사람이 변경을 이해해야 하는지

사람용 규칙은 `Allreva_Docs`를 기준으로 한다. 실행 자산과 탐색 경로는 현재 프로젝트의 `AGENTS.md`를 따른다.

## 2. 역할과 HITL 단계 선택

| 상황 | 사용할 역할 또는 단계 |
| --- | --- |
| 영향 범위가 여러 모듈·문서에 걸침 | `scout` |
| ADR 또는 낯선 구조를 먼저 이해해야 함 | 구현 전 `explain-diff` |
| 구현 뒤 요구사항·검증 누락을 확인해야 함 | `reviewer` |
| 큰 diff, 인계, AI 작성 변경을 병합 전에 이해해야 함 | PR 전 `explain-diff` |

- 단순 작업에는 main session이 직접 처리한다.
- 같은 worktree를 고치는 writer는 하나만 둔다.
- 사용자 결정이 필요한 설계 선택은 subagent에게 맡기지 않는다.
- `explain-diff`는 토큰을 쓰는 선택형 단계다. 사용자가 이해·학습을 원하거나, 변경 규모·위험·낯섦이 충분할 때만 호출한다.

## 3. 컨텍스트 계약

탐색 또는 점검 subagent에는 전체 대화 대신 아래만 전달한다.

```text
목적:
확인할 경로 또는 질문:
완료 조건:
제외 범위:
```

결과는 아래 형식으로 제한한다.

```text
결론: 1~3문장
근거: 파일 경로와 핵심 행위
위험 또는 미확인 항목: 최대 3개
다음 단계: 하나
```

`explain-diff`에는 대상 diff 또는 ADR, 독자 수준, 학습 목적만 전달한다. main session에는 HTML 본문 대신 결과물 경로와 사용자의 확인 결과만 남긴다.

## 4. Worktree gate

사용자가 개발 workflow 전환을 승인한 뒤에만 branch와 repository 내부 `.worktrees/`의 작업별 worktree를 준비한다. 구현은 해당 worktree에서만 한다. `develop` 또는 `main`을 직접 고치지 않는다. worktree 생성이 실패하면 기본 checkout에서 구현하지 않고 중단한다.

## 5. 구현 전 HITL gate

ADR을 구현하거나 낯선 영역을 바꿀 때 사용자가 이해를 원하면, writer를 시작하기 전에 `explain-diff`를 실행한다.

1. 현재 코드와 ADR의 의도한 변경을 HTML로 설명한다.
2. 결과물 경로와 퀴즈를 사용자에게 제공한다.
3. 사용자가 질문, 퀴즈, 또는 이해 확인으로 다음 행동에 동의할 때까지 구현 계획을 확정하지 않는다.

사용자가 이 단계를 원하지 않거나 변경이 충분히 작으면 생략한다.

## 6. 구현과 검증

1. main session이 탐색 결과와 사용자 확인을 바탕으로 짧은 계획을 확정한다.
2. writer가 구현과 프로젝트 검증을 수행한다.
3. 필요하면 `reviewer`가 diff와 완료 조건만 보고 누락을 점검한다.
4. 큰 diff, 인계, 병합 전 이해가 필요한 변경이면 `explain-diff`를 다시 실행한다.

## 7. PR 전 HITL gate

모든 PR 생성 전에는 아래 두 승인을 순서대로 받는다.

1. `explain-diff`를 실행하고, 사용자가 변경 이유·실제 변경 흐름·검증한 내용·남은 위험을 이해했는지 확인한다. 퀴즈 또는 질문으로 남은 이해 공백도 확인한다.
2. PR 제목, 본문, 검증 결과, 남은 위험을 사용자에게 보여 주고 PR 생성을 별도로 승인받는다.

두 승인 전에는 agent 또는 Git workflow adapter가 PR을 생성하지 않는다. PR merge는 자동화하지 않으며, 항상 사용자가 GitHub에서 수동으로 수행한다. agent와 adapter는 `gh pr merge` 또는 동등한 merge 행동을 실행하지 않는다.

Issue에는 문제·범위·완료 조건을, ADR에는 중요한 지속 결정을, PR에는 최종 변경과 검증 결과를 남긴다. Git 도구 사용 규칙은 별도 도입 전까지 현재 프로젝트의 `AGENTS.md`와 CI 규칙을 따른다.
