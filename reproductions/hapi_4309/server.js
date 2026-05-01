const Hapi = require('@hapi/hapi');
const { Readable } = require('stream');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeSlowStream = ({ chunks, delayMs, chunkSize }) => {
  async function* generate() {
    const chunk = Buffer.alloc(chunkSize, 'x');

    for (let index = 0; index < chunks; index += 1) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      yield chunk;
    }
  }

  return Readable.from(generate(), { objectMode: false });
};

const formatError = (error) => ({
  type: error.name,
  message: error.message,
  stack: error.stack,
  errno: error.errno,
  code: error.code,
  syscall: error.syscall,
});

const init = async () => {
  const server = Hapi.server({
    host: '0.0.0.0',
    port: process.env.PORT || 3000,
    routes: {
      timeout: {
        server: false,
        socket: false,
      },
    },
  });

  server.events.on('log', (event, tags) => {
    if (tags.error && event.error) {
      console.error('server log error:', formatError(event.error));
    }
  });

  server.events.on('request', (request, event, tags) => {
    if (tags.error && event.error) {
      console.error('request error:', {
        id: request.info.id,
        method: request.method,
        path: request.path,
        error: formatError(event.error),
      });
    }
  });

  process.on('uncaughtException', (error) => {
    console.error('uncaught exception:', formatError(error));
  });

  process.on('unhandledRejection', (error) => {
    console.error('unhandled rejection:', formatError(error));
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: () => ({
      ok: true,
      route: '/large',
      profile: 'concurrency=1000 ramp-up=15m throughput=500',
    }),
  });

  server.route({
    method: 'GET',
    path: '/large',
    handler: (request, h) => {
      const chunks = Number(request.query.chunks || process.env.CHUNKS || 16);
      const delayMs = Number(request.query.delayMs || process.env.DELAY_MS || 400);
      const chunkSize = Number(request.query.chunkSize || process.env.CHUNK_SIZE || 16384);
      const stream = makeSlowStream({ chunks, delayMs, chunkSize });

      return h
        .response(stream)
        .type('application/octet-stream')
        .header('content-disposition', 'attachment; filename="large.bin"');
    },
  });

  await server.start();
  console.log(`hapi ${require('@hapi/hapi/package.json').version} listening on ${server.info.uri}`);
  console.log('Use the BlazeMeter profile in blazemeter.yml to apply concurrency=1000 ramp-up=15m throughput=500.');
};

init();
