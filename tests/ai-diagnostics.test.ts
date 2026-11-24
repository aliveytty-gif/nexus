import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError, InvalidToolInputError, StreamProviderError } from "ai";
import { failureDiagnostic } from "../src/features/ai/agent/diagnostics.ts";

describe("private AI failure diagnostics", () => {
  it("retains only fixed technical fields from real SDK failures and their causes", () => {
    const privateText = "PRIVATE_INPUT_AND_API_KEY";
    const requestError = new APICallError({ message: privateText, url: `https://example.com/${privateText}`,
      statusCode: 400, requestBodyValues: { prompt: privateText }, responseBody: privateText,
      responseHeaders: { authorization: privateText }, data: { secret: privateText } });
    const toolError = new InvalidToolInputError({ toolName: privateText, toolInput: privateText, cause: requestError });
    const streamError = new StreamProviderError({ message: privateText, type: "invalid_request_error", statusCode: 400,
      code: privateText, data: { secret: privateText }, cause: toolError });
    const diagnostic = failureDiagnostic(streamError);
    assert.deepEqual(diagnostic, { error: { name: "AI_StreamProviderError", type: "invalid_request_error", statusCode: 400 },
      causes: [{ name: "AI_InvalidToolInputError" }, { name: "AI_APICallError", statusCode: 400 }] });
    assert.ok(!JSON.stringify(diagnostic).includes(privateText));
  });

  it("rejects arbitrary field strings, invalid status codes, cycles and throwing getters", () => {
    const unknown = { name: "PRIVATE_NAME", type: "PRIVATE_TYPE", statusCode: "PRIVATE_STATUS", cause: null as unknown };
    unknown.cause = unknown;
    assert.deepEqual(failureDiagnostic(unknown), { error: { name: "unknown" } });
    for (const statusCode of [0, 99, 600, 400.5, Infinity, NaN])
      assert.deepEqual(failureDiagnostic({ name: "TypeError", statusCode }), { error: { name: "TypeError" } });
    assert.deepEqual(failureDiagnostic({ get name() { throw new Error("PRIVATE_GETTER"); },
      get cause() { throw new Error("PRIVATE_CAUSE"); } }), { error: { name: "unknown" } });
    assert.deepEqual(failureDiagnostic("PRIVATE_THROWN_STRING"), { error: { name: "unknown" } });
    assert.deepEqual(failureDiagnostic(null), { error: { name: "unknown" } });
  });
});
