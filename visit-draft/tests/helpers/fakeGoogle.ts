/**
 * 테스트용 가짜 Google Gen AI SDK. 실제 API를 부르지 않고, 받은 요청을 기록하고 미리 넣어 둔 응답을 돌려준다.
 * 사용: vi.mock("@google/genai", () => import("../helpers/fakeGoogle"))
 */
export interface FakeInteraction {
  status: string;
  output_text?: string;
  steps?: unknown[];
}

export const googleCalls: Record<string, unknown>[] = [];
export const googleReplies: (FakeInteraction | Error)[] = [];
export const modelGets: string[] = [];

export const done = (text: string, steps?: unknown[]): FakeInteraction => ({ status: "completed", output_text: text, ...(steps ? { steps } : {}) });

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`api error ${status}`);
  }
}

export class GoogleGenAI {
  constructor(public readonly options: { apiKey?: string }) {}

  interactions = {
    create: async (params: Record<string, unknown>) => {
      googleCalls.push(structuredClone(params));
      const r = googleReplies.shift();
      if (!r) throw new Error("가짜 응답이 더 없습니다");
      if (r instanceof Error) throw r;
      return { id: "it_fake", ...r };
    },
  };

  models = {
    get: async ({ model }: { model: string }) => {
      modelGets.push(model);
      if (this.options.apiKey === "rejected-key") throw new ApiError(400);
      return { name: `models/${model}` };
    },
  };
}
