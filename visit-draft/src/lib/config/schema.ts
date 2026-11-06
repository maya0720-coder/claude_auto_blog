import { z } from "zod";

/** 화면 요소 하나를 찾는 방법. 우선순위는 배열 순서(role/label → text → CSS)를 따른다. */
export const targetStrategySchema = z.union([
  z.object({ role: z.string().min(1), name: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
  z.object({ css: z.string().min(1) }).strict(),
]);
export const targetSpecSchema = z.array(targetStrategySchema).min(1);

const urlTemplate = z.string().url();

export const selectorsSchema = z.object({
  login: z.object({
    loginUrl: urlTemplate,
    checkUrl: urlTemplate,
    sessionCookie: z.string().min(1),
    loginHostFragment: z.string().min(1),
  }),
  blog: z.object({
    rssUrl: z.string().includes("{blogId}"),
    postUrl: z.string().includes("{blogId}").includes("{logNo}"),
    allowedHosts: z.array(z.string().min(1)).min(1),
    container: z.string().min(1),
    component: z.string().min(1),
    paragraph: z.string().min(1),
    /** 구 에디터(스마트에디터 2) 글 본문 후보. 텍스트만 뽑는다 */
    legacyContainers: z.array(z.string().min(1)).min(1),
    blockClasses: z.record(z.string(), z.string().min(1)),
  }),
  editor: z.object({
    writeUrl: z.string().includes("{blogId}"),
    frame: z.string().min(1).optional(),
    /** 사진 컴포넌트 기준으로 바로 다음 본문 문단을 찾는 상대 선택자 */
    afterImageParagraph: z.string().min(1),
    /** 사진 컴포넌트 안의 설명(캡션) 입력 칸 */
    imageCaptionInImage: z.string().min(1),
    targets: z.object({
      resumeDialog: targetSpecSchema,
      resumeDialogNew: targetSpecSchema,
      helpPanelClose: targetSpecSchema,
      title: targetSpecSchema,
      body: targetSpecSchema,
      imageButton: targetSpecSchema,
      uploadedImage: targetSpecSchema,
      categorySelect: targetSpecSchema,
      saveButton: targetSpecSchema,
      saveDone: targetSpecSchema,
      imageComponent: targetSpecSchema,
    }),
    forbidden: z.object({
      texts: z.array(z.string().min(1)).min(1),
      classFragments: z.array(z.string().min(1)).min(1),
    }),
  }),
});

const positiveMs = z.number().int().positive();

/** 얼굴 가리기 방식: 모자이크, 귀여운 스티커, 가리지 않음 */
export const FACE_MODES = ["mosaic", "sticker", "none"] as const;
export type FaceMode = (typeof FACE_MODES)[number];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
/** 글을 쓰는 AI 공급자: Google Gemini 또는 Anthropic Claude */
export const AI_PROVIDERS = ["google", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const defaultsSchema = z
  .object({
    app: z.object({
      // 보안 경계: 외부 접근을 막기 위해 루프백 주소만 허용한다(설계서 11.1)
      host: z.literal("127.0.0.1"),
      port: z.number().int().min(1024).max(65535),
      startupTimeoutMs: positiveMs,
      logFile: z.string().min(1),
      logMaxBytes: z.number().int().positive(),
    }),
    browser: z.object({
      profileDir: z.string().min(1),
      headless: z.boolean(),
      slowMoMs: z.number().int().min(0).max(1000),
    }),
    timeouts: z.object({
      loginWaitMs: positiveMs,
      stepMs: positiveMs,
      optionalMs: positiveMs,
      imageUploadMs: positiveMs,
      saveConfirmMs: positiveMs,
    }),
    retries: z.object({ step: z.number().int().min(0).max(5) }),
    reader: z.object({
      postCount: z.number().int().min(1),
      maxPostCount: z.number().int().min(1).max(50),
      minIntervalMs: z.number().int().min(500),
      maxIntervalMs: z.number().int().min(500),
    }),
    images: z.object({
      pocMaxCount: z.number().int().min(1).max(20),
      allowedExtensions: z.array(z.string().regex(/^\.[a-z0-9]+$/)).min(1),
      maxBytes: z.number().int().positive(),
      stripMetadata: z.boolean(),
      jobMaxCount: z.number().int().min(1).max(50),
      aiMaxEdge: z.number().int().min(256).max(4096),
      uploadMaxEdge: z.number().int().min(512).max(8000),
      jpegQuality: z.number().int().min(50).max(100),
    }),
    output: z.object({
      pocDir: z.string().min(1),
      debugDir: z.string().min(1),
    }),
    faces: z.object({
      defaultMode: z.enum(FACE_MODES),
      minConfidence: z.number().min(0.05).max(0.95),
      maxFaces: z.number().int().min(1).max(200),
      boxPadding: z.number().min(0).max(1),
      mosaicCells: z.number().int().min(3).max(40),
      detectTimeoutMs: positiveMs,
    }),
    ai: z.object({
      /** 기본 AI 공급자. 설정 화면에서 고르면 AI_PROVIDER 환경 변수로 덮어쓴다 */
      provider: z.enum(AI_PROVIDERS),
      google: z.object({
        model: z.string().min(1),
        researchThinking: z.enum(THINKING_LEVELS),
        analyzeThinking: z.enum(THINKING_LEVELS),
        writerThinking: z.enum(THINKING_LEVELS),
      }),
      anthropic: z.object({
        model: z.string().min(1),
        researchEffort: z.enum(EFFORTS),
        analyzeEffort: z.enum(EFFORTS),
        writerEffort: z.enum(EFFORTS),
      }),
      maxTokens: z.number().int().min(1024).max(128000),
      maxWebSearches: z.number().int().min(1).max(20),
      maxWebFetches: z.number().int().min(0).max(20),
      requestTimeoutMs: positiveMs,
      styleSampleChars: z.number().int().min(200).max(10000),
      /** 참고 블로그(템플릿) 발췌 길이. 구성을 따라 하도록 내 블로그 발췌보다 길게 둔다 */
      templateSampleChars: z.number().int().min(200).max(20000),
      styleSamplePosts: z.number().int().min(0).max(10),
    }),
    jobs: z.object({
      dir: z.string().min(1),
      retentionDays: z.number().int().min(1).max(365),
      styleCacheHours: z.number().int().min(0),
    }),
    save: z.object({
      dailyLimit: z.number().int().min(1).max(100),
      countFile: z.string().min(1),
    }),
  })
  .refine((d) => d.reader.postCount <= d.reader.maxPostCount, {
    message: "reader.postCount는 reader.maxPostCount 이하여야 합니다",
  })
  .refine((d) => d.reader.minIntervalMs <= d.reader.maxIntervalMs, {
    message: "reader.minIntervalMs는 reader.maxIntervalMs 이하여야 합니다",
  });

export type TargetStrategy = z.infer<typeof targetStrategySchema>;
export type TargetSpec = z.infer<typeof targetSpecSchema>;
export type Selectors = z.infer<typeof selectorsSchema>;
export type Defaults = z.infer<typeof defaultsSchema>;
export type ForbiddenRules = Selectors["editor"]["forbidden"];
