# HTML to Figma · v2.5.1

Figma 플러그인의 Main Sandbox(`code.ts`/`code.js`)와 UI iframe(`ui.html`)을 분리합니다. 코드를 편집하지 않는 경우 ZIP에 포함된 빌드된 `code.js`를 그대로 사용하면 됩니다.

## 파일 구조

```text
html-to-figma/
├── .gitignore
├── build.cjs
├── code.js
├── code.ts
├── css/
│   ├── common.css
│   ├── preview.css
│   └── ui.css
├── eslint.config.js
├── manifest.json
├── package.json
├── preview.html
├── README.md
├── serve.cjs
├── tsconfig.json
└── ui.html
```

## 설치 및 실행

1. ZIP을 풀고 Figma Desktop → Plugins → Development → Import plugin from manifest에서 이 폴더의 `manifest.json`을 등록합니다.
2. 소스를 바꾸어 빌드하려면 `npm install`, `npm run typecheck`, `npm run build`를 실행합니다. 빌드 결과인 `code.js`에는 `ui.html`, `css/common.css`, `css/ui.css`가 포함됩니다. 사용 가이드인 `preview.html`은 `css/common.css`와 `css/preview.css`를 불러옵니다.
3. File 탭에서 HTML/CSS/JS/JSON과 이미지 파일을 선택하거나, Edit에서 작성하거나, Link에서 CORS 허용 URL을 불러옵니다.
4. **Link 가져오기**는 HTML/CSS와 함께 실행 가능한 외부 JS 및 인라인 JS를 가져옵니다. JS는 `sandbox="allow-scripts"`인 별도 iframe에서 실행되며, 페이지의 JSON API `fetch()`와 기본 XHR `GET`은 부모 UI에서 CORS 허용을 받은 뒤 응답을 전달합니다. Figma Main Sandbox에서 외부 JavaScript를 실행하지 않습니다.
5. **Edit / File**에서 직접 작성하거나 업로드한 JS도 자동 실행됩니다. JSON 에디터 데이터는 `window.pageData` / `window.jsonData`로 노출됩니다. JS가 `fetch("./data/projects.json")`처럼 파일명을 참조하면 동일 이름의 JSON 업로드 파일이 우선 사용됩니다.
6. `렌더링 확인`으로 최종 HTML을 확인하고 `Figma에 삽입`을 누릅니다.
7. 전체가 6,000px을 넘으면 **다음 영역 Figma에 삽입**이 자동으로 활성화됩니다.

같은 소스의 연속 삽입은 재승인을 요구하지 않고, 매 구간 렌더링 후 페이지 절대좌표를 사용합니다. 입력 파일이 바뀌면 처음부터 다시 시작합니다.

## 로컬 미리보기

`npm run dev`(Windows PowerShell에서는 `npm.cmd run dev`)를 실행한 뒤 [플러그인 UI](http://127.0.0.1:5000/ui.html) 또는 [사용 가이드](http://127.0.0.1:5000/preview.html)를 엽니다. HTML이나 `css/`의 스타일시트를 저장하면 열어 둔 페이지가 자동으로 새로고침됩니다.

## GitHub Pages

`geulrara/html-to-figma`의 `main` 브랜치에 푸시하면 사용 가이드가 배포됩니다. Pages에는 세 HTML 파일과 연결된 스타일시트 세 개가 포함됩니다. [배포된 사용 가이드](https://geulrara.github.io/html-to-figma/)

## 배경 및 이미지 처리

- `header`, `main`, `section`, `footer` 등은 Figma 중첩 Frame으로 생성됩니다. 반복 UI는 반복 그룹 Frame으로 생성됩니다.
- `section`의 단색 배경, 기본 `linear-gradient` / `radial-gradient`, `background-image:url(...)`를 Frame Fill로 적용합니다. 다른 요소의 배경은 Rectangle Fill로 구현합니다. 여러 CSS 배경 레이어나 복잡한 gradient/position/size의 완전 재현은 아직 지원하지 않습니다.
- `<img src="...">`는 원본 URL 또는 업로드한 파일명을 먼저 확인합니다. UI가 접근할 수 있는 이미지 URL은 PNG 데이터로 변환합니다. 브라우저 CORS 정책에 막히면 Figma의 `figma.createImageAsync(URL)`을 재시도합니다. 둘 다 실패하거나 src가 비었을 때만 `이미지 영역 (로드 실패)`을 표시합니다.
- 로컬 이미지 업로드나 **클립보드 이미지 직접 붙여넣기**를 지원합니다. 직접 붙여넣은 이미지는 원격 URL 로드 실패 시 대체 소스로 사용할 수 있습니다.
- 플러그인은 운영체제의 클립보드를 자동으로 조작해 Figma 캔버스에 Paste 명령을 실행할 수 없습니다. 대신 `figma.createImage`/`figma.createImageAsync`와 `Image Fill`로 실제 이미지를 지정 좌표에 생성합니다.
- Figma `createImageAsync`는 PNG/JPEG/GIF URL을 지원합니다. WebP/SVG는 UI의 PNG 변환이 가능할 때 지원하며, CORS와 접근 제약으로 변환이 막히면 원본을 표시할 수 없을 수 있습니다.
- Link 탭은 공개 HTML/CSS를 CORS 허용 서버에서 직접 받아오는 방식입니다. 로그인된 SPA 및 원격 웹페이지의 JavaScript를 완전히 재현하지 못합니다.

## 보안/기술 한계

- 신뢰할 수 있는 JavaScript만 입력하세요. 자동 실행은 샌드박스된 렌더러에서 수행됩니다.
- CSS Flex/Grid의 Auto Layout 복원, 여러 배경 레이어, 브라우저와 Figma의 완전한 픽셀 일치는 보장하지 않습니다.
- 6,000px 경계에 걸친 이미지/텍스트의 자르기 및 시각적 크롭은 완전하지 않을 수 있습니다.
- Figma 폰트 목록에서 원본 CSS 폰트를 찾고, 없을 때 Pretendard 우선 폴백을 시도합니다. 로컬 설치만으로 Figma에 폰트가 제공되는 것은 아닙니다.

## 이번 변경 검증

- Chromium: HTML/CSS/JS/JSON 적용, URL 기반 이미지 접근, PNG 정규화, 시맨틱 프레임 단색·그라디언트·이미지 배경 분석, 연속 0–6000/6000–7398px 구간 처리, 빈 img 및 인라인 그라디언트 텍스트 회귀 테스트 통과.
- Figma Main Sandbox 모의 환경: Frame Fill(단색·그라디언트·이미지), 원본 이미지 / 클립보드 대체 / 이미지 실패 Placeholder 생성 동작 통과.
- 구문 검사와 ZIP 무결성 검사 통과. 실제 Figma 데스크톱 UI 및 타입 전체 검사는 미실행.

## Link의 JSON 테이블 · 페이지네이션

- 기존 v2.4.0에서 빠지던 테이블의 주 원인은 Link 가져오기 중 `script`를 모두 삭제한 점이었습니다. 이제 문서 순서에 따라 `script[src]`, 일반 인라인 JS, `type=module`을 격리된 iframe에서 실행합니다.
- 외부 페이지의 `fetch('./data/rows.json')`는 `srcdoc`에서 상대 경로가 깨지지 않도록 원래 사이트 URL을 기준으로 다시 해석하고 UI iframe의 CORS fetch로 응답을 전달합니다. 기본 `XMLHttpRequest` GET도 호환 처리합니다. 업로드한 동일 이름의 JSON 파일이 있다면 해당 파일을 우선 사용합니다.
- 외부 스크립트 로딩과 JSON 응답 및 DOM 갱신이 안정될 때까지 렌더링 완료 신호를 늦추고, 완성된 테이블/페이지 번호를 Figma 정적 레이어로 변환합니다. Figma에서 실제 페이지 이동 인터랙션을 구현하는 것은 아닙니다.
- **한계:** 사이트가 CORS를 허용하지 않으면 HTML이나 JSON을 읽을 수 없습니다. 인증, POST API, 동적 import 매핑, 복잡한 SPA 번들 및 서버 전용 페이지를 완벽히 재현하지 않습니다. JS가 네트워크 요청 없이 브라우저 저장소나 쿠키에 의존하면 재현할 수 없습니다. 외부 URL의 스크립트는 신뢰할 수 있는 사이트에서만 실행하세요.

## 검증

- Chromium에서 Link + 외부 JS + JSON fetch + table + pagination을 모사한 로컬 응답 테스트: 성공
- Chromium에서 외부 `type=module` 스크립트로 동일 테스트: 성공
- JSON 요청 403 상태에서 동일한 이름의 로컬 JSON을 업로드해 DOM 생성: 성공
- Figma 전송 메시지에 테이블 셀 텍스트·페이지 번호 포함: 성공
- 미리보기에서 페이지 2 클릭 후, 해당 페이지의 행만 전송되는 동작: 성공
- 연속 6000px 구간 삽입·폰트/이미지/그라디언트 회귀 테스트: 성공
- `https://geulrara.github.io/` 실제 라이브 HTML / JSON 연동: **테스트 환경에서 접속 불가**
- Figma Desktop 실기기 실행: 미실행
- TypeScript 타입 검사: @figma/plugin-typings 의존성 없음으로 미완료 (`npm install` 후 확인 필요)

## v2.5.1 렌더링 확인 버튼 수정

- `렌더링 확인`은 외부 스크립트 완료 여부와 무관하게 뷰를 바로 펼칩니다.
- Figma 삽입은 렌더러의 현재 세션 `PREVIEW_READY` 수신 및 뷰 확인 후 활성화됩니다.
- 이전 iframe 세션의 늦은 메시지는 `renderId`로 무시합니다.
- 렌더러를 원격 스크립트보다 먼저 설치해 차단된 외부 JS가 준비 신호 자체를 막지 않도록 했습니다.
- 렌더링 지연은 8초 경고 및 16초 이후 다시 렌더링 버튼으로 안내합니다.
- JSON 또는 모듈이 끝나지 않을 경우 8초 후 부분 렌더링을 제공하며 완료되지 않은 데이터는 경고합니다.
- 실제 Figma Desktop 테스트는 별도로 필요합니다.
