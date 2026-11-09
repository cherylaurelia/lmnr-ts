import assert from "node:assert";
import { type AddressInfo, createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";

import { LaminarSpanExporter } from "../src/opentelemetry-lib/tracing/exporter";

const listen = (onConnect: () => void): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((socket) => {
      onConnect();
      socket.destroy();
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const portOf = (server: Server) => (server.address() as AddressInfo).port;

const exportOneSpan = async (exporter: LaminarSpanExporter) => {
  const span = new BasicTracerProvider().getTracer("test").startSpan("probe");
  span.end();
  await new Promise<void>((resolve) => {
    exporter.export([span as never], () => resolve());
  });
  await exporter.shutdown();
};

void describe("LaminarSpanExporter gRPC port", () => {
  const original = process.env.LMNR_GRPC_PORT;
  let servers: Server[] = [];

  beforeEach(() => {
    servers = [];
  });

  afterEach(() => {
    servers.forEach((server) => server.close());
    if (original === undefined) delete process.env.LMNR_GRPC_PORT;
    else process.env.LMNR_GRPC_PORT = original;
  });

  void it("connects to LMNR_GRPC_PORT when no port is configured", async () => {
    let hits = 0;
    const server = await listen(() => (hits += 1));
    servers.push(server);
    process.env.LMNR_GRPC_PORT = String(portOf(server));

    await exportOneSpan(
      new LaminarSpanExporter({
        baseUrl: "http://127.0.0.1",
        apiKey: "test",
        timeoutMillis: 800,
      }),
    );

    assert.ok(hits > 0);
  });

  void it("prefers a port in the base URL over LMNR_GRPC_PORT", async () => {
    let urlHits = 0;
    let envHits = 0;
    const fromUrl = await listen(() => (urlHits += 1));
    const fromEnv = await listen(() => (envHits += 1));
    servers.push(fromUrl, fromEnv);
    process.env.LMNR_GRPC_PORT = String(portOf(fromEnv));

    await exportOneSpan(
      new LaminarSpanExporter({
        baseUrl: `http://127.0.0.1:${portOf(fromUrl)}`,
        apiKey: "test",
        timeoutMillis: 800,
      }),
    );

    assert.ok(urlHits > 0);
    assert.strictEqual(envHits, 0);
  });
});
