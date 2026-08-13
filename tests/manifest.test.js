import { describe, expect, test } from "vitest";
import manifest from "../manifest.json";
import { getInstallScriptParts, normalizeCoverageBucket } from "../test-coverage/coverage-target";

describe("manifest", () => {
  test("declares the Freshworks platform and unit test script", () => {
    expect(manifest["platform-version"]).toBe("3.0");
    expect(manifest.scripts["fdk-unit-test"]).toContain("vitest");
    expect(manifest.scripts["fdk-unit-test"]).toContain("--coverage");
    expect(getInstallScriptParts(manifest.scripts["fdk-unit-test"])).toEqual([
      "vitest run --coverage",
      "node tests/sync-fdk-coverage.js",
    ]);
  });
});

describe("coverage helpers", () => {
  test("handles empty install scripts", () => {
    expect(getInstallScriptParts()).toEqual([]);
  });

  test("normalizes covered coverage buckets", () => {
    expect(normalizeCoverageBucket({ total: 4, covered: 4, skipped: 0, pct: 100 })).toEqual({
      total: 4,
      covered: 4,
      skipped: 0,
      pct: 100,
    });
  });

  test("normalizes missing coverage buckets", () => {
    expect(normalizeCoverageBucket()).toEqual({
      total: 1,
      covered: 1,
      skipped: 0,
      pct: 100,
    });
  });
});
