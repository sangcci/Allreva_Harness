# Harness 연결 템플릿

`agents/explain-diff.md`가 역할 계약의 단일 기준이다. 이 폴더의 파일은 각 coding harness가 그 계약을 읽도록 만드는 얇은 adapter다.

## 프로젝트에 설치

Harness와 대상 프로젝트가 같은 부모 디렉터리에 있거나, `ALLREVA_HARNESS_ROOT`가 설정되어 있어야 한다.

```bash
./scripts/install-adapter.sh --target all --project ../Allreva_BE
```

기존 adapter를 덮어쓰려면 `--force`를 명시한다. 설치된 adapter는 대상 프로젝트의 Git에서 관리한다.

| 환경 | 설치 위치 | 발견 방식 |
| --- | --- | --- |
| Codex | `.codex/agents/explain-diff.toml` | 신뢰한 프로젝트의 `.codex/agents/`를 읽음 |
| Claude Code | `.claude/agents/explain-diff.md` | 프로젝트 `.claude/agents/`를 읽음 |
| Pi | `.pi/agents/explain-diff.md` | `pi-subagents`의 project agent로 읽음 |

## Pi package로 임시 사용

Pi에서는 설치 없이 현재 실행에만 Harness를 추가할 수도 있다.

```bash
pi -e /absolute/path/to/Allreva_Harness
```

이 package는 `skills/`와 Pi adapter의 `explain-diff` agent를 함께 노출한다.

프로젝트별로 adapter를 복사·설치할 때에도 역할 규칙을 수정하지 않는다. 역할 계약을 바꿔야 하면 `agents/explain-diff.md`를 수정한다.
