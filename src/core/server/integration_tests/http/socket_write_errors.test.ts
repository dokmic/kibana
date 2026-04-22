/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ChildProcessWithoutNullStreams, ExecFileSyncOptions } from 'child_process';
import { execFileSync, spawn } from 'child_process';
import { request as httpRequest, type Server } from 'http';
import moment from 'moment';
import { of } from 'rxjs';
import { Readable } from 'stream';
import { ByteSizeValue } from '@kbn/config-schema';
import { mockCoreContext } from '@kbn/core-base-server-mocks';
import type { HttpConfig } from '@kbn/core-http-server-internal';
import { HttpServer } from '@kbn/core-http-server-internal';
import { Router } from '@kbn/core-http-router-server-internal';
import type { Logger } from '@kbn/logging';
import { createTestEnv, getEnvOptions } from '@kbn/config-mocks';

const envOptions = getEnvOptions();
envOptions.cliArgs.dev = false;
const env = createTestEnv({ envOptions });

const delay = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const runSudo = (args: string[], execOptions: ExecFileSyncOptions = {}) => {
  const output = execFileSync('sudo', ['-n', ...args], {
    encoding: 'utf8',
    ...execOptions,
  });

  return typeof output === 'string' ? output.trim() : '';
};

const runSudoIgnoringError = (args: string[], execOptions: ExecFileSyncOptions = {}) => {
  try {
    runSudo(args, execOptions);
  } catch {
    // Best-effort cleanup.
  }
};

const hasIptablesNetworkNamespaceSupport = () => {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    runSudo(['true'], { stdio: 'ignore' });
    runSudo(['iptables', '--version'], { stdio: 'ignore' });
    runSudo(['ip', 'netns', 'list'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const describeIfIptablesSupported = hasIptablesNetworkNamespaceSupport() ? describe : describe.skip;

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
};

interface NetworkNamespaceHarness {
  readonly name: string;
  readonly hostIp: string;
  readonly clientIp: string;
  runInNamespace: (...args: string[]) => string;
  killNamespaceProcesses: () => void;
  cleanup: () => void;
}

const createNetworkNamespaceHarness = (): NetworkNamespaceHarness => {
  const id = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .slice(0, 5);
  const namespaceIndex = 20 + Math.floor(Math.random() * 200);
  const name = `http-write-${id}`;
  const hostInterface = `vh${id}`;
  const clientInterface = `vc${id}`;
  const hostIp = `10.200.${namespaceIndex}.1`;
  const clientIp = `10.200.${namespaceIndex}.2`;

  runSudo(['ip', 'netns', 'add', name], { stdio: 'ignore' });
  runSudo(['ip', 'link', 'add', hostInterface, 'type', 'veth', 'peer', 'name', clientInterface], {
    stdio: 'ignore',
  });
  runSudo(['ip', 'link', 'set', clientInterface, 'netns', name], { stdio: 'ignore' });
  runSudo(['ip', 'addr', 'add', `${hostIp}/24`, 'dev', hostInterface], { stdio: 'ignore' });
  runSudo(['ip', 'link', 'set', hostInterface, 'up'], { stdio: 'ignore' });
  runSudo(
    ['ip', 'netns', 'exec', name, 'ip', 'addr', 'add', `${clientIp}/24`, 'dev', clientInterface],
    {
      stdio: 'ignore',
    }
  );
  runSudo(['ip', 'netns', 'exec', name, 'ip', 'link', 'set', 'lo', 'up'], { stdio: 'ignore' });
  runSudo(['ip', 'netns', 'exec', name, 'ip', 'link', 'set', clientInterface, 'up'], {
    stdio: 'ignore',
  });

  const killNamespaceProcesses = () => {
    const pids = runSudo(['ip', 'netns', 'pids', name], { stdio: 'pipe' });
    if (pids.length === 0) {
      return;
    }

    runSudo(['kill', '-9', ...pids.split(/\s+/)], { stdio: 'ignore' });
  };

  const cleanup = () => {
    killNamespaceProcesses();
    runSudoIgnoringError(['ip', 'netns', 'del', name], { stdio: 'ignore' });
    runSudoIgnoringError(['ip', 'link', 'del', hostInterface], { stdio: 'ignore' });
  };

  return {
    name,
    hostIp,
    clientIp,
    runInNamespace: (...args: string[]) => runSudo(['ip', 'netns', 'exec', name, ...args]),
    killNamespaceProcesses,
    cleanup,
  };
};

const spawnNamespaceClient = ({
  namespace,
  hostIp,
  port,
  request,
}: {
  namespace: string;
  hostIp: string;
  port: number;
  request: string;
}): {
  child: ChildProcessWithoutNullStreams;
  localPort: Promise<number>;
} => {
  const localPortDeferred = createDeferred<number>();
  const childCode = `
    const net = require('net');
    const socket = net.connect(
      { host: ${JSON.stringify(hostIp)}, port: ${port} },
      () => {
        socket.write(${JSON.stringify(request)}, () => {
          console.log(\`LOCAL_PORT:\${socket.localPort}\`);
        });
      }
    );

    setInterval(() => {}, 1000);
  `;

  const child = spawn(
    'sudo',
    ['-n', 'ip', 'netns', 'exec', namespace, process.execPath, '-e', childCode],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const match = stdoutBuffer.match(/LOCAL_PORT:(\d+)/);
    if (match) {
      localPortDeferred.resolve(Number(match[1]));
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
  });

  child.once('exit', (code, signal) => {
    localPortDeferred.reject(
      new Error(
        `Namespace client exited before reporting a port (code=${String(code)}, signal=${String(
          signal
        )}). Output: ${stdoutBuffer}`
      )
    );
  });

  return { child, localPort: localPortDeferred.promise };
};

const getListenerPort = (listener: Server): number => {
  const address = listener.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Expected HTTP server listener to expose an address object');
  }

  return address.port;
};

const requestText = async ({ host, port, path }: { host: string; port: number; path: string }) => {
  return await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host,
        port,
        path,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body,
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
};

describeIfIptablesSupported('Http server socket write errors', () => {
  jest.setTimeout(30_000);

  let server: HttpServer;
  let config: HttpConfig;
  let logger: Logger;
  let coreContext: ReturnType<typeof mockCoreContext.create>;

  const enhanceWithContext = (fn: (...args: any[]) => any) => fn.bind(null, {});

  beforeEach(() => {
    coreContext = mockCoreContext.create();
    logger = coreContext.logger.get();

    config = {
      name: 'kibana',
      host: '127.0.0.1',
      maxPayload: new ByteSizeValue(1024),
      port: 0,
      ssl: { enabled: false },
      compression: { enabled: false, brotli: { enabled: false } },
      requestId: {
        allowFromAnyIp: true,
        ipAllowlist: [],
      },
      cdn: {},
      cors: {
        enabled: false,
      },
      shutdownTimeout: moment.duration(5, 's'),
      restrictInternalApis: false,
    } as any;

    server = new HttpServer(coreContext, 'tests', of(config.shutdownTimeout));
  });

  afterEach(async () => {
    await server.stop();
  });

  it('does not surface an uncaught exception when a delayed response hits a reset namespace client', async () => {
    const namespace = createNetworkNamespaceHarness();
    const requestStarted = createDeferred<void>();
    let listener: Server | undefined;
    let dropRuleArgs: string[] | undefined;
    let uncaughtError: Error | undefined;
    let uncaughtMonitorError: Error | undefined;
    const onUncaughtException = (error: Error) => {
      uncaughtError = error;
    };
    const onUncaughtExceptionMonitor = (error: Error) => {
      uncaughtMonitorError = error;
    };

    process.prependOnceListener('uncaughtException', onUncaughtException);
    process.prependOnceListener('uncaughtExceptionMonitor', onUncaughtExceptionMonitor);

    try {
      config = {
        ...config,
        host: namespace.hostIp,
      };

      const { registerRouter, server: innerServer } = await server.setup({ config$: of(config) });
      listener = innerServer.listener;

      const router = new Router('', logger, enhanceWithContext, {
        env,
        versionedRouterOptions: {
          defaultHandlerResolutionStrategy: 'oldest',
        },
      });

      router.get(
        {
          path: '/fault',
          security: { authz: { enabled: false, reason: '' } },
          validate: false,
        },
        async (_context, _req, res) => {
          const stream = new Readable({
            read() {},
          });

          requestStarted.resolve();

          setTimeout(() => {
            stream.push(Buffer.alloc(1024 * 1024));
            stream.push(Buffer.alloc(1024 * 1024));
            stream.push(Buffer.alloc(1024 * 1024));
            stream.push(null);
          }, 500);

          return res.ok({ body: stream });
        }
      );

      router.get(
        {
          path: '/health',
          security: { authz: { enabled: false, reason: '' } },
          validate: false,
        },
        (_context, _req, res) => {
          return res.ok({ body: 'ok' });
        }
      );

      registerRouter(router);

      await server.start();

      const port = getListenerPort(listener);
      const { localPort } = spawnNamespaceClient({
        namespace: namespace.name,
        hostIp: namespace.hostIp,
        port,
        request: 'GET /fault HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
      });

      const clientPort = await localPort;
      await requestStarted.promise;

      dropRuleArgs = [
        'iptables',
        '-I',
        'OUTPUT',
        '-p',
        'tcp',
        '-s',
        namespace.clientIp,
        '--sport',
        String(clientPort),
        '-d',
        namespace.hostIp,
        '--dport',
        String(port),
        '-j',
        'DROP',
      ];

      namespace.runInNamespace(...dropRuleArgs);
      namespace.killNamespaceProcesses();
      await delay(200);

      namespace.runInNamespace(
        'iptables',
        '-D',
        'OUTPUT',
        '-p',
        'tcp',
        '-s',
        namespace.clientIp,
        '--sport',
        String(clientPort),
        '-d',
        namespace.hostIp,
        '--dport',
        String(port),
        '-j',
        'DROP'
      );
      dropRuleArgs = undefined;

      await delay(1000);

      expect(uncaughtError).toBeUndefined();
      expect(uncaughtMonitorError).toBeUndefined();

      const healthResponse = await requestText({
        host: namespace.hostIp,
        port,
        path: '/health',
      });

      expect(healthResponse).toEqual({
        statusCode: 200,
        body: 'ok',
      });
    } finally {
      process.removeListener('uncaughtException', onUncaughtException);
      process.removeListener('uncaughtExceptionMonitor', onUncaughtExceptionMonitor);

      if (dropRuleArgs) {
        const deleteRuleArgs = [...dropRuleArgs];
        deleteRuleArgs[1] = '-D';
        runSudoIgnoringError(['ip', 'netns', 'exec', namespace.name, ...deleteRuleArgs], {
          stdio: 'ignore',
        });
      }

      runSudoIgnoringError(['ip', 'netns', 'pids', namespace.name], { stdio: 'ignore' });
      namespace.cleanup();
    }
  });
});
