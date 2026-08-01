---
name: explain-diff
description: 큰 diff, branch, PR의 기존 구조·변경 이유·코드 흐름을 사람이 이해할 수 있는 HTML 학습 자료와 퀴즈로 만들 때 사용한다. AI가 작성한 변경을 사람이 병합·다음 작업 전에 이해해야 하거나, 익숙하지 않은 영역을 학습할 때 적합하다.
---

# Allreva Explain Diff

이 Skill은 `Allreva_Harness/agents/explain-diff.md`의 역할 계약을 따른다. 코드 구현이나 Git 작업을 대신하지 않으며, Human-in-the-loop 이해 단계를 만든다.

## 대상 결정

사용자가 지정한 대상을 우선한다.

| 대상 | diff 기준 |
| --- | --- |
| PR | `gh pr diff <number>` |
| branch | 지정한 base와 `HEAD`의 diff |
| 경로 | 해당 경로의 diff |
| 대상 없음 | staged와 unstaged diff |

대상이 비어 있으면 한 번만 질문한다. 빈 diff에는 결과물을 만들지 않는다.

## 결과물 생성

1. 변경 주변의 코드와 필요한 RFC·ADR을 읽는다.
2. 역할 계약의 다섯 섹션과 3~5개 퀴즈를 포함한 self-contained HTML을 작성한다.
3. 결과물은 `/tmp/YYYY-MM-DD-explain-diff-<slug>.html`에만 저장한다.
4. HTML의 목차 링크, quiz click handler, 코드 블록 `white-space`, 동적 텍스트 escaping, 비밀값 제거를 확인한다.
5. 가능한 경우 사용자에게 절대 경로를 열 수 있는 명령을 안내한다.

## HITL gate

HTML을 만들었다고 작업이 끝난 것이 아니다. 사용자가 자료를 읽고 질문·퀴즈·확인 중 하나를 마치기 전에는 다음 행동을 확정하지 않는다.

- 구현 전: 사용자가 변경 범위와 계획을 이해했는지 확인한다.
- PR 전: 사용자가 변경 이유·영향·남은 위험을 이해했는지 확인한다.
- 병합 전: 사용자가 검증 결과와 남은 확인 사항을 확인했는지 확인한다.
