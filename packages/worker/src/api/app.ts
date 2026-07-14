// The member `/api` mount (member-api): per-area typed Hono sub-apps, chained so their
// request/response types accumulate into `MemberApi` — the `/admin/api/*` + typed `hc`
// pattern. The SPA consumes `MemberApi` via a TYPE-ONLY import of the worker package's
// `./api` export subpath, so no workerd code can reach the browser bundle. Routes call
// the same throw-free `src/` operation functions the MCP tools call and NEVER touch
// `env.DB` directly (the `src/db.ts` rule); errors are structured `ToolError`s mapped
// to HTTP status once, in the shared middleware. Dispatched from `src/index.ts`'s
// `defaultHandler` for `/api` + `/api/*`, before the `/admin` dispatch.

import { Hono } from "hono";
import type { ApiEnv } from "../session.js";
import { sessionArea } from "./session.js";
import { signupArea } from "./signup.js";
import { passkeyArea } from "./passkey.js";
import { cookbookArea } from "./cookbook.js";
import { overlayArea } from "./overlay.js";
import { planArea } from "./plan.js";
import { groceryArea } from "./grocery.js";
import { pantryArea } from "./pantry.js";
import { logArea } from "./log.js";
import { profileArea } from "./profile.js";
import { retrospectiveArea } from "./retrospective.js";
import { vibesArea } from "./vibes.js";
import { proposeArea } from "./propose.js";
import { appBuild, buildHeader, csrfGuard, onApiError, usagePoint } from "./middleware.js";

const app = new Hono<ApiEnv>().basePath("/api");

// Shared skeleton, outermost-first: the usage point wraps everything (a CSRF 403 is
// still a data point), the build header stamps every response, and the CSRF guard runs
// before any handler. Later areas inherit all three by mounting below.
app.use("*", usagePoint);
app.use("*", buildHeader);
app.use("*", csrfGuard);
app.onError(onApiError);

// Per-area sub-apps chained with `.route()` so `hc` type-checks stay fast as areas
// accrue (each area is one file under src/api/; P1 areas append another `.route()`).
const routes = app
  // Version (unauthenticated — a build id is not tenant data, and the SPA needs it
  // pre-login for the update prompt): the version-skew contract's polling endpoint.
  .get("/version", (c) => c.json({ build: appBuild(c.env) }))
  .route("/", sessionArea)
  // Self-service signup: redeem a group invite code + chosen username → new tenant + session.
  .route("/", signupArea)
  // Passkey ceremonies + cross-device connect approval (passkey-auth).
  .route("/", passkeyArea)
  // The member core (member-app-core): every area session-gated per route.
  .route("/", cookbookArea)
  .route("/", overlayArea)
  .route("/", planArea)
  .route("/", groceryArea)
  .route("/", pantryArea)
  .route("/", logArea)
  .route("/", profileArea)
  .route("/", retrospectiveArea)
  .route("/", vibesArea)
  // The propose flow (member-app-propose): the stateless propose POST + the weather GET.
  .route("/", proposeArea);

/** The composed app type the SPA's `hc<MemberApi>("/")` client infers from. */
export type MemberApi = typeof routes;
export default app;
