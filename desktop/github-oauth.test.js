const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");

const {
  GITHUB_OAUTH_CLIENT_ID,
  GitHubOAuthManager,
} = require("./github-oauth");

function storage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => Buffer.from(value).toString("utf8"),
  };
}

test("uses the shot2code OAuth client id and exposes no secret", () => {
  assert.equal(GITHUB_OAUTH_CLIENT_ID, "Ov23liQWC9VacO7ZsjWr");
});

test("disconnect removes only shot2code's encrypted token", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shot2code-oauth-"));
  const manager = new GitHubOAuthManager({
    userDataPath: root,
    safeStorage: storage(),
    openExternal: async () => {},
    fetchImpl: async () => {
      throw new Error("not used");
    },
  });
  manager._writeStored({
    accessToken: "oauth-token",
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
    login: "octocat",
  });

  assert.equal(await manager.getToken(), "oauth-token");
  await manager.disconnect();
  assert.equal(await manager.getToken(), null);
});

test("device flow opens GitHub and stores the resulting user token", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shot2code-oauth-flow-"));
  const opened = [];
  let request = 0;
  const manager = new GitHubOAuthManager({
    userDataPath: root,
    safeStorage: storage(),
    openExternal: async (url) => opened.push(url),
    delayImpl: async () => {},
    fetchImpl: async (url) => {
      request += 1;
      if (url.includes("/login/device/code")) {
        return {
          ok: true,
          json: async () => ({
            device_code: "device-code",
            user_code: "ABCD-EFGH",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 1,
          }),
        };
      }
      if (url.includes("/login/oauth/access_token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "oauth-access-token",
            refresh_token: "oauth-refresh-token",
            expires_in: 28_800,
            refresh_token_expires_in: 15_552_000,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ login: "octocat" }),
      };
    },
  });

  const started = await manager.start();
  assert.equal(started.status, "waiting");
  assert.equal(started.userCode, "ABCD-EFGH");
  await manager.pollTask;

  assert.equal(manager.status().status, "succeeded");
  assert.equal(manager.status().login, "octocat");
  assert.equal(await manager.getToken(), "oauth-access-token");
  assert.deepEqual(opened, ["https://github.com/login/device"]);
  assert.equal(request, 3);
});
