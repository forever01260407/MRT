export function getRequestSourceIp(request: Request) {
  const forwardedAddress = request.headers.get("X-Forwarded-For")?.split(",", 1)[0]?.trim();
  return request.headers.get("CF-Connecting-IP")?.trim()
    || forwardedAddress
    || "本機";
}

export function getRequestAuditContext(request: Request) {
  return {
    sourceIp: getRequestSourceIp(request),
    userAgent: request.headers.get("User-Agent")?.trim() || null,
    requestId: request.headers.get("CF-Ray")?.trim() || crypto.randomUUID(),
  };
}
