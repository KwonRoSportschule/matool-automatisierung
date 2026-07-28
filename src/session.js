const BASE_URL = "https://core.matool.de";

export class CookieJar {
  #cookies = new Map();

  absorb(response) {
    const headers = response.headers;
    const values = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);

    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.#cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export async function login({ mail, password, fetchImpl = fetch }) {
  if (!mail || !password) throw new Error("Missing MATOOL credentials");
  const jar = new CookieJar();
  const initial = await fetchImpl(`${BASE_URL}/index.php`, { redirect: "manual" });
  jar.absorb(initial);
  if (!initial.ok) throw new Error(`MATOOL session initialization failed (${initial.status})`);

  const response = await fetchImpl(`${BASE_URL}/index.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.header(),
    },
    body: new URLSearchParams({ mail, pass: password }),
  });
  jar.absorb(response);
  if (response.status !== 302) throw new Error(`MATOOL login failed (${response.status})`);

  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", jar.header());
    const result = await fetchImpl(new URL(path, BASE_URL), { ...init, headers });
    jar.absorb(result);
    return result;
  };
}
