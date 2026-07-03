// Pins the web-only native-module stub's escape hatches (lib/webNativeStub.js,
// wired up in metro.config.js). The dangerous failure mode is the stub being
// thenable: `await captureRef(...)` would then never settle and silently hang
// the calling flow (e.g. roster share on web).

// Plain CJS module with no type declarations — require() keeps tsc out of it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stub = require("../lib/webNativeStub");

describe("webNativeStub", () => {
  it("is not thenable — awaiting a stubbed call resolves instead of hanging", async () => {
    const result = await stub.captureRef("ref", { format: "png" });
    expect(result).toBeDefined();
  });

  it("survives deep property chains, calls, and string coercion", () => {
    expect(() => {
      stub.Skia.Path.Make().moveTo(0, 0);
      String(stub);
      void `${stub.Canvas}`;
    }).not.toThrow();
  });

  it("reports __esModule so ESM named imports resolve", () => {
    expect(stub.__esModule).toBe(true);
  });
});
