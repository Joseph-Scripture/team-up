import test from "node:test";
import assert from "node:assert/strict";
import { detectMimeType, isMimeTypeCompatible } from "../source/lib/fileSignature.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const gif = Buffer.from("GIF89a", "ascii");
const webp = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const pdf = Buffer.from("%PDF-1.7\n", "ascii");
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const text = Buffer.from("hello world\n", "utf8");

test("detects supported image signatures", () => {
  assert.equal(detectMimeType(png), "image/png");
  assert.equal(detectMimeType(jpeg), "image/jpeg");
  assert.equal(detectMimeType(gif), "image/gif");
  assert.equal(detectMimeType(webp), "image/webp");
});

test("detects PDF, ZIP, and OLE signatures", () => {
  assert.equal(detectMimeType(pdf), "application/pdf");
  assert.equal(detectMimeType(zip), "application/zip");
  assert.equal(detectMimeType(ole), "application/x-ole-storage");
});

test("returns null for text and unknown/empty data", () => {
  assert.equal(detectMimeType(text), null);
  assert.equal(detectMimeType(Buffer.alloc(0)), null);
  assert.equal(detectMimeType(Buffer.from([0x01, 0x02, 0x03, 0x04])), null);
});

test("accepts matching declared MIME types", () => {
  assert.equal(isMimeTypeCompatible("image/png", "image/png"), true);
  assert.equal(isMimeTypeCompatible("application/pdf", "application/pdf"), true);
  assert.equal(isMimeTypeCompatible("application/zip", "application/zip"), true);
  assert.equal(
    isMimeTypeCompatible(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
    ),
    true,
  );
  assert.equal(isMimeTypeCompatible("application/msword", "application/x-ole-storage"), true);
  assert.equal(isMimeTypeCompatible("text/plain", null), true);
});

test("rejects spoofed or mismatched MIME types", () => {
  assert.equal(isMimeTypeCompatible("image/jpeg", "image/png"), false);
  assert.equal(isMimeTypeCompatible("application/pdf", null), false);
  assert.equal(isMimeTypeCompatible("text/plain", "image/png"), false);
  assert.equal(isMimeTypeCompatible("image/png", "application/pdf"), false);
  assert.equal(isMimeTypeCompatible(undefined, "image/png"), false);
});
