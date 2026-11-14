import test from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "../source/middleware/validateProject.js";

function baseRequest(body) {
  return {
    body,
    query: {},
    params: { id: "project_1" },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/api/projects/project_1/publish",
  };
}

function runMiddleware(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      payload: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        resolve({ passed: false, res: this });
        return this;
      },
    };

    validatePublish(req, res, (error) => resolve({ passed: true, error }));
  });
}

test("validatePublish accepts a request with no body at all", async () => {
  const result = await runMiddleware(baseRequest(undefined));
  assert.equal(result.passed, true);
});

test("validatePublish accepts an empty JSON body", async () => {
  const result = await runMiddleware(baseRequest({}));
  assert.equal(result.passed, true);
});

test("validatePublish rejects a partial body with field errors", async () => {
  const result = await runMiddleware(baseRequest({ title: "Only a title" }));
  assert.equal(result.passed, false);
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.res.payload.message, "Invalid input");

  const fields = result.res.payload.errors.map((error) => error.field);
  assert.ok(fields.includes("problem"));
  assert.ok(fields.includes("skills"));
  assert.ok(fields.includes("milestones"));
});
