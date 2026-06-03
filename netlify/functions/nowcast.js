export default async (request, context) => {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  // Validate presence of coordinate vectors
  if (!lat || !lon) {
    return Response.json({ error: "Missing tracking coordinate inputs." }, { status: 400 });
  }

  const apiKey = process.env.TOMORROW_IO_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server structural API authentication variable missing." }, { status: 500 });
  }

  // Requests structural 1-minute tracking arrays spanning the 1-hour window
  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1m&apikey=${apiKey}`;

  try {
    const response = await fetch(tomorrowUrl);
    
    if (!response.ok) {
      return Response.json({ error: `Upstream weather engine returned error status: ${response.status}` }, { status: response.status });
    }
    
    const data = await response.json();
    return Response.json({ data });
  } catch (error) {
    return Response.json({ error: 'Asynchronous fetch process broken on network runtime.' }, { status: 500 });
  }
};
