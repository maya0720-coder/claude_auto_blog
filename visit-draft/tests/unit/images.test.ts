import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDefaults } from "../../src/lib/config/load";
import { InvalidImageError, makeUploadCopies, validateImagePaths } from "../../src/lib/images/prepare";

const cfg = loadDefaults().images;
let dir: string;
let withExif: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "visit-draft-img-"));
  withExif = path.join(dir, "exif.jpg");
  // 합성 이미지에 EXIF(위치 정보 대용 필드)를 넣는다
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#888" } })
    .withExif({ IFD0: { Copyright: "synthetic-test", ImageDescription: "GPS 대용 테스트" } })
    .jpeg()
    .toFile(withExif);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("validateImagePaths", () => {
  it("정상 파일을 절대 경로로 돌려준다", () => {
    expect(validateImagePaths([withExif], cfg, 3)).toEqual([path.resolve(withExif)]);
  });
  it.each([
    [[], "0장"],
    [["a.jpg", "b.jpg", "c.jpg", "d.jpg"], "개수 초과"],
    [["missing.jpg"], "없는 파일"],
    [["file.gif"], "허용되지 않은 형식"],
  ])("%j 는 거부한다 (%s)", (paths) => {
    expect(() => validateImagePaths(paths as string[], cfg, 3)).toThrow(InvalidImageError);
  });
  it("빈 파일과 폴더는 거부한다", () => {
    const empty = path.join(dir, "empty.jpg");
    writeFileSync(empty, "");
    expect(() => validateImagePaths([empty], cfg, 3)).toThrow(InvalidImageError);
    const folder = path.join(dir, "folder.jpg");
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder);
    expect(() => validateImagePaths([folder], cfg, 3)).toThrow(InvalidImageError);
  });
});

describe("makeUploadCopies", () => {
  it("업로드용 사본에서 EXIF를 제거하고 원본은 그대로 둔다", async () => {
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const [copy] = await makeUploadCopies([withExif], path.join(dir, "out"), true);
    expect(copy).toBeDefined();
    expect((await sharp(copy!).metadata()).exif).toBeUndefined();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
  });
  it("이미지가 아닌 파일은 거부한다", async () => {
    const fake = path.join(dir, "fake.jpg");
    writeFileSync(fake, "not an image");
    await expect(makeUploadCopies([fake], path.join(dir, "out2"), true)).rejects.toThrow(InvalidImageError);
  });
});
