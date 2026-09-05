// When no explicit backend URLs are provided, default to the same origin the
// app is served from. Combined with the Vite dev-server proxy, this makes the
// app work behind tunnels/preview URLs where "localhost" would point at the
// viewer's machine instead of the sandbox.
const SAME_ORIGIN_HTTP =
  typeof window !== "undefined"
    ? window.location.origin
    : "http://127.0.0.1:5173";
const SAME_ORIGIN_WS = SAME_ORIGIN_HTTP.replace(/^http/, "ws");

export const WS_BACKEND_URL =
  import.meta.env.VITE_WS_BACKEND_URL || SAME_ORIGIN_WS;

export const HTTP_BACKEND_URL =
  import.meta.env.VITE_HTTP_BACKEND_URL || SAME_ORIGIN_HTTP;
