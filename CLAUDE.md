# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태

- 모든 코드는 하위 폴더 `visit-draft/`에 있다. 이 파일에 나오는 경로(`src/`, `config/`, `data/` 등)는 모두 `visit-draft/` 기준이다. 명령도 `visit-draft/`에서 실행한다.
- 기준 문서는 저장소 최상위의 `naver-blog-review-autodraft-design.md`(설계서 v0.1)이며, 장 번호(예: "9.4장")는 설계서를 가리킨다. 아래 "설계서와 다른 점"에 적은 부분은 현재 구현을 따른다.
- 구현된 흐름: 입력(후기 종류·대상·메모·사진·블로그/참고 블로그) → 사진 준비(얼굴 가리기·EXIF 제거) → AI 사진 분석 → 문체 분석(내 블로그 또는 참고 블로그 템플릿) → AI 웹 조사 → AI 원고 작성 → 화면에서 검토·수정 → 네이버 임시저장.
- 후기 종류는 `place`(장소 방문)·`product`(제품 사용) 두 가지다. 종류별 화면·AI 문구는 `lib/jobs/reviewKinds.ts` 한곳에서 정한다. 대상 정보는 예전 작업과 호환되도록 `input.place`(name/area/link)를 그대로 쓰고, 제품이면 area를 "브랜드"로 쓴다. 메모 필드도 저장 구조는 같고 이름만 종류별로 바뀐다.
- 글 길이는 `normal`(중간)·`long`(긴) 두 가지다. 예전 작업의 `short`는 zod preprocess로 `normal`로 읽는다.
- 참고 블로그(`input.template` = {blogId, logNo?})를 주면 내 블로그 대신 그 블로그(글 주소면 그 글 한 편, `blogReader.readSinglePost`)의 구성·말투를 따른다. 네이버 블로그만 받는다. 프롬프트에서 문장 복사는 금지한다.
- 네이버 화면 선택자(`config/selectors.json`)는 실제 화면에서 아직 검증되지 않았다(설계서 17장 U1~U4). 사용자의 첫 실사용 결과로 확정한다.

## 명령 (`visit-draft/`에서 실행)

```
npm install                      # package.json의 고정 버전 설치
npx playwright install chromium  # 최초 1회, 브라우저 설치
npm run app                      # 빌드(소스가 바뀐 경우) → 127.0.0.1:3000 서버 → 브라우저 열기
npm run dev                      # 개발 서버 (next dev -H 127.0.0.1)
npm run build                    # next build
npm test                         # Vitest 전체 (단위 + 합성 화면 브라우저 테스트, AI·네이버는 가짜로 대체)
npx vitest run tests/unit/blogUrl.test.ts   # 테스트 파일 하나만 실행
npm run typecheck                # tsc --noEmit
npx tsx scripts/check-faces.ts <사진...>    # 얼굴 가리기 결과를 data/debug/faces/에 저장(로컬 처리만)
npm run poc -- --blog <blogId> --images a.jpg   # 0단계 PoC 명령줄(임시저장 자동화만 점검)
```

- 실제 네이버 저장과 Claude API 호출은 사용자의 로그인·API 키가 필요하므로 Claude가 대신 실행하지 않는다. 테스트는 `tests/helpers/fakeAnthropic.ts`(가짜 SDK)와 `tests/fixtures/fake-editor*.html`(합성 에디터 화면)을 쓴다.
- 사용자는 바탕화면 '방문기록' 바로가기(`scripts/create-shortcut.ps1`이 만듦) → `start-app.vbs`(창 없이 `npm run app -- --log`, 로그는 `data/logs/app.log`)로 실행한다. `run-app.cmd`는 창이 보이는 첫 설치·문제 확인용이다. 종료는 화면의 [앱 종료](`POST /api/app/shutdown`).
- `start-app.vbs`는 UTF-16LE(BOM), `create-shortcut.ps1`은 UTF-8 BOM, `.cmd`는 CRLF로 저장해야 한다.
- import 경로에 `.js` 확장자를 붙이지 않는다(Turbopack이 해석하지 못함, tsconfig는 `moduleResolution: bundler`).
- 프로젝트 루트는 `process.cwd()`로 정한다(`src/lib/config/load.ts`). 런타임에 읽는 파일 경로에는 `/*turbopackIgnore: true*/`를 붙여 빌드 추적 경고(프로젝트 전체 추적)를 막는다.
- `next.config.mjs`의 `compress: false`는 일부러 둔 설정이다(압축하면 SSE 진행 상황이 모였다가 한꺼번에 전달됨).

## 아키텍처

```
화면(src/components/App.tsx)
  POST /api/jobs (multipart) ─ jobs/create.ts: 입력 검증, data/jobs/<uuid>/original/p1.jpg… 저장
      └ RunManager(runs/runManager.ts, 동시에 1개) ─ jobs/generate.ts
          photos   images/process.ts → faces.ts(헤드리스 Chromium + @vladmandic/human, 조각 나눠 찾기 faceTiles.ts)
                   → mask.ts(모자이크/스티커) → ai/·upload/ 사본(EXIF 없음). 실패하면 작업 중단
          analyze  ai/provider.analyzePhotos(AI용 사본 → 사진별 종류·설명·읽은 글자·설명 초안, ai/photoNotes.ts로 검증) — 실패해도 계속
          style    naver/styleNote.ts(내 블로그 RSS+모바일 본문, 또는 참고 블로그/글 한 편 → 지표·발췌, 캐시) — 실패해도 계속
          research ai/provider.researchPlace(종류별 프롬프트, 사진에서 읽은 글자를 단서로) — 실패해도 계속
          write    ai/provider.writeDraft(AI용 사본 + 사진 분석 + 조사 + 메모 + 문체 → 구조화 출력, zod·사진 정합성 검사 후 최대 2회 재요청)
  GET /api/runs/[id]/events (SSE, 처음부터 다시 보냄) ← lib/client/useRunStream.ts
  PUT /api/jobs/[id] (원고 수정) · POST …/faces (가리기 방식 변경, 저장된 얼굴 상자로 사본만 다시 생성)
  POST /api/jobs/[id]/save ─ jobs/saveToNaver.ts: 로그인 → EditorDriver(제목, 문단, insertPhoto(사진+설명), 해시태그) → "저장"만 클릭
```

- 작업 데이터는 `data/jobs/<uuid>/job.json`(zod `jobSchema`로 검증)과 `original/`·`ai/`·`upload/`·`screens/` 폴더. 보관 기간(`jobs.retentionDays`)이 지나면 서버 시작 시 지운다. 경로는 서버가 만든 ID로만 만든다.
- 서버·화면 공용 타입은 Node 모듈이 없는 파일에 둔다: `lib/jobs/types.ts`, `lib/runs/types.ts`.
- 설정: `config/defaults.json`(앱·사진·얼굴·AI 모델/effort·보관 기간·하루 저장 한도), 네이버 선택자: `config/selectors.json`, 프롬프트: `prompts/analyze.system.md`(사진 분석)·`research.system.md`(장소 조사)·`research-product.system.md`(제품 조사)·`writer.system.md`(두 종류 공용).
- AI 공급자는 둘이다. 파이프라인은 `lib/ai/provider.ts`만 부르고, 공용 프롬프트·검증은 `lib/ai/shared.ts`에 있다.
  - **Google Gemini(기본)** `lib/ai/google.ts`: `@google/genai`의 Interactions API(`client.interactions.create`, snake_case 필드). 조사는 `tools: [{type:"google_search"},{type:"url_context"}]`, 원고는 `response_format: {type:"text", mime_type:"application/json", schema}`(평평한 블록 스키마 → `normalizeBlocks`로 정리). `store: false`. 키 `GEMINI_API_KEY`, 모델 `ai.google.model`(`GEMINI_MODEL`로 덮어씀).
  - **Anthropic Claude** `lib/ai/anthropic.ts`: beta messages + `fallbacks: "default"`(헤더 `server-side-fallback-2026-07-01`), adaptive thinking, 스트리밍. 키 `ANTHROPIC_API_KEY`, 모델 `ai.anthropic.model`(`ANTHROPIC_MODEL`).
  - 고르는 순서: `AI_PROVIDER` 환경 변수 → `ai.provider`. 화면 [설정]에서 고르면 `lib/settings/apiKey.ts`가 키와 `AI_PROVIDER`를 `.env.local`에 저장하고 실행 중인 서버에도 반영한다(모델 정보 조회로 키 확인). 응답·로그에는 가린 값만.
  - Google 무료 등급 키는 입력 내용이 서비스 개선·사람 검토에 쓰일 수 있다(약관). 동의 문구와 설정 화면에 이 안내를 유지한다.

## 설계서와 다른 점

- DB(SQLite) 대신 작업별 JSON 파일을 쓴다. 장소 후보는 NAVER 지역검색 API 대신 Claude 웹 검색으로 찾는다(별도 키 불필요).
- HEIC는 아직 지원하지 않는다(JPG/PNG/WEBP만). 5-gram 유사도 검사·ZIP 내보내기는 없고 "본문 복사"로 대체한다.

## 프로젝트 고유 규칙 (반드시 지킴)

- **발행 금지:** 발행 버튼을 누르는 코드를 작성하지 않는다. `EditorDriver`에 `publish()`를 만들지 않는다. 네이버 화면 클릭은 모두 `safeClick`(발행 가드, `config/selectors.json`의 `forbidden`)을 거친다. `tests/browser/publishGuard.test.ts`·`editorPhotos.test.ts`로 검증한다.
- **기존 임시글 보호:** "작성 중인 글이 있습니다" 팝업에서는 항상 "새로 작성" 쪽을 고른다.
- 네이버 아이디·비밀번호를 받거나 저장하지 않는다. 로그인·캡차는 사용자가 열린 크롬 창에서 직접 처리한다.
- **얼굴은 외부 전송 전에 가린다:** AI로 보내는 사진은 `ai/` 사본(얼굴 가림·EXIF 없음)뿐이다. 얼굴 인식이 실패하면 작업을 멈춘다(가리지 않은 사진을 보내지 않음).
- **사실과 경험 구분:** 사실 정보는 조사 결과(출처 있는 것)만, 맛·친절 같은 경험 평가는 방문 메모에 있는 것만 쓴다(`prompts/writer.system.md`). 협찬 표기는 `ensureDisclosure`로 코드에서 보장한다.
- AI 출력은 항상 zod 스키마(`lib/jobs/types.ts`)로 검증한다. 네이버 선택자는 `config/selectors.json`에만 둔다(role/label → text → CSS, 고정 sleep 금지).
- 비밀 키는 `.env.local`에서만 읽는다. 테스트에 키 모양 문자열을 넣지 않는다(가드 hook이 막음, `vi.stubEnv`로 아무 값이나 넣는다).
- 하루 임시저장 한도(`save.dailyLimit`)와 블로그 글 수집 간격(1~3초)을 지킨다.
- UI는 `src/styles/tokens.css`의 토큰만 쓴다. 사용자 요청으로 설계서 10.2장(HIG, 44px)보다 촘촘한 데스크톱 밀도를 쓴다: 본문 14px, 컨트롤 36px, Pretendard(OFL, `next/font/local`로 번들 — 외부 글꼴 요청 금지), 다크 모드·대비 4.5:1 유지. 화면은 1920×1080에서 입력 화면이 한 화면에 들어오도록 2단(`.layout`: 본문 + 오른쪽 고정 열) 구성을 유지한다. 설정은 오른쪽 서랍.
- 각 단계를 마칠 때마다 `npm run typecheck`·`npm test`·`npx next build`를 실행하고 결과를 보고한다.
