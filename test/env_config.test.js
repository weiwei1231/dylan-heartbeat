const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const envConfig = require("../env_config");
const ENV_FILE = envConfig.ENV_FILE;

test("runtime .env value overrides startup process.env", () => {
  const originalFile = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : null;
  const previous = process.env.__HOT_READ_TEST__;

  try {
    process.env.__HOT_READ_TEST__ = "startup-value";
    fs.writeFileSync(ENV_FILE, "__HOT_READ_TEST__=file-value\n", "utf8");
    assert.equal(envConfig.readEnvValue("__HOT_READ_TEST__"), "file-value");
  } finally {
    if (originalFile === null) {
      try { fs.unlinkSync(ENV_FILE); } catch {}
    } else {
      fs.writeFileSync(ENV_FILE, originalFile, "utf8");
    }
    if (previous === undefined) delete process.env.__HOT_READ_TEST__;
    else process.env.__HOT_READ_TEST__ = previous;
  }
});

test("falls back to process.env when .env does not define the key", () => {
  const originalFile = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : null;
  const previous = process.env.__HOT_READ_FALLBACK_TEST__;

  try {
    process.env.__HOT_READ_FALLBACK_TEST__ = "fallback-value";
    fs.writeFileSync(ENV_FILE, "# no test key\n", "utf8");
    assert.equal(envConfig.readEnvValue("__HOT_READ_FALLBACK_TEST__"), "fallback-value");
  } finally {
    if (originalFile === null) {
      try { fs.unlinkSync(ENV_FILE); } catch {}
    } else {
      fs.writeFileSync(ENV_FILE, originalFile, "utf8");
    }
    if (previous === undefined) delete process.env.__HOT_READ_FALLBACK_TEST__;
    else process.env.__HOT_READ_FALLBACK_TEST__ = previous;
  }
});

test("supports quoted values and escaped newlines", () => {
  const originalFile = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : null;

  try {
    fs.writeFileSync(ENV_FILE, '__HOT_READ_PARSE_TEST__="hello\\nworld"\n', "utf8");
    assert.equal(envConfig.readEnvValue("__HOT_READ_PARSE_TEST__"), "hello\nworld");
  } finally {
    if (originalFile === null) {
      try { fs.unlinkSync(ENV_FILE); } catch {}
    } else {
      fs.writeFileSync(ENV_FILE, originalFile, "utf8");
    }
  }
});
