# Git Workflow Core

공통 core는 모델 호출, UI, GitHub 인증, Git 쓰기를 갖지 않는다.

현재 제공하는 읽기 전용 기능:

- project config JSON 읽기
- Issue·PR 제목 검증
- branch 이름 생성·검증
- Conventional Commit 형식의 기본 검증
- 현재 Git root, branch, porcelain status 조회

실제 commitlint 실행, stage·commit, `gh`를 통한 Issue·PR 생성은 아직 core에 넣지 않았다. 기존 `pi-git-commit`의 안전한 실행 경계를 추출하기 전까지 Pi adapter가 계속 담당한다.
