export function getInstallScriptParts(script) {
  return String(script || "")
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeCoverageBucket(bucket) {
  if (!bucket) {
    return {
      total: 1,
      covered: 1,
      skipped: 0,
      pct: 100,
    };
  }

  return {
    total: bucket.total,
    covered: bucket.covered,
    skipped: bucket.skipped || 0,
    pct: bucket.pct,
  };
}
