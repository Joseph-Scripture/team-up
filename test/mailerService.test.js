import test from "node:test";
import assert from "node:assert/strict";

// config.js validates these at import time. Set them before importing the
// mailer so this test does not depend on a developer's local .env file.
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-validation";
process.env.CLOUDINARY_URL = "cloudinary://test-key:test-secret@test-cloud";
process.env.SEND_LIBERTY = "test-liberty-key";
process.env.EMAIL_FROM = '"TeamUP" <no-reply@example.com>';
process.env.EMAIL_REPLY_TO = '"TeamUP Support" <support@example.com>';

const { sendPasswordResetEmail, MailerError } = await import(
  "../source/services/mailerService.js"
);

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sendPasswordResetEmail posts the expected SendLiberty request", async () => {
  let captured;

  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await sendPasswordResetEmail({
    recipient: "ada@example.com",
    resetUrl: "https://app.test/reset-password?token=abc123",
  });

  assert.deepEqual(result, { id: "email_123" });
  assert.equal(captured.url, "https://sendliberty.com/api/send");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer test-liberty-key");
  assert.equal(captured.options.headers["Content-Type"], "application/json");

  const body = JSON.parse(captured.options.body);
  assert.equal(body.from, process.env.EMAIL_FROM);
  assert.equal(body.to, "ada@example.com");
  assert.equal(body.subject, "Reset your TeamUP password");
  assert.equal(body.replyTo, process.env.EMAIL_REPLY_TO);
  assert.match(
    body.html,
    /https:\/\/app\.test\/reset-password\?token=abc123/,
  );
  assert.match(
    body.text,
    /https:\/\/app\.test\/reset-password\?token=abc123/,
  );
});

test("sendPasswordResetEmail surfaces SendLiberty failures", async () => {
  globalThis.fetch = async () =>
    new Response("invalid api key", {
      status: 401,
      statusText: "Unauthorized",
    });

  await assert.rejects(
    sendPasswordResetEmail({
      recipient: "ada@example.com",
      resetUrl: "https://app.test/reset-password?token=abc123",
    }),
    (error) => {
      assert.ok(error instanceof MailerError);
      assert.equal(error.status, 401);
      assert.match(error.message, /invalid api key/);
      return true;
    },
  );
});

test("sendPasswordResetEmail wraps network failures", async () => {
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };

  await assert.rejects(
    sendPasswordResetEmail({
      recipient: "josephscripture12@gmail.com.com",
      resetUrl: "https://app.test/reset-password?token=abc123",
    }),
    (error) => {
      assert.ok(error instanceof MailerError);
      assert.match(error.message, /Could not reach SendLiberty/);
      return true;
    },
  );
});
