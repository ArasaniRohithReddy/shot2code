const fs = require("fs");
const path = require("path");

const GITHUB_OAUTH_CLIENT_ID = "Ov23liQWC9VacO7ZsjWr";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EXPIRY_SKEW_MS = 60_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function githubPost(fetchImpl, url, values) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody(values),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub OAuth returned HTTP ${response.status}.`);
  }
  return payload;
}

function publicState(state) {
  return {
    status: state.status,
    method: "github-oauth",
    message: state.message || "",
    login: state.login || null,
    canCancel: state.status === "starting" || state.status === "waiting",
    installUrl: null,
    userCode: state.userCode || null,
    verificationUri: state.verificationUri || null,
  };
}

class GitHubOAuthManager {
  constructor({
    userDataPath,
    safeStorage,
    openExternal,
    fetchImpl = fetch,
    clientId = GITHUB_OAUTH_CLIENT_ID,
    delayImpl = delay,
  }) {
    this.clientId = clientId;
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.fetch = fetchImpl;
    this.delay = delayImpl;
    this.tokenPath = path.join(userDataPath, "github-oauth-token.bin");
    this.state = {
      status: "idle",
      message: "",
      login: null,
      userCode: null,
      verificationUri: null,
    };
    this.pollTask = null;
    this.cancelled = false;
  }

  status() {
    return publicState(this.state);
  }

  _readStored() {
    if (!fs.existsSync(this.tokenPath)) return null;
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = fs.readFileSync(this.tokenPath);
      const decrypted = this.safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  _writeStored(tokens) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(this.tokenPath, encrypted);
  }

  _clearStored() {
    try {
      fs.unlinkSync(this.tokenPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async _loginForToken(accessToken) {
    const response = await this.fetch(USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: ["Bearer", accessToken].join(" "),
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return typeof payload.login === "string" ? payload.login : null;
  }

  _normalizeToken(payload, previous = null) {
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("GitHub did not return an access token.");
    }
    const now = Date.now();
    return {
      accessToken: payload.access_token,
      refreshToken:
        typeof payload.refresh_token === "string"
          ? payload.refresh_token
          : previous?.refreshToken || null,
      expiresAt:
        typeof payload.expires_in === "number"
          ? now + payload.expires_in * 1000
          : null,
      refreshExpiresAt:
        typeof payload.refresh_token_expires_in === "number"
          ? now + payload.refresh_token_expires_in * 1000
          : previous?.refreshExpiresAt || null,
      login: previous?.login || null,
    };
  }

  async _refresh(tokens) {
    if (!tokens.refreshToken) return null;
    if (
      tokens.refreshExpiresAt &&
      Date.now() >= tokens.refreshExpiresAt - EXPIRY_SKEW_MS
    ) {
      return null;
    }
    const payload = await githubPost(this.fetch, ACCESS_TOKEN_URL, {
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });
    if (payload.error) return null;
    const refreshed = this._normalizeToken(payload, tokens);
    refreshed.login =
      (await this._loginForToken(refreshed.accessToken)) || tokens.login || null;
    this._writeStored(refreshed);
    return refreshed;
  }

  async getToken() {
    const tokens = this._readStored();
    if (!tokens?.accessToken) return null;
    if (!tokens.expiresAt || Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) {
      return tokens.accessToken;
    }
    try {
      return (await this._refresh(tokens))?.accessToken || null;
    } catch {
      return null;
    }
  }

  async start() {
    if (this.pollTask) return this.status();
    this.cancelled = false;
    this.state = {
      status: "starting",
      message: "Requesting a GitHub device code…",
      login: null,
      userCode: null,
      verificationUri: null,
    };
    try {
      const payload = await githubPost(this.fetch, DEVICE_CODE_URL, {
        client_id: this.clientId,
        scope: "read:user offline_access",
      });
      if (
        typeof payload.device_code !== "string" ||
        typeof payload.user_code !== "string" ||
        typeof payload.verification_uri !== "string"
      ) {
        throw new Error("GitHub returned an incomplete device-flow response.");
      }
      const intervalSeconds =
        typeof payload.interval === "number" ? payload.interval : 5;
      const expiresSeconds =
        typeof payload.expires_in === "number" ? payload.expires_in : 900;
      this.state = {
        status: "waiting",
        message: "Enter the code in the GitHub page, then return to shot2code.",
        login: null,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
      };
      await this.openExternal(payload.verification_uri);
      this.pollTask = this._poll(
        payload.device_code,
        intervalSeconds,
        Date.now() + expiresSeconds * 1000
      ).finally(() => {
        this.pollTask = null;
      });
      return this.status();
    } catch (error) {
      this.state = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Could not start GitHub sign-in.",
        login: null,
        userCode: null,
        verificationUri: null,
      };
      return this.status();
    }
  }

  async _poll(deviceCode, initialIntervalSeconds, expiresAt) {
    let intervalSeconds = initialIntervalSeconds;
    while (!this.cancelled && Date.now() < expiresAt) {
      await this.delay(intervalSeconds * 1000);
      if (this.cancelled) return;
      let payload;
      try {
        payload = await githubPost(this.fetch, ACCESS_TOKEN_URL, {
          client_id: this.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
      } catch {
        continue;
      }
      if (payload.error === "authorization_pending") continue;
      if (payload.error === "slow_down") {
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        this.state = {
          status: "failed",
          message:
            payload.error === "access_denied"
              ? "GitHub sign-in was denied."
              : "GitHub sign-in expired or could not be completed.",
          login: null,
          userCode: null,
          verificationUri: null,
        };
        return;
      }
      try {
        const tokens = this._normalizeToken(payload);
        tokens.login = await this._loginForToken(tokens.accessToken);
        this._writeStored(tokens);
        this.state = {
          status: "succeeded",
          message: tokens.login
            ? `Signed in as ${tokens.login}.`
            : "Signed in with GitHub.",
          login: tokens.login,
          userCode: null,
          verificationUri: null,
        };
      } catch (error) {
        this.state = {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "GitHub sign-in could not be stored securely.",
          login: null,
          userCode: null,
          verificationUri: null,
        };
      }
      return;
    }
    if (!this.cancelled) {
      this.state = {
        status: "failed",
        message: "GitHub sign-in expired. Start it again to receive a new code.",
        login: null,
        userCode: null,
        verificationUri: null,
      };
    }
  }

  async cancel() {
    this.cancelled = true;
    this.state = {
      status: "cancelled",
      message: "Sign-in was cancelled.",
      login: null,
      userCode: null,
      verificationUri: null,
    };
    return this.status();
  }

  async disconnect() {
    this.cancelled = true;
    this._clearStored();
    this.state = {
      status: "idle",
      message: "Disconnected from GitHub in shot2code.",
      login: null,
      userCode: null,
      verificationUri: null,
    };
    return this.status();
  }
}

module.exports = {
  GITHUB_OAUTH_CLIENT_ID,
  GitHubOAuthManager,
};
