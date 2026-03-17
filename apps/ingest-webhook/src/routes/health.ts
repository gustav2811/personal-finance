import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/", async (_request, reply) => {
    return reply.send({ status: "ok" });
  });
}
