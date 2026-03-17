import type { FastifyRequest, FastifyReply } from "fastify";

export interface AuthPreHandlerContext {
  ingestToken: string;
}

export async function authPreHandler(
  request: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply,
  context: AuthPreHandlerContext
): Promise<void> {
  const token =
    request.query.token ??
    (request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined);

  if (!token || token !== context.ingestToken) {
    await reply.status(401).send({ error: "Unauthorized" });
  }
}
