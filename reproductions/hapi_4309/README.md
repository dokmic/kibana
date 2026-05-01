# hapi issue 4309 reproduction

This folder is an isolated reproduction for hapijs/hapi#4309:
`Node 14 Error: write EPIPE`.

The original report describes `write EPIPE` logged from
`@hapi/hapi/lib/transmit.js` while running a BlazeMeter capacity test with:

```yaml
concurrency: 1000
ramp-up: 15m
throughput: 500
```

The report does not include the original application route, so this
reproduction uses a minimal hapi server with a slow, large streaming response.
Under high concurrency and client timeouts/aborts, this makes the broken-pipe
condition observable in the container logs.

## Files

- `server.js` - hapi server with `/large`, a slow streaming endpoint.
- `Dockerfile` - runs the app on `node:16.19.1-bullseye-slim`.
- `docker-compose.yml` - starts the hapi container on port 3000.
- `blazemeter.yml` - Taurus/BlazeMeter config using the issue's profile.
- `reproduce.sh` - convenience wrapper that builds the container and runs the
  local BlazeMeter-compatible load test through Taurus.

## Run

From this directory:

```sh
docker compose up --build hapi-4309
```

In another terminal, import `blazemeter.yml` into BlazeMeter or run the same
profile locally with Taurus:

```sh
bzt blazemeter.yml
```

If Taurus is not installed locally, use:

```sh
./reproduce.sh
```

That script runs Taurus from the `blazemeter/taurus` Docker image while the hapi
server remains in the Node 16.19.1 container.

## Expected signal

During the run, BlazeMeter/Taurus may report connection refused, connection
reset, or timeout errors. The hapi container logs are expected to include errors
with the same shape as the issue:

```text
Error: write EPIPE
errno: -32
code: EPIPE
syscall: write
```

The issue says the original test was long-running. Keep the full 15 minute
ramp-up for parity, or lower the `ramp-up` value in `blazemeter.yml` for a
quicker smoke test.
