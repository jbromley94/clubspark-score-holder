# Implementation notes

The supplied task remains in [README.md](README.md). This document describes the
implemented behavior, design decisions, and development commands.

## Implemented API

`new ScoreHolder(historyLimit = 10)` accepts a positive safe integer. The implementation
uses JavaScript built-ins only; all package dependencies are development tools.

- `putScore(match, score)` stores a string score, resolves current waiters, and delivers
  subscriber notifications synchronously. Every call is an update, even for identical scores.
- `getScore(match)` returns the latest score, or `undefined` for an unknown match.
- `getHistory(match)` returns an independent array of up to `historyLimit` scores, oldest first.
  Unknown matches return an empty array.
- `waitForNextScore(match, signal?)` returns a promise for the first subsequent update.
  It does not replay the current score or buffer updates between waits. An optional
  `AbortSignal` cancels the wait with its abort reason; its listener is removed on completion.
  An already-aborted signal wins over a score published during abort-event dispatch.
  Aborting after the promise has settled does not change its result.
- `subscribe(match, listener)` returns an idempotent unsubscribe function. Each registration
  is independent, even when the callback is shared. It only receives future updates.

Listeners must be synchronous and return `undefined`; async listeners are rejected by the
TypeScript signature; untyped JavaScript callers do not receive that compile-time check.
Keep callbacks short because they run inside `putScore`. A callback
can publish more scores: these are stored immediately, with notifications queued in write
order. New subscriptions cannot receive already queued updates, and unsubscribing skips
notifications that have not yet been delivered. Listener failures do not stop other listeners
or roll back stored scores: the outermost `putScore` throws an `AggregateError` after delivery.
Inside a callback, use the delivered score argument for that event. A prior listener may
have published again, so `getScore` can already return a newer stored score.

Resolved promises resume consumers in a later microtask. A loop that repeatedly awaits
`waitForNextScore` can therefore miss publications between registrations. A subscription
receives each future publication while active, but a slow callback delays the producer.
This class does not provide asynchronous backpressure or a durable event log.

## Storage and delivery costs

History uses a circular buffer, so updating history and reading the latest score take O(1)
work regardless of the history limit. Buffers grow as scores arrive rather than allocating
the whole limit upfront. Reading history copies up to N entries in O(N) work. The latest
score comes from the same buffer, avoiding a separate map of scores.

Notifications snapshot subscription records once per update, avoiding a new closure per
subscriber. Queued batches are released as they are delivered, so completed notifications
do not accumulate during long chains of callback-triggered writes. Delivery still requires
O(S) work for S subscribers, plus O(W) work for W waiting consumers. Writes with no
subscribers skip notification processing entirely.

An instance is shared within one JavaScript process; it does not synchronize separate
workers or servers. History is bounded per match, but match IDs are retained for the
instance's lifetime. Request handlers should abort abandoned waits and unsubscribe when
clients disconnect.

## Source layout and contracts

- `src/scoreHolder.ts` owns the mutable state and its operations.
- `src/interfaces/scoreHolder.ts` groups internal history, subscription, and notification
  records alongside the public `IScoreHolder` contract used by adapters.
- `src/types/scoreHolder.ts` defines the public callback and unsubscribe types.
- `src/server/` contains the optional Node HTTP adapter and request validation.
- `src/interfaces/scoreServer.ts` defines the adapter's optional timing settings.
- `demo/server.cjs` starts the compiled adapter with one shared `ScoreHolder` instance.

`ScoreHolder implements IScoreHolder` makes the boundary explicit. The adapter receives
that interface through its factory function, so it does not create a new holder per request
or depend on private storage details. Contract checks keep the public signatures aligned.

Readonly fields protect references and notification recipient lists at compile time;
subscription activity and the history write position remain mutable. No runtime freeze
or third-party implementation dependency is needed.

Type-only modules are excluded from execution coverage because they contain no executable
logic. Their imports and contracts are still checked by `tsc --noEmit`. The type and interface
test files use `expectTypeOf`; running Vitest alone does not enforce those assertions.
Use `npm run validate` to include both type checking and behavior tests.

## Development

Use Node.js 24. Run `npm ci` to install the locked development tools, then `npm run validate` to run
TypeScript checking, Biome checking, and the test suite with coverage. `npm run test:watch`
runs the tests during development. Tests cover history wraparound, cancellation, independent
consumers, notification errors, and reentrant delivery.

```sh
npm ci
npm run validate
```

`npm ci` recreates `node_modules` from `package-lock.json` without updating the dependency
versions or rewriting the lockfile. It fails if the package manifest and lockfile disagree,
which makes it useful when checking the project in a fresh checkout or in CI.

Coverage thresholds remain at 99% for each metric and executable source file. Coverage
measures exercised code; the behavioral assertions establish what the code must do.

## Optional HTTP demonstration

The original brief asks for the class. This adapter demonstrates one instance shared across
HTTP request handlers. The implementation imports only local modules and Node built-ins;
no npm packages were added for the adapter. TypeScript is used to build it, and the compiled
demo runs with Node alone. The original class remains independently usable.

```sh
npm ci
npm run validate
npm run demo
```

`npm run demo` first builds `src/` using `tsconfig.build.json`, then listens on
`http://127.0.0.1:3000`. Tests are not emitted into the build. Stop the demo with Ctrl+C;
scores are held in memory and disappear when the process exits.

In another PowerShell terminal, publish and retrieve a score:

```powershell
$scoreUrl = 'http://127.0.0.1:3000/matches/M1/score'
Invoke-RestMethod -Method Post -Uri $scoreUrl -ContentType 'application/json' -Body '{"score":"15-0"}'

Invoke-RestMethod -Uri 'http://127.0.0.1:3000/matches/M1/score'
```

Both responses identify the match and score. Repeating the POST with `30-0` changes the
score returned by later GET requests. The same holder serves every request, including
requests from different terminals. Concurrent writes are applied in the order their bodies
finish being read and validated, not necessarily the order the connections arrived.

| Request | Result |
| --- | --- |
| `POST /matches/:match/score` with `{"score":"15-0"}` | `201` with `{ "match": "M1", "score": "15-0" }` and a `Location` header |
| `GET /matches/:match/score` | `200` with the latest score, or `404` if none exists |
| `GET /matches/:match/history` | `200` with `{ "match": "M1", "scores": [...] }`, oldest first; empty for an unknown match |
| `GET /matches/:match/next` | Waits for the next publication, then `200` with `{ "match": "M1", "score": "..." }`; `204` with no body after 30 seconds without an update |
| `GET /matches/:match/events` | `200` with a live `text/event-stream` of future publications |
| Unsupported method on a recognized route | `405`; `Allow: GET, POST` for `score`, otherwise `Allow: GET` |
| Unknown route | `404` |
| Malformed match encoding, JSON, UTF-8, or a non-string score | `400` |
| Missing or unsupported JSON content type | `415` |
| Body larger than 8192 bytes, including JSON syntax | `413` |

Use URL encoding for match identifiers. Query parameters are ignored. The adapter accepts
opaque string scores, including empty strings, and does not validate tennis scoring rules.
POST represents a new publication, so repeating a request records another update even if
the score text is identical. Interrupted uploads are not published.

Responses use `Cache-Control: no-store`; score data is JSON except for the SSE framing on
the events route. If a subscriber throws after storage,
the publication still returns `201`, with an additional `notificationErrors` count. This
avoids telling a producer to retry a score that was already stored. Private error details
are not sent to clients. Other unexpected failures return a generic `500`.

Integration tests start real HTTP servers on ephemeral localhost ports. They check shared
state, multiple producers, input and byte-limit boundaries, interrupted uploads, and the
distinction between failed storage and failed subscriber notifications.

## HTTP history and one-shot waiting

Keep `npm run demo` running in terminal 1. In terminal 2, inspect the current history:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/matches/M1/history' | ConvertTo-Json
```

The limit comes from the shared holder's constructor, not a query parameter. Repeated
POSTs create repeated history entries, including identical scores. Restarting the demo
starts a fresh holder, so publish a score again after a restart.

In terminal 2, start a one-shot wait:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/matches/M1/next'
```

This command stays open until the next M1 publication or the deadline. In terminal 3,
publish the next score before the 30-second deadline:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/matches/M1/score' -ContentType 'application/json' -Body '{"score":"30-0"}'
```

Terminal 2 returns `M1` and `30-0`. Another match's publication does not complete this wait.
All current waiters for M1 receive its next update. No score is replayed when a wait starts.
If the deadline expires, the response is an empty `204`; the client can start another wait.
Publications between requests can be missed. Closing the request aborts the core wait.
Timeout, completion, and disconnect paths remove timers and response listeners.

## Live SSE spectators

SSE keeps one HTTP response open and sends named `score` events. Each event contains a
JSON object with `match` and `score`. It is suitable here because spectators only need
server-to-client updates; producers use the POST endpoint.

In terminal 2, connect a spectator:

```powershell
curl.exe --no-buffer http://127.0.0.1:3000/matches/M1/events
```

The explicit `.exe` selects the curl executable on Windows. `--no-buffer` displays
updates as they arrive. Use curl for this demonstration because a continuously open
response is not a single JSON document for `Invoke-RestMethod` to deserialize.

Expect `: connected`, then `: heartbeat` comments about every 15 seconds while idle.
Keep terminal 3 available for publishing. Optionally open terminal 4 with the same curl
command to add another spectator. Run this in terminal 3:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/matches/M1/score' -ContentType 'application/json' -Body '{"score":"40-0"}'
```

Both spectators receive:

```text
event: score
data: {"match":"M1","score":"40-0"}

```

Each connection receives future publications for its match only. Existing scores are not
replayed. Score and match strings are JSON-escaped so embedded newlines cannot inject
extra SSE events. Press Ctrl+C in a spectator terminal to disconnect it. Its subscription,
heartbeat and response listeners are removed; other spectators continue receiving scores.

### Slow clients and delivery limits

The adapter disconnects a stream when `response.write()` signals backpressure, or when
the pending bytes plus the next UTF-8 frame would exceed 64 KiB. There is no additional
application queue. This deliberately favors bounded buffering and independent clients
over retaining every update for a slow or disconnected spectator. The limit concerns
application-visible output bytes, not a cap on all socket or operating-system memory.

A disconnected client can reconnect and request the latest score or bounded history.
There are no event IDs, acknowledgements, or `Last-Event-ID` replay support, so reconnecting
does not guarantee recovery of every missed update or an atomic snapshot/stream handoff.
The class remains usable independently of this optional transport policy.

This follows Node's [HTTP write/backpressure contract](https://nodejs.org/docs/latest-v24.x/api/http.html#responsewritechunk-encoding-callback)
and the [SSE framing and heartbeat guidance](https://html.spec.whatwg.org/multipage/server-sent-events.html).

### Configuration and validation

`createScoreServer(holder, options?)` accepts `IScoreServerOptions`: `waitTimeoutMs`
defaults to `30000`, and `heartbeatIntervalMs` defaults to `15000`. Both must be integer
milliseconds from 1 through 2147483647, matching supported timer bounds. They are server
configuration, not client-controlled query parameters.

HTTP integration tests use actual localhost connections for ordered streaming, independent
spectators, waiting, timeouts, and disconnects. Focused transport tests inject backpressure
and write failures without relying on machine-specific socket buffer sizes. Fake timers
verify exact deadlines and cleanup; contract tests check the configuration interface.

This is a local demonstration without authentication, persistence, cross-origin browser
configuration, global connection/match quotas, or a frontend. It is not a durable delivery
service. Separate server processes would require shared storage or messaging. Those are
deployment decisions beyond the class assignment.
