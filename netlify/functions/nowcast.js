export default async (request, context) => {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  if (!lat || !lon) {
    return Response.json({ error: "Missing required location vectors." }, { status: 400 });
  }

  const apiKey = process.env.TOMORROW_IO_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server environment key layer configuration missing." }, { status: 500 });
  }

  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1m&apikey=${apiKey}`;

  try {
    const response = await fetch(tomorrowUrl);
    
    if (!response.ok) {
      return Response.json({ error: `Upstream forecast network fault code: ${response.status}` }, { status: response.status });
    }
    
    const data = await response.json();
    return Response.json({ data });
  } catch (error) {
    return Response.json({ error: 'Asynchronous internal runtime exception handler triggered.' }, { status: 500 });
  }
};
