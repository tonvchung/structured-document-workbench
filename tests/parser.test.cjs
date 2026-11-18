"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseDocument, DocumentError } = require("../parser.js");

test("formats a standard JSON object", () => {
  const result = parseDocument('{"name":"安安","enabled":true,"items":[1,2]}');
  assert.equal(result.type, "json");
  assert.equal(result.data.name, "安安");
  assert.equal(result.formatted, '{\n  "name": "安安",\n  "enabled": true,\n  "items": [\n    1,\n    2\n  ]\n}');
  assert.equal(result.ignoredBefore, 0);
  assert.equal(result.ignoredAfter, 0);
});

test("extracts JSON between log prefixes and suffixes", () => {
  const source = '2026-11-17 10:00:00 [INFO] request={"user":{"name":"安安"},"ok":true}\n2026-11-17 10:00:01 [INFO] completed';
  const result = parseDocument(source);
  assert.equal(result.type, "json");
  assert.deepEqual(result.data, { user: { name: "安安" }, ok: true });
  assert.equal(source.slice(result.start, result.end), '{"user":{"name":"安安"},"ok":true}');
  assert.ok(result.ignoredBefore > 0);
  assert.ok(result.ignoredAfter > 0);
});

test("ignores bracketed log levels before an array document", () => {
  const result = parseDocument('[DEBUG] response: [1,{"value":"x"}] END');
  assert.equal(result.type, "json");
  assert.deepEqual(result.data, [1, { value: "x" }]);
});

test("keeps brackets and escaped quotes inside JSON strings", () => {
  const source = 'noise {"text":"a {brace} and [bracket]","quote":"say \\"hi\\""} trailing';
  const result = parseDocument(source);
  assert.equal(result.data.text, "a {brace} and [bracket]");
  assert.equal(result.data.quote, 'say "hi"');
});

test("supports all valid JSON root values", () => {
  assert.equal(parseDocument('"text"').data, "text");
  assert.equal(parseDocument("42").data, 42);
  assert.equal(parseDocument("false").data, false);
  assert.equal(parseDocument("null").data, null);
});

test("distinguishes malformed JSON from text without a document", () => {
  assert.throws(
    () => parseDocument("ordinary log text without structured content"),
    (error) => error instanceof DocumentError && error.code === "NO_DOCUMENT"
  );
  assert.throws(
    () => parseDocument("request: {name: missing quotes}"),
    (error) => error instanceof DocumentError && error.code === "PARSE_FAILED"
  );
  assert.throws(
    () => parseDocument('response: {"name":"安安"'),
    (error) => error instanceof DocumentError && error.code === "PARSE_FAILED"
  );
});

test("does not stop at an invalid bracket pair before valid JSON", () => {
  const result = parseDocument('[INFO] not-json; {"actual":{"document":true}}');
  assert.equal(result.data.actual.document, true);
});

test("manifest requires no user data or host permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(Object.hasOwn(manifest, "permissions"), false);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.equal(manifest.offline_enabled, true);
});
