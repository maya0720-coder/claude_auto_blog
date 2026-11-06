import { mkdtempSync, rmSync, utimesSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initialRunState, runReducer, type RunAction } from "../../src/lib/client/runState";
import { SaveLimit } from "../../src/lib/jobs/saveLimit";
import { JobStore } from "../../src/lib/jobs/store";
import { checkDraft, draftToPlainText, ensureDisclosure, type Job, type PostDraft } from "../../src/lib/jobs/types";
import { loadDefaults } from "../../src/lib/config/load";
import { maskKey, normalizeKey, saveAiSettings, upsertEnvLine } from "../../src/lib/settings/apiKey";

const root = mkdtempSync(path.join(tmpdir(), "visit-draft-jobs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// 저장소는 프로젝트 폴더 기준 상대 경로만 받으므로, 테스트용 폴더를 data/ 아래에 만든다
const relDir = path.join("data", "test-jobs", path.basename(root));
const store = new JobStore({ dir: relDir, retentionDays: 7, styleCacheHours: 0 });
afterAll(() => {
  rmSync(path.resolve(relDir), { recursive: true, force: true });
  // 비어 있는 상위 테스트 폴더도 지운다(다른 테스트가 쓰는 중이면 남겨 둔다)
  try {
    rmdirSync(path.dirname(path.resolve(relDir)));
  } catch {
    // 비어 있지 않음
  }
});

const draft: PostDraft = {
  title: "성수 카페 다녀왔어요",
  titleCandidates: ["후보"],
  blocks: [
    { type: "heading", text: "📍 위치" },
    { type: "photo", photoId: "p1", caption: "외관" },
    { type: "text", text: "창가 자리가 좋았어요." },
    { type: "photo", photoId: "p2", caption: "커피" },
  ],
  hashtags: ["성수카페", "#카페"],
};

function sampleJob(id: string): Job {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    input: {
      kind: "place",
      blogId: "test_blog",
      place: { name: "테스트 카페" },
      memo: {},
      options: { faceMode: "mosaic", length: "normal", hashtagCount: 5, sortByTime: true },
    },
    photos: [
      { id: "p1", ext: ".jpg", faces: [], aiWidth: 100 },
      { id: "p2", ext: ".png", faces: [], aiWidth: 100 },
    ],
  };
}

describe("JobStore", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("만들고·읽고·고치고·목록·삭제한다", () => {
    store.create(sampleJob(id));
    expect(store.read(id)?.input.place.name).toBe("테스트 카페");
    store.update(id, (j) => ({ ...j, status: "draft_ready", draft }));
    expect(store.list()).toEqual([expect.objectContaining({ id, status: "draft_ready", title: draft.title, photoCount: 2 })]);
    expect(store.photoPath(id, { id: "p2", ext: ".png" }, "original")).toMatch(/original[\\/]p2\.png$/);
    expect(store.photoPath(id, { id: "p2", ext: ".png" }, "upload")).toMatch(/upload[\\/]p2\.jpg$/);
    store.delete(id);
    expect(store.read(id)).toBeUndefined();
  });
  it("잘못된 ID로는 경로를 만들지 않는다", () => {
    expect(() => store.dir("../../etc")).toThrow();
    expect(() => store.dir("")).toThrow();
  });
  it("형식이 틀린 작업은 저장하지 않는다", () => {
    const bad = { ...sampleJob("22222222-2222-4333-8444-555555555555"), status: "weird" } as unknown as Job;
    expect(() => store.create(bad)).toThrow();
  });
  it("보관 기간이 지난 작업을 지운다", () => {
    const oldId = "33333333-2222-4333-8444-555555555555";
    store.create(sampleJob(oldId));
    const file = path.join(store.dir(oldId), "job.json");
    const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
    utimesSync(file, tenDaysAgo, tenDaysAgo);
    expect(store.purgeOlderThan(7)).toBe(1);
    expect(store.read(oldId)).toBeUndefined();
  });
});

describe("원고 도우미", () => {
  it("checkDraft: 없는 사진·중복·빠진 사진을 알려 준다", () => {
    expect(checkDraft(draft, ["p1", "p2"])).toEqual([]);
    const bad: PostDraft = { ...draft, blocks: [...draft.blocks, { type: "photo", photoId: "p1", caption: "" }, { type: "photo", photoId: "p9", caption: "" }] };
    const problems = checkDraft(bad, ["p1", "p2", "p3"]).join(" ");
    expect(problems).toContain("p9");
    expect(problems).toContain("두 번");
    expect(problems).toContain("p3");
  });
  it("ensureDisclosure: 협찬 표기가 없으면 맨 앞에 넣고, 있으면 그대로 둔다", () => {
    const text = "업체로부터 제공받아 작성했습니다.";
    const added = ensureDisclosure(draft, text);
    expect(added.blocks[0]).toEqual({ type: "text", text });
    expect(ensureDisclosure(added, text).blocks).toHaveLength(added.blocks.length);
    expect(ensureDisclosure(draft, undefined)).toBe(draft);
  });
  it("draftToPlainText: 제목·사진 자리·해시태그를 포함한다", () => {
    const t = draftToPlainText(draft);
    expect(t.startsWith("성수 카페 다녀왔어요")).toBe(true);
    expect(t).toContain("[사진 p1] 외관");
    expect(t).toContain("#성수카페 #카페");
  });
});

describe("SaveLimit", () => {
  it("하루 한도까지만 허용하고 날짜가 바뀌면 다시 센다", () => {
    const limit = new SaveLimit({ dailyLimit: 2, countFile: path.join(relDir, "count.json") });
    const day1 = new Date(2026, 10, 6, 10);
    expect(limit.take(day1)).toBe(true);
    expect(limit.take(day1)).toBe(true);
    expect(limit.take(day1)).toBe(false);
    expect(limit.remaining(day1)).toBe(0);
    expect(limit.remaining(new Date(2026, 10, 7, 10))).toBe(2);
  });
});

describe("API 키 설정 도우미", () => {
  const fakeKey = `sk-ant-${"x".repeat(30)}`;
  it("다른 줄은 두고 키 줄만 바꾼다", () => {
    expect(upsertEnvLine("A=1\nANTHROPIC_API_KEY=old\n", "ANTHROPIC_API_KEY", "new")).toBe("A=1\nANTHROPIC_API_KEY=new\n");
    expect(upsertEnvLine("", "ANTHROPIC_API_KEY", "new")).toBe("ANTHROPIC_API_KEY=new\n");
  });
  it("붙여 넣을 때 섞인 공백·줄바꿈·따옴표·변수 이름을 걷어 낸다", () => {
    expect(normalizeKey("  abc-def_123 \n")).toBe("abc-def_123");
    expect(normalizeKey('"abc\r\n def"')).toBe("abcdef");
    expect(normalizeKey("GEMINI_API_KEY=abc.def")).toBe("abc.def");
  });
  it("Google 키는 접두어를 강제하지 않고, 이상한 문자는 길이와 함께 알려 준다", async () => {
    const cfg = loadDefaults().ai;
    await expect(saveAiSettings("google", "짧음", cfg)).rejects.toThrow(/2자.*쓰지 않는 문자/);
    await expect(saveAiSettings("google", "abc", cfg)).rejects.toThrow(/형식이 올바르지 않습니다\(3자\)/);  });
  it("가린 값에는 키 뒷부분이 없다", () => {
    expect(maskKey(fakeKey)).toBe("sk-ant********");
    expect(maskKey(fakeKey)).not.toContain("xxxx");
  });
});

describe("runReducer", () => {
  const apply = (actions: RunAction[]) => actions.reduce(runReducer, initialRunState(["login", "save"]));
  it("로그인 안내는 로그인 단계가 끝나면 사라진다", () => {
    const s = apply([
      { type: "event", event: { type: "step", step: "login", status: "running" } },
      { type: "event", event: { type: "attention", message: "로그인해 주세요" } },
    ]);
    expect(s.attention).toBe("로그인해 주세요");
    expect(runReducer(s, { type: "event", event: { type: "step", step: "login", status: "ok" } }).attention).toBeUndefined();
  });
  it("경고 메시지를 단계에 남기고, 끝나면 done", () => {
    const s = apply([
      { type: "event", event: { type: "step", step: "save", status: "warning", message: "확인 필요" } },
      { type: "event", event: { type: "done" } },
    ]);
    expect(s.steps.save).toEqual({ status: "warning", message: "확인 필요" });
    expect(s.phase).toBe("done");
  });
  it("오류는 error 단계로", () => {
    expect(apply([{ type: "event", event: { type: "error", message: "실패" } }])).toMatchObject({ phase: "error", error: "실패" });
  });
});
