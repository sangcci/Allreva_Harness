# Harness 연결 템플릿

`agents/explain-diff.md`가 역할 계약의 단일 기준이다. 이 폴더의 파일은 각 coding harness가 그 계약을 읽도록 만드는 얇은 adapter다.

| 환경 | 파일 | 설치 위치 |
| --- | --- | --- |
| Codex | `codex/agents/explain-diff.toml` | 프로젝트 `.codex/agents/explain-diff.toml` 또는 사용자 `~/.codex/agents/explain-diff.toml` |
| Claude Code | `claude/agents/explain-diff.md` | 프로젝트 `.claude/agents/explain-diff.md` 또는 사용자 `~/.claude/agents/explain-diff.md` |
| Pi | `pi/agents/explain-diff.md` | Pi subagents의 project 또는 user agent 위치 |

프로젝트별로 adapter를 복사·설치할 때에도 역할 규칙을 수정하지 않는다. 역할 계약을 바꿔야 하면 `agents/explain-diff.md`를 수정한다.
