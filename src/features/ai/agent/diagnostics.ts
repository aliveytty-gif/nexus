// These server-log fields must never include provider messages, payloads, or tool input.
const names = new Set([
  "Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError",
  "AI_APICallError", "AI_StreamProviderError", "AI_TypeValidationError", "AI_JSONParseError",
  "AI_InvalidResponseDataError", "AI_InvalidStreamPartError", "AI_EmptyResponseBodyError",
  "AI_InvalidToolInputError", "AI_NoSuchToolError", "AI_ToolCallRepairError", "AI_ToolChoiceViolationError",
  "AI_MissingToolResultsError", "AI_InvalidPromptError", "AI_InvalidArgumentError",
  "AI_NoOutputGeneratedError", "AI_NoContentGeneratedError", "AI_RetryError",
  "AI_MessageConversionError", "AI_UnsupportedFunctionalityError", "AI_UnsupportedModelVersionError",
]);
const types = new Set([
  "rate_limit_error", "api_error", "internal_server_error", "server_error", "overloaded_error",
  "service_unavailable", "timeout", "timeout_error", "authentication_error", "invalid_api_key",
  "permission_error", "not_found_error", "model_not_found", "bad_request",
  "context_length_exceeded", "invalid_request_error", "tool_use_failed",
]);

type ErrorShape = { name: string; type?: string; statusCode?: number };

function shape(error: unknown): ErrorShape {
  try {
    if (!error || typeof error !== "object") return { name: "unknown" };
    const { name, type, statusCode } = error as { name?: unknown; type?: unknown; statusCode?: unknown };
    return {
      name: typeof name === "string" && names.has(name) ? name : "unknown",
      ...(typeof type === "string" && types.has(type) ? { type } : {}),
      ...(typeof statusCode === "number" && Number.isInteger(statusCode) &&
        statusCode >= 100 && statusCode <= 599 ? { statusCode } : {}),
    };
  } catch { return { name: "unknown" }; }
}

export function failureDiagnostic(error: unknown): { error: ErrorShape; causes?: ErrorShape[] } {
  const result: { error: ErrorShape; causes?: ErrorShape[] } = { error: shape(error) };
  let current = error;
  const seen = new Set([error]);
  for (let depth = 0; depth < 2; depth++) {
    try {
      const cause = current && typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
      if (cause === undefined || seen.has(cause)) break;
      (result.causes ??= []).push(shape(cause));
      seen.add(cause); current = cause;
    } catch { break; }
  }
  return result;
}
