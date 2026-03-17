import type { FastifyRequest, FastifyReply } from "fastify";

export interface AuthPreHandlerContext {
  ingestToken: string;
}

export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  context: AuthPreHandlerContext
): Promise<void> {
  const query = request.query as { token?: string };
  const token =
    query.token ??
    (request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined);

  if (!token || token !== context.ingestToken) {
    await reply.status(401).send({ error: "Unauthorized" });
  }
}
