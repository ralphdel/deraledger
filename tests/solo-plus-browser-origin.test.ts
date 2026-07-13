import assert from "node:assert/strict";

import {
  assertSameOriginBrowserMutationRequest,
  BrowserMutationOriginError,
} from "../src/lib/server/browser-origin";

function createRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers,
  });
}

function toEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

function expectOriginError(
  fn: () => unknown,
  code:
    | "SOLO_PLUS_BROWSER_ORIGIN_REQUIRED"
    | "SOLO_PLUS_BROWSER_ORIGIN_INVALID"
    | "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
): BrowserMutationOriginError {
  let captured: BrowserMutationOriginError | null = null;
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof BrowserMutationOriginError);
    assert.equal(error.code, code);
    captured = error;
    return true;
  });
  if (captured == null) {
    throw new Error(`Expected BrowserMutationOriginError ${code}.`);
  }
  return captured;
}

async function run() {
  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("https://app.example.test/api/solo-plus/case", {
        origin: "https://app.example.test",
      }),
      {
        env: toEnv({
          CANONICAL_APP_URL: "https://app.example.test",
        }),
      },
    );
    assert.equal(result.origin, "https://app.example.test");
    assert.equal(result.requestOrigin, "https://app.example.test");
  }

  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("https://proxy.example.test/api/solo-plus/case", {
        origin: "https://app.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example.test",
      }),
      {
        env: toEnv({
          CANONICAL_APP_URL: "https://app.example.test",
        }),
      },
    );
    assert.equal(result.origin, "https://app.example.test");
    assert.equal(result.requestOrigin, "https://proxy.example.test");
  }

  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("https://app.example.test/api/solo-plus/case", {
        origin: "https://app.example.test:443",
      }),
      { env: toEnv({}) },
    );
    assert.equal(result.origin, "https://app.example.test");
    assert.equal(result.requestOrigin, "https://app.example.test");
  }

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case"),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_REQUIRED",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "not-a-url",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "null",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
  );

  {
    const error = expectOriginError(
      () =>
        assertSameOriginBrowserMutationRequest(
          createRequest("https://app.example.test/api/solo-plus/case", {
            origin: "https://user:password@app.example.test",
          }),
          { env: toEnv({}) },
        ),
      "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
    );
    assert.equal(error.message.includes("password"), false);
    assert.equal(error.message.includes("authorization"), false);
  }

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://proxy.example.test/api/solo-plus/case", {
          origin: "https://app.example.test",
        }),
        {
          env: toEnv({
            CANONICAL_APP_URL: "https://user:password@app.example.test",
          }),
        },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "http://app.example.test",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "https://app.example.test:444",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "https://other.example.test",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://trusted.example.com/api/solo-plus/case", {
          origin: "https://trusted.example.com.attacker.test",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://trusted.example.com/api/solo-plus/case", {
          origin: "https://attackertrusted.example.com",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("https://proxy.example.test/api/solo-plus/case", {
        origin: "https://app.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example.test,proxy.example.test",
      }),
      {
        env: toEnv({
          CANONICAL_APP_URL: "https://app.example.test",
        }),
      },
    );
    assert.equal(result.origin, "https://app.example.test");
    assert.equal(result.requestOrigin, "https://proxy.example.test");
  }

  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("https://proxy.example.test/api/solo-plus/case", {
        origin: "https://app.example.test",
        "x-forwarded-proto": "https,http",
        "x-forwarded-host": "app.example.test",
      }),
      {
        env: toEnv({
          CANONICAL_APP_URL: "https://app.example.test",
        }),
      },
    );
    assert.equal(result.origin, "https://app.example.test");
    assert.equal(result.requestOrigin, "https://proxy.example.test");
  }

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "https://evil.example.test",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "evil.example.test",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  {
    const result = assertSameOriginBrowserMutationRequest(
      createRequest("http://localhost:3000/api/solo-plus/case", {
        origin: "http://localhost:3000",
      }),
      { env: toEnv({}) },
    );
    assert.equal(result.origin, "http://localhost:3000");
    assert.equal(result.requestOrigin, "http://localhost:3000");
  }

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "http://localhost:3000",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_MISMATCH",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "https://app.example.test /spoof",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
  );

  expectOriginError(
    () =>
      assertSameOriginBrowserMutationRequest(
        createRequest("https://app.example.test/api/solo-plus/case", {
          origin: "https://app.example .test",
        }),
        { env: toEnv({}) },
      ),
    "SOLO_PLUS_BROWSER_ORIGIN_INVALID",
  );

  console.log("solo-plus-browser-origin.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
