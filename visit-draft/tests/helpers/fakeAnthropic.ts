/**
 * 테스트용 가짜 Anthropic SDK. 실제 API를 부르지 않고, 받은 요청을 기록하고 미리 넣어 둔 응답을 돌려준다.
 * 사용: vi.mock("@anthropic-ai/sdk", () => import("../helpers/fakeAnthropic"))
 */
export interface FakeReply {
  stop_reason: string;
  content: unknown[];
}

export const calls: Record<string, unknown>[] = [];
export const replies: FakeReply[] = [];

export const textReply = (text: string, stop_reason = "end_turn"): FakeReply => ({ stop_reason, content: [{ type: "text", text }] });

class APIError extends Error {
  status: number | undefined;
  constructor(message = "api error", status?: number) {
    super(message);
    this.status = status;
  }
}
class AuthenticationError extends APIError {}
class PermissionDeniedError extends APIError {}
class NotFoundError extends APIError {}
class RateLimitError extends APIError {}
class BadRequestError extends APIError {}
class APIConnectionError extends APIError {}

export default class Anthropic {
  static APIError = APIError;
  static AuthenticationError = AuthenticationError;
  static PermissionDeniedError = PermissionDeniedError;
  static NotFoundError = NotFoundError;
  static RateLimitError = RateLimitError;
  static BadRequestError = BadRequestError;
  static APIConnectionError = APIConnectionError;

  constructor(public readonly options: Record<string, unknown>) {}

  beta = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        // 이후 요청이 같은 배열을 고쳐도 기록이 바뀌지 않도록 복사해 둔다
        calls.push(structuredClone(params));
        return {
          finalMessage: async () => {
            const r = replies.shift();
            if (!r) throw new Error("가짜 응답이 더 없습니다");
            return { id: "msg_fake", type: "message", role: "assistant", model: String(params.model), usage: {}, ...r };
          },
        };
      },
    },
  };

  models = { retrieve: async (id: string) => ({ id }) };
}
