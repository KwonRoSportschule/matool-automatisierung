import { AppError, toAppError } from "./app-error";

const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const ASSET_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

export function jsonResponse(
  data: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

export function apiErrorResponse(error: unknown): Response {
  const appError = toAppError(error);
  return jsonResponse(
    {
      schemaVersion: 1,
      error: {
        code: appError.code,
        message: appError.message
      }
    },
    { status: appError.status }
  );
}

export function methodNotAllowed(allowed: readonly string[]): never {
  throw new AppError(
    "method_not_allowed",
    405,
    `Erlaubte Methoden: ${allowed.join(", ")}.`
  );
}

export function hardenAssetResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ASSET_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}
