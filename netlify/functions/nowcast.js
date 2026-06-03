export default async (request, context) => {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));

  if (isNaN(lat) || !isNaN(lon) === false) {
    return Response.json({ error: "Missing or invalid location vectors." }, { status: 400 });
  }

  const tomorrowKey = process.env.TOMORROW_IO_KEY;
  if (!tomorrowKey) {
    return Response.json({ error: "Server environment key layer configuration missing." }, { status: 500 });
  }

  // Define Hong Kong territory bounding box boundaries
  const isHongKong = lat >= 22.15 && lat <= 22.60 && lon >= 113.80 && lon <= 114.40;

  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${tomorrowKey}`;
  const hkoUrl = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rwr&lang=en";

  try {
    // If inside Hong Kong, fetch both streams simultaneously to avoid latency stacking
    if (isHongKong) {
      const [tomorrowRes, hkoRes] = await Promise.all([
        fetch(tomorrowUrl),
        fetch(hkoUrl).catch(() => null) // Graceful degradation if HKO goes down
      ]);

      if (!tomorrowRes.ok) {
        return Response.json({ error: `Upstream Tomorrow.io fault code: ${tomorrowRes.status}` }, { status: tomorrowRes.status });
      }

      const tomorrowJson = await tomorrowRes.json();
      let blendedData = JSON.parse(JSON.stringify(tomorrowJson)); // Deep clone baseline

      if (hkoRes && hkoRes.ok) {
        const hkoJson = await hkoRes.json();
        
        // Extract baseline metrics from HKO weather report payload
        let hkoTemp = null;
        let hkoHumidity = null;

        if (hkoJson.temperature && hkoJson.temperature.data) {
          // Fallback parsing strategy: seek a principal tracking node like King's Park or HK Observatory
          const station = hkoJson.temperature.data.find(d => d.place === "Hong Kong Observatory") || hkoJson.temperature.data[0];
          if (station) hkoTemp = parseFloat(station.value);
        }
        
        if (hkoJson.humidity && hkoJson.humidity.data && hkoJson.humidity.data[0]) {
          hkoHumidity = parseFloat(hkoJson.humidity.data[0].value);
        }

        // Apply consensus blending logic to the current minute observation framework (Index 0)
        if (blendedData.data && blendedData.data.timelines && blendedData.data.timelines.minutely) {
          const targetNode = blendedData.data.timelines.minutely[0].values;

          // Blend rule: 60% HKO ground truth weight / 40% Tomorrow.io predictive calculation
          if (hkoTemp !== null) {
            targetNode.temperature = (hkoTemp * 0.6) + (targetNode.temperature * 0.4);
          }
          if (hkoHumidity !== null) {
            targetNode.humidity = (hkoHumidity * 0.6) + (targetNode.humidity * 0.4);
          }
        }
      }

      return Response.json(blendedData);
    } else {
      // Standard out-of-region flow: Tomorrow.io baseline only
      const response = await fetch(tomorrowUrl);
      if (!response.ok) {
        return Response.json({ error: `Upstream network fault code: ${response.status}` }, { status: response.status });
      }
      const data = await response.json();
      return Response.json(data);
    }

  } catch (error) {
    return Response.json({ error: 'Asynchronous internal consensus engine exception triggered.' }, { status: 500 });
  }
};
