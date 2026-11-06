/**
 * 0단계 PoC (설계서 15장) 명령줄 진입점: 세션 유지 → 과거 글 조회·파싱 → 글쓰기·사진 3장 → 임시저장 → 카테고리 확인.
 * 발행은 하지 않는다. 결과는 data/poc/result-*.json에 저장한다(블로그 ID는 가림).
 * 화면으로 실행하려면 run-app.cmd(웹 앱)를 쓴다.
 */
import { runAsEntry } from "./poc/run";

runAsEntry(Promise.resolve(process.argv.slice(2)));
