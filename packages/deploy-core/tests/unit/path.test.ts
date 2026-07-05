// packages/deploy-core/tests/unit/path.test.ts

import { describe, expect, test } from "bun:test";
import { normalizeZipEntryPath } from "../../src/path";

describe("normalizeZipEntryPath", () => {
  describe("valid paths pass through", () => {
    test("simple file path", () => {
      expect(normalizeZipEntryPath("index.html")).toBe("index.html");
    });

    test("nested directory path", () => {
      expect(normalizeZipEntryPath("assets/index.js")).toBe("assets/index.js");
    });

    test("deeply nested path", () => {
      expect(normalizeZipEntryPath("assets/css/style.css")).toBe("assets/css/style.css");
    });

    test("leading ./ is removed", () => {
      expect(normalizeZipEntryPath("./assets/index.js")).toBe("assets/index.js");
    });

    test("backslash normalized to forward slash", () => {
      expect(normalizeZipEntryPath("assets\\index.js")).toBe("assets/index.js");
    });
  });

  describe("dangerous paths are rejected", () => {
    test("rejects path traversal with ../", () => {
      expect(() => normalizeZipEntryPath("../evil.txt")).toThrow();
    });

    test("rejects deeply nested path traversal", () => {
      expect(() => normalizeZipEntryPath("assets/../../evil.txt")).toThrow();
    });

    test("rejects backslash path traversal", () => {
      expect(() => normalizeZipEntryPath("..\\evil.txt")).toThrow();
    });

    test("rejects absolute Unix path", () => {
      expect(() => normalizeZipEntryPath("/etc/passwd")).toThrow();
    });

    test("rejects Windows drive path (C:)", () => {
      expect(() => normalizeZipEntryPath("C:\\Windows\\system.ini")).toThrow();
    });

    test("rejects Windows drive path forward slash (C:/)", () => {
      expect(() => normalizeZipEntryPath("C:/Windows/system.ini")).toThrow();
    });

    test("rejects path with NUL byte", () => {
      expect(() => normalizeZipEntryPath("file\0name.txt")).toThrow();
    });

    test("rejects empty path", () => {
      expect(() => normalizeZipEntryPath("")).toThrow();
    });

    test("rejects //server/share paths", () => {
      expect(() => normalizeZipEntryPath("//server/share/file.txt")).toThrow();
    });

    test("rejects abc\\..\\evil.txt traversal", () => {
      expect(() => normalizeZipEntryPath("abc\\..\\evil.txt")).toThrow();
    });

    test("rejects percent-encoded NUL byte", () => {
      expect(() => normalizeZipEntryPath("file%00name.txt")).toThrow();
    });

    test("rejects percent-encoded backslash traversal", () => {
      expect(() => normalizeZipEntryPath("..%5c..%5cevil.txt")).toThrow();
    });
  });
});
