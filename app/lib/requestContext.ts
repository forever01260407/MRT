export function getRequestSourceIp(request: Request) {
  const forwardedAddress = request.headers.get("X-Forwarded-For")?.split(",", 1)[0]?.trim();
  return request.headers.get("CF-Connecting-IP")?.trim()
    || forwardedAddress
    || "本機";
}
