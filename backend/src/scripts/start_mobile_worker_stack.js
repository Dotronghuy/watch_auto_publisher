import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const backendRoot = path.resolve(import.meta.dirname, '..', '..');
const nodeExecutable = process.execPath;

const isListening = (port, host = '127.0.0.1') => new Promise((resolve) => {
  const socket = net.createConnection({ host, port });
  const finish = (result) => {
    socket.removeAllListeners();
    socket.destroy();
    resolve(result);
  };
  socket.setTimeout(600);
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.once('timeout', () => finish(false));
});

const spawnDetachedNode = (name, args) => {
  const stdoutPath = path.join(os.tmpdir(), `zenwatch-${name}.out.log`);
  const stderrPath = path.join(os.tmpdir(), `zenwatch-${name}.err.log`);
  const stdoutHandle = fs.openSync(stdoutPath, 'a');
  const stderrHandle = fs.openSync(stderrPath, 'a');
  const child = spawn(nodeExecutable, args, {
    cwd: backendRoot,
    detached: true,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', stdoutHandle, stderrHandle],
  });

  child.unref();
  fs.closeSync(stdoutHandle);
  fs.closeSync(stderrHandle);
  console.log(`${name} started (PID ${child.pid})`);
};

if (await isListening(Number(process.env.PORT || 3000))) {
  console.log('backend is already listening');
} else {
  spawnDetachedNode('mobile-worker-backend', ['--env-file=.env', 'src/app.js']);
}

if (await isListening(Number(process.env.MOBILE_WORKER_GATEWAY_PORT || 3100))) {
  console.log('mobile-worker-gateway is already listening');
} else {
  spawnDetachedNode('mobile-worker-gateway', ['--env-file=.env', 'src/mobileWorkerGateway.js']);
}
