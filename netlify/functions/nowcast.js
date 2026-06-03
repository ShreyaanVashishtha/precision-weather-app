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

  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${tomorrowKey}`;
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure,precipitation&hourly=temperature_2m,precipitation_probability`;
  const hkoUrl = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rwr&lang=en";

  try {
    // 1. Safe fetch wrappers to prevent any unhandled promise rejections
    const safeFetch = (fetchUrl) => fetch(fetchUrl).catch(err => ({ ok: false, error: err }));
    
    const fetchPromises = [
      safeFetch(tomorrowUrl),
      safeFetch(openMeteoUrl)
    ];
    if (isHongKong) fetchPromises.push(safeFetch(hkoUrl));

    const results = await Promise.all(fetchPromises);
    
    const tomorrowRes = results[0];
    const openMeteoRes = results[1];
    const hkoRes = isHongKong ? results[2] : null;

    // 2. Tomorrow.io MUST succeed as the foundation
    if (!tomorrowRes || !tomorrowRes.ok) {
      const statusText = tomorrowRes ? tomorrowRes.status : 'Network Timeout';
      return Response.json({ error: `Tomorrow.io baseline failed. Status: ${statusText}` }, { status: tomorrowRes ? tomorrowRes.status : 500 });
    }

    let blendedData;
    try {
      blendedData = await tomorrowRes.json();
    } catch (e) {
      return Response.json({ error: 'Tomorrow.io returned corrupted JSON.' }, { status: 500 });
    }

    // Tomorrow.io V4 structure points
    let currentMinutelyNode = blendedData.timelines?.minutely?.[0]?.values;
    let hourlyTimeline = blendedData.timelines?.hourly;

    // 3. Open-Meteo Blend (Isolated Sandbox)
    if (openMeteoRes && openMeteoRes.ok) {
      try {
        const omData = await openMeteoRes.json();
        if (currentMinutelyNode && omData.current) {
          currentMinutelyNode.temperature = (currentMinutelyNode.temperature * 0.5) + (omData.current.temperature_2m * 0.5);
          currentMinutelyNode.humidity = (currentMinutelyNode.humidity * 0.5) + (omData.current.relative_humidity_2m * 0.5);
          currentMinutelyNode.windSpeed = (currentMinutelyNode.windSpeed * 0.5) + (omData.current.wind_speed_10m * 0.5);
        }
        if (hourlyTimeline && omData.hourly && omData.hourly.temperature_2m) {
          for (let i = 0; i < Math.min(24, hourlyTimeline.length); i++) {
            if (omData.hourly.temperature_2m[i] !== undefined) {
               hourlyTimeline[i].values.temperature = (hourlyTimeline[i].values.temperature * 0.5) + (omData.hourly.temperature_2m[i] * 0.5);
            }
          }
        }
      } catch (e) {
        console.error("Open-Meteo blending skipped due to parse error.");
      }
    }

    // 4. HKO Blend (Isolated Sandbox)
    if (hkoRes && hkoRes.ok) {
      try {
        const hkoJson = await hkoRes.json();
        if (currentMinutelyNode) {
           const hkoTempNode = hkoJson.temperature?.data?.find(d => d.place === "Hong Kong Observatory") || hkoJson.temperature?.data?.[0];
           if (hkoTempNode && hkoTempNode.value !== undefined) {
             currentMinutelyNode.temperature = (currentMinutelyNode.temperature * 0.4) + (parseFloat(hkoTempNode.value) * 0.6);
           }
           
           const hkoHumidityNode = hkoJson.humidity?.data?.[0];
           if (hkoHumidityNode && hkoHumidityNode.value !== undefined) {
             currentMinutelyNode.humidity = (currentMinutelyNode.humidity * 0.4) + (parseFloat(hkoHumidityNode.value) * 0.6);
           }
        }
      } catch (e) {
         console.error("HKO blending skipped due to parse error.");
      }
    }

    // 5. Wrap the mutated data back into { data: ... } so the frontend UI seamlessly maps it
    return Response.json({ data: blendedData });

  } catch (error) {
    // Exact runtime exception returned to frontend for debugging
    return Response.json({ error: `Backend exception: ${error.message}` }, { status: 500 });
  }
};
