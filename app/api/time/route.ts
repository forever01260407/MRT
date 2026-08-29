export async function GET() {
  const now = new Date();
  return Response.json(
    {
      now: now.toISOString(),
      timeZone: "Asia/Taipei",
      utcOffset: "+08:00",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
