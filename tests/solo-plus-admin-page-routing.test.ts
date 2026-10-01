import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queuePageSource = readFileSync(
  "src/app/(admin)/admin/solo-plus/cases/page.tsx",
  "utf8",
);
const detailPageSource = readFileSync(
  "src/app/(admin)/admin/solo-plus/cases/[caseId]/page.tsx",
  "utf8",
);
const indexPageSource = readFileSync(
  "src/app/(admin)/admin/solo-plus/page.tsx",
  "utf8",
);
const legacyDetailPageSource = readFileSync(
  "src/app/(admin)/admin/solo-plus/[caseId]/page.tsx",
  "utf8",
);
const queueSource = readFileSync("src/components/solo-plus/admin-review-queue.tsx", "utf8");
const detailSource = readFileSync("src/components/solo-plus/admin-case-detail.tsx", "utf8");

function run() {
  assert.match(queuePageSource, /requireSuperAdminSession/);
  assert.match(queuePageSource, /<AdminReviewQueue\s*\/>/);
  assert.match(detailPageSource, /requireSuperAdminSession/);
  assert.match(detailPageSource, /resolveSoloPlusReviewActionScope\(process\.env\)/);
  assert.match(detailPageSource, /reviewActionScope\?\.caseId === caseId\.toLowerCase\(\)/);
  assert.match(detailPageSource, /allowedReviewDecision=\{allowedReviewDecision\}/);

  assert.match(indexPageSource, /redirect\("\/admin\/solo-plus\/cases"\)/);
  assert.match(
    legacyDetailPageSource,
    /redirect\(`\/admin\/solo-plus\/cases\/\$\{caseId\}`\)/,
  );

  assert.match(queueSource, /fetch\(`\/api\/admin\/solo-plus\/cases\?\$\{params\.toString\(\)\}`/);
  assert.match(queueSource, /href=\{`\/admin\/solo-plus\/cases\/\$\{item\.caseId\}`\}/);
  assert.doesNotMatch(queueSource, /href=\{`\/admin\/solo-plus\/\$\{item\.caseId\}`\}/);
  assert.match(detailSource, /fetch\(`\/api\/admin\/solo-plus\/cases\/\$\{caseId\}`/);
  assert.match(detailSource, /allowedDecision=\{allowedReviewDecision\}/);

  console.log("solo-plus-admin-page-routing.test.ts passed");
}

run();
