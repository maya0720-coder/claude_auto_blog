/**
 * 웹 앱 실행기. start-app.vbs(바탕화면 아이콘, 창 없이 실행) 또는 run-app.cmd(창 보이게 실행)가 호출한다.
 * 1) 소스가 바뀌었으면 빌드 2) 127.0.0.1에만 서버 시작 3) 준비되면 기본 브라우저로 화면을 연다.
 * 이미 실행 중이면 브라우저만 연다. 화면의 [앱 종료]로 서버가 끝나면 이 실행기도 끝난다.
 *
 * --log: 출력을 data/logs/app.log(설정 app.logFile)에 남긴다. 창 없이 실행할 때 문제를 확인하기 위함.
 */
import { spawn, spawnSync, type StdioOptions } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { loadDefaults, PROJECT_ROOT, resolveDataPath } from "../src/lib/config/load";
import { errorSummary } from "../src/lib/util/common";

const POLL_MS = 500;
const BUILD_MARKER = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
const WATCHED = ["src", "next.config.mjs", "package-lock.json"];

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

/** 출력 대상: 콘솔 또는 로그 파일(이어 쓰기). 파일은 여러 실행기가 동시에 이어 써도 된다. */
interface Output {
  log: (m: string) => void;
  stdio: StdioOptions;
  close: () => void;
}

function consoleOutput(): Output {
  return { log: (m) => console.log(`[app] ${m}`), stdio: "inherit", close: () => {} };
}

function fileOutput(file: string, maxBytes: number): Output {
  mkdirSync(path.dirname(file), { recursive: true });
  // 너무 커지면 한 세대만 남기고 새로 시작한다
  if (existsSync(file) && statSync(file).size > maxBytes) {
    try {
      renameSync(file, `${file}.1`);
    } catch {
      // 다른 실행기가 쓰는 중이면 그대로 이어 쓴다
    }
  }
  const fd = openSync(file, "a");
  return {
    log: (m) => writeSync(fd, `${new Date().toISOString()} [app] ${m}\n`),
    stdio: ["ignore", fd, fd],
    close: () => closeSync(fd),
  };
}

function newestMtime(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(p).reduce((max, name) => Math.max(max, newestMtime(path.join(p, name))), st.mtimeMs);
}

function needsBuild(): boolean {
  if (!existsSync(BUILD_MARKER)) return true;
  const built = statSync(BUILD_MARKER).mtimeMs;
  return WATCHED.some((p) => newestMtime(path.join(PROJECT_ROOT, p)) > built);
}

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/runs/active`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 기본 브라우저로 연다. 주소는 설정값(검증된 루프백 주소·포트)으로만 만든다. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true }).unref();
}

async function run(out: Output): Promise<number> {
  const { app } = loadDefaults();
  const url = `http://${app.host}:${app.port}`;

  if (await isUp(url)) {
    out.log(`이미 실행 중입니다. 브라우저를 엽니다: ${url}`);
    openBrowser(url);
    return 0;
  }

  if (needsBuild()) {
    out.log("화면을 준비하는 중입니다(처음 또는 코드가 바뀐 경우 1~2분 걸립니다)...");
    const build = spawnSync(process.execPath, [nextBin, "build"], {
      cwd: PROJECT_ROOT,
      stdio: out.stdio,
      windowsHide: true,
    });
    if (build.status !== 0) {
      out.log("빌드에 실패했습니다.");
      return 1;
    }
  }

  out.log(`서버를 시작합니다: ${url}`);
  const server = spawn(process.execPath, [nextBin, "start", "-H", app.host, "-p", String(app.port)], {
    cwd: PROJECT_ROOT,
    stdio: out.stdio,
    windowsHide: true,
  });
  const exited = new Promise<number>((resolve) => server.on("exit", (code) => resolve(code ?? 1)));
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => server.kill(sig));

  const deadline = Date.now() + app.startupTimeoutMs;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null) {
    if (await isUp(url)) {
      ready = true;
      break;
    }
    await wait(POLL_MS);
  }
  if (!ready) {
    out.log(`서버가 준비되지 않았습니다. 포트 ${app.port}을 다른 프로그램이 쓰고 있는지 확인해 주세요.`);
    server.kill();
    return 1;
  }
  out.log("준비되었습니다. 브라우저를 엽니다.");
  openBrowser(url);
  const code = await exited;
  out.log(`서버가 종료되었습니다 (코드 ${code}).`);
  return code;
}

async function main(): Promise<number> {
  const { app } = loadDefaults();
  const out = process.argv.includes("--log")
    ? fileOutput(resolveDataPath(app.logFile), app.logMaxBytes)
    : consoleOutput();
  try {
    return await run(out);
  } catch (err) {
    out.log(`실행 실패: ${errorSummary(err)}`);
    return 1;
  } finally {
    out.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`[app] 실행 실패: ${errorSummary(err)}`);
    process.exitCode = 1;
  },
);
