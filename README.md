# ScoreHolder

[![CI](https://github.com/jbromley94/interviewTest/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/jbromley94/interviewTest/actions/workflows/ci.yaml)

A dependency-free TypeScript implementation of the ClubSpark technical exercise.

The core `ScoreHolder` maintains the latest score for each match while supporting multiple producers and consumers through one-shot waiting, persistent subscriptions and bounded score history.

An optional HTTP/SSE adapter is also included to demonstrate how the core implementation could be shared by concurrent request handlers without coupling the domain logic to a web framework.

## Requirements

- Node.js 24
- npm

## Getting started

Install dependencies:

```bash
npm ci
```

Run the complete validation suite:

```bash
npm run validate
```

Start the optional HTTP demo:

```bash
npm run demo
```

The demo listens on:

```text
http://127.0.0.1:3000
```

## Core API

`ScoreHolder` exposes the following operations:

```ts
constructor(historyLimit = 10)

putScore(match: string, score: string): void

getScore(match: string): string | undefined

getHistory(match: string): string[]

waitForNextScore(match: string): Promise<string>

subscribe(
  match: string,
  onScore: (score: string) => void
): () => void
```

### `putScore`

Publishes a score for a match.

The latest score is retained, the score is added to that match's bounded history, waiting consumers are resolved and active subscribers are notified.

Repeated values are still treated as new score publications.

### `getScore`

Returns the most recently published score for the requested match.

Returns `undefined` when no score has yet been published.

### `waitForNextScore`

Returns a promise for the next score published after the call is made.

The waiter is one-shot - after receiving that score, another call is required to wait for a subsequent update.

Multiple consumers may wait for the same match concurrently.

### `subscribe`

Registers a persistent subscriber for a match.

The callback receives subsequent score publications until the returned unsubscribe function is called.

```ts
const unsubscribe = scoreHolder.subscribe('M1', score => {
  console.log(score);
});

unsubscribe();
```

### `getHistory`

Returns the retained score history for a match in publication order.

History is bounded per match. The default limit is `10` and may be changed when constructing the `ScoreHolder`.

```ts
const scoreHolder = new ScoreHolder(20);
```

## Behaviour and concurrency

The implementation is designed around the exercise requirement that a single `ScoreHolder` instance may be shared by multiple concurrent request handlers.

Each match maintains independent state.

The implementation supports:

- multiple producers publishing scores
- multiple consumers waiting for the next score
- multiple persistent subscribers
- scores being produced faster than they are consumed
- bounded history per match
- re-entrant score publication
- ordered subscriber notification
- subscriber removal without affecting other consumers

A call to `waitForNextScore` observes only a future publication - it does not return the score that was current when the waiter was registered.

Subscriber callbacks are invoked synchronously. Re-entrant calls to `putScore` are queued so that publications remain ordered rather than recursively interleaving subscriber notifications.

If a subscriber throws, the remaining eligible subscribers are still given the opportunity to process the publication. Subscriber failures are collected and surfaced as an `AggregateError` after notification processing has completed.

The score and history update itself remains committed.

## Optional HTTP demo

The HTTP layer is intentionally separate from the core `ScoreHolder`.

It uses Node's built-in HTTP functionality rather than introducing a framework or runtime dependency.

The server shares one `ScoreHolder` instance between requests, demonstrating how the class can be used by multiple HTTP consumers and producers.

### Health check

```text
GET /health
```

Returns a lightweight liveness response confirming that the HTTP service is available:

```json
{
  "status": "ok"
}
```

The endpoint deliberately does not inspect score state or external dependencies.

### Publish a score

```text
POST /matches/:id/score
```

Example:

```bash
curl -X POST http://127.0.0.1:3000/matches/M1/score \
  -H "Content-Type: application/json" \
  -d '{"score":"40-15"}'
```

PowerShell:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:3000/matches/M1/score' `
  -ContentType 'application/json' `
  -Body '{"score":"40-15"}'
```

### Read the latest score

```text
GET /matches/:id/score
```

Example:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri 'http://127.0.0.1:3000/matches/M1/score'
```

### Read retained history

```text
GET /matches/:id/history
```

Returns the retained scores for the match from oldest to newest.

### Wait for the next score

```text
GET /matches/:id/next
```

The request waits for the next score publication for that match.

If no new score is published within 30 seconds, the server returns `204 No Content`.

This demonstrates the one-shot `waitForNextScore` behaviour over HTTP.

### Stream score updates

```text
GET /matches/:id/events
```

Opens a Server-Sent Events stream containing future score publications for the requested match.

For example:

```bash
curl -N http://127.0.0.1:3000/matches/M1/events
```

Then publish scores from another terminal.

The SSE implementation cleans up subscriptions when clients disconnect and protects the server from indefinitely buffering data for slow consumers.

The stream intentionally represents live updates rather than durable event replay, so scores missed while disconnected are not replayed when a client reconnects.

## Architecture

The project keeps the core scoring behaviour separate from delivery concerns.

```text
src/
├── interfaces/
│   ├── scoreHolder.ts
│   └── scoreServer.ts
│
├── server/
│   ├── httpError.ts
│   ├── readScore.ts
│   ├── scoreServer.ts
│   ├── sendJson.ts
│   ├── streamScores.ts
│   └── waitForScore.ts
│
├── types/
│
└── scoreHolder.ts
```

`scoreHolder.ts` contains the core state and publication behaviour.

The interfaces define the boundaries consumed by the HTTP layer.

The `server` directory adapts those interfaces to Node HTTP requests and responses.

As a result, the core implementation does not depend on HTTP, SSE or any particular server framework.

## Testing

The project is developed and tested using Vitest.

The current suite contains:

```text
15 test files
139 tests
100% statement coverage
100% branch coverage
100% function coverage
100% line coverage
```

The tests cover both the core behaviour and the optional HTTP adapter, including concurrency and edge cases such as:

- independent match state
- multiple waiters
- multiple subscribers
- bounded history
- repeated score publications
- unsubscribe behaviour
- subscriber exceptions
- nested/re-entrant publications
- HTTP validation and error handling
- long-poll request behaviour
- SSE connections and disconnections
- slow SSE consumers

## Validation

The complete local validation command is:

```bash
npm run validate
```

This runs the project's TypeScript, formatting/linting and automated test checks.

The same command is executed by CI so that the local and automated quality gates remain aligned.

Useful individual commands include:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Continuous integration

GitHub Actions runs the validation suite for pushes and pull requests targeting `main`.

The workflow performs a clean installation using the committed lockfile:

```bash
npm ci
```

followed by:

```bash
npm run validate
```

A failed type check, code-quality check, test or coverage requirement therefore causes the CI job to fail.

## Design decisions

### No runtime dependencies

The exercise asks for a dependency-free implementation, so the core solution uses TypeScript and platform APIs rather than application libraries.

The optional HTTP demo follows the same principle by using Node's built-in HTTP server rather than Express or another framework.

### In-memory state

State is intentionally held in memory.

This keeps the implementation focused on the requested concurrency and consumer behaviour rather than introducing persistence infrastructure unrelated to the exercise.

### Bounded history

History is retained per match with a configurable maximum size.

This prevents history from growing indefinitely while still providing recent score context.

### One-shot waiters and persistent subscribers

`waitForNextScore` and `subscribe` intentionally represent two different consumption models.

A waiter consumes one future publication.

A subscriber remains interested in future publications until explicitly unsubscribed.

### Publication ordering

Subscriber notification is deliberately ordered, including when a subscriber itself causes another score to be published.

This avoids nested publication producing surprising callback ordering.

## Production considerations

The implementation is intentionally scoped to the exercise rather than presented as a complete distributed production service.

For a production system I would consider additional concerns such as:

- durable persistence
- authentication and authorisation
- structured logging and observability
- metrics and tracing
- shared state or messaging between multiple application instances
- durable event replay where required
- dependency-aware readiness checks
- rate limiting and abuse protection

Those concerns are kept outside the exercise implementation so that the core behaviour remains small, testable and easy to reason about.