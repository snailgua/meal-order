import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedHeaderVariants,
  compareHeader,
  compareSheetHeader,
  SHEET_SCHEMAS,
} from "./sheetSchema";

test("compareHeader accepts exact headers and omitted trailing empty cells", () => {
  assert.deepEqual(compareHeader(["A", "B"], ["A", "B"]), { ok: true });
  assert.deepEqual(compareHeader(["A", "B", ""], ["A", "B"]), { ok: true });
});

test("compareHeader rejects reordered, missing, and extra columns", () => {
  assert.equal(compareHeader(["B", "A"], ["A", "B"]).ok, false);
  assert.equal(compareHeader(["A"], ["A", "B"]).ok, false);
  assert.equal(compareHeader(["A", "B", "C"], ["A", "B"]).ok, false);
  assert.equal(compareHeader(["A", "", "B"], ["A", "B"]).ok, false);
});

test("compareSheetHeader accepts only the known production-compatible variants", () => {
  const sessionSchema = SHEET_SCHEMAS.find(
    (schema) => schema.title === "訂餐場次表"
  )!;
  const feedbackSchema = SHEET_SCHEMAS.find(
    (schema) => schema.title === "問題回報表"
  )!;

  const legacySessionHeaders = acceptedHeaderVariants(sessionSchema)[1];
  const previousCanonicalSessionHeaders =
    acceptedHeaderVariants(sessionSchema)[2];
  const previousLegacySessionHeaders =
    acceptedHeaderVariants(sessionSchema)[3];
  assert.equal(compareSheetHeader(sessionSchema.headers, sessionSchema).ok, true);
  assert.equal(compareSheetHeader(legacySessionHeaders, sessionSchema).ok, true);
  assert.equal(
    compareSheetHeader(previousCanonicalSessionHeaders, sessionSchema).ok,
    true
  );
  assert.equal(
    compareSheetHeader(previousLegacySessionHeaders, sessionSchema).ok,
    true
  );
  assert.equal(
    compareSheetHeader(feedbackSchema.headers.slice(0, -1), feedbackSchema).ok,
    true
  );
});

test("compareSheetHeader still rejects unknown partial legacy schemas", () => {
  const sessionSchema = SHEET_SCHEMAS.find(
    (schema) => schema.title === "訂餐場次表"
  )!;
  const feedbackSchema = SHEET_SCHEMAS.find(
    (schema) => schema.title === "問題回報表"
  )!;
  const orderSchema = SHEET_SCHEMAS.find(
    (schema) => schema.title === "訂單明細表"
  )!;

  const partiallyChangedSession = [
    ...acceptedHeaderVariants(sessionSchema)[1],
  ];
  partiallyChangedSession[5] = sessionSchema.headers[5];

  assert.equal(
    compareSheetHeader(partiallyChangedSession, sessionSchema).ok,
    false
  );
  assert.equal(
    compareSheetHeader(feedbackSchema.headers.slice(0, -2), feedbackSchema).ok,
    false
  );
  assert.equal(
    compareSheetHeader(orderSchema.headers.slice(0, -1), orderSchema).ok,
    false
  );
});
