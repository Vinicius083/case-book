import net from 'node:net';

/**
 * Proxy TCP que dá para derrubar e religar na mesma porta: simula a queda do
 * Redis para um cliente sem parar o Redis de verdade, que os outros testes em
 * paralelo continuam usando.
 */
export class TcpProxy {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  port = 0;

  constructor(private readonly target: { host: string; port: number }) {}

  async start(): Promise<number> {
    const server = net.createServer((client) => {
      const upstream = net.connect(this.target);
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => server.listen(this.port, '127.0.0.1', resolve));
    this.port = (server.address() as net.AddressInfo).port;
    this.server = server;
    return this.port;
  }

  /** Fecha o listener e corta as conexões abertas (o cliente vê a conexão cair). */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server)
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
  }
}
