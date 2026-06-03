export default async (request, context) => {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));

  if (isNaN(lat) || isNaN(lon)) {
    return Response.json({ error: "Missing or invalid location vectors." }, { status: 400 });
  }

  const tomorrowKey = process.env.TOMORROW_IO_KEY;
  if (!tomorrowKey) {
    return Response.json({ error: "Server environment key layer missing." }, { status: 500 });
  }

  const isHongKong = lat >= 22.15 && lat <= 22.60 && lon >= 113.80 && lon <= 114.40;

  // Formulate Requests
  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${tomorrowKey}`;
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,precipitation&hourly=temperature_2m,precipitation_probability`;
  const hkoUrl = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rwr&lang=en";

  try {
    const fetchPromises = [
      fetch(tomorrowUrl),
      fetch(openMeteoUrl)
    ];
    if (isHongKong) fetchPromises.push(fetch(hkoUrl));

    // allSettled ensures a single API failure doesn't crash the whole dashboard
    const results = await Promise.allSettled(fetchPromises);
    
    const tomorrowRes = results[0].status === 'fulfilled' ? results[0].value : null;
    const openMeteoRes = results[1].status === 'fulfilled' ? results[1].value : null;
    const hkoRes = isHongKong && results[2] && results[2].status === 'fulfilled' ? results[2].value : null;

    // We must have Tomorrow.io as the baseline structure. If it fails (e.g. Rate Limit 429), pass error to frontend
    if (!tomorrowRes || !tomorrowRes.ok) {
      const statusText = tomorrowRes ? tomorrowRes.status : 'Network Failure';
      return Response.json({ error: `Tomorrow.io rejected request. Status: ${statusText}` }, { status: tomorrowRes ? tomorrowRes.status : 500 });
    }

    let blendedData = await tomorrowRes.json();
    let currentMinutelyNode = blendedData.data?.timelines?.minutely?.[0]?.values;
    let hourlyTimeline = blendedData.data?.timelines?.hourly;

    // Blend Open-Meteo (50% Weight)
    if (openMeteoRes && openMeteoRes.ok) {
      const omData = await openMeteoRes.json();
      if (currentMinutelyNode && omData.current) {
        currentMinutelyNode.temperature = (currentMinutelyNode.temperature * 0.5) + (omData.current.temperature_2m * 0.5);
        currentMinutelyNode.humidity = (currentMinutelyNode.humidity * 0.5) + (omData.current.relative_humidity_2m * 0.5);
        currentMinutelyNode.windSpeed = (currentMinutelyNode.windSpeed * 0.5) + (omData.current.wind_speed_10m * 0.5);
      }
      
      // Blend 24-Hour Trends
      if (hourlyTimeline && omData.hourly) {
        for (let i = 0; i < Math.min(24, hourlyTimeline.length); i++) {
          if (omData.hourly.temperature_2m[i] !== undefined) {
             hourlyTimeline[i].values.temperature = (hourlyTimeline[i].values.temperature * 0.5) + (omData.hourly.temperature_2m[i] * 0.5);
          }
        }
      }
    }

    // Over-Blend HKO Ground Truth (Dominant Weight 60%) if applicable
    if (hkoRes && hkoRes.ok) {
      const hkoJson = await hkoRes.json();
      if (currentMinutelyNode) {
         const hkoTempNode = hkoJson.temperature?.data?.find(d => d.place === "Hong Kong Observatory") || hkoJson.temperature?.data?.[0];
         if (hkoTempNode) {
           currentMinutelyNode.temperature = (currentMinutelyNode.temperature * 0.4) + (parseFloat(hkoTempNode.value) * 0.6);
         }
         
         const hkoHumidityNode = hkoJson.humidity?.data?.[0];
         if (hkoHumidityNode) {
           currentMinutelyNode.humidity = (currentMinutelyNode.humidity * 0.4) + (parseFloat(hkoHumidityNode.value) * 0.6);
         }
      }
    }

    return Response.json(blendedData);

  } catch (error) {
    return Response.json({ error: 'Critical failure parsing backend consensus network.' }, { status: 500 });
  }
};
