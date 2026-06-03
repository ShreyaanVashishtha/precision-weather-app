export default async (request, context) => {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));

  if (isNaN(lat) || isNaN(lon)) return Response.json({ error: "Invalid vectors" }, { status: 400 });

  // Core API Endpoints
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&timezone=auto`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5`;

  try {
    const safeFetch = (url) => fetch(url).catch(err => ({ ok: false }));
    const [omRes, aqiRes] = await Promise.all([safeFetch(omUrl), safeFetch(aqiUrl)]);

    if (!omRes.ok) return Response.json({ error: "Core atmospheric network offline." }, { status: 500 });
    
    const weather = await omRes.json();
    const aqiData = aqiRes.ok ? await aqiRes.json() : null;

    // Helper: Weather Code Translator
    const mapCode = (code) => {
      const map = {
        0: { text: "Clear Sky", icon: "sun" },
        1: { text: "Mostly Clear", icon: "sun" },
        2: { text: "Partly Cloudy", icon: "cloud-sun" },
        3: { text: "Overcast", icon: "cloud" },
        45: { text: "Fog", icon: "cloud-fog" },
        48: { text: "Freezing Fog", icon: "cloud-fog" },
        51: { text: "Light Drizzle", icon: "cloud-drizzle" },
        53: { text: "Drizzle", icon: "cloud-drizzle" },
        55: { text: "Heavy Drizzle", icon: "cloud-drizzle" },
        61: { text: "Light Rain", icon: "cloud-rain" },
        63: { text: "Moderate Rain", icon: "cloud-rain" },
        65: { text: "Heavy Rain", icon: "cloud-rain" },
        71: { text: "Light Snow", icon: "cloud-snow" },
        73: { text: "Moderate Snow", icon: "cloud-snow" },
        75: { text: "Heavy Snow", icon: "cloud-snow" },
        95: { text: "Thunderstorm", icon: "cloud-lightning" },
        99: { text: "Severe Storm", icon: "cloud-lightning" }
      };
      return map[code] || { text: "Unknown", icon: "cloud" };
    };

    const currentWMO = mapCode(weather.current.weather_code);
    
    // Compile AI Intelligence Insights
    let insights = [];
    const maxT = weather.daily.temperature_2m_max[0];
    const maxUV = weather.daily.uv_index_max[0];
    const maxPop = Math.max(...weather.hourly.precipitation_probability.slice(0, 12));
    
    insights.push(`Temperatures will peak near ${Math.round(maxT)}°C today.`);
    if(maxPop > 60) insights.push(`High probability of precipitation (${maxPop}%) expected in the coming hours.`);
    else insights.push(`No significant precipitation expected in the short term.`);
    if(maxUV > 7) insights.push(`UV exposure is dangerous (Index ${Math.round(maxUV)}). Sun protection is strictly required.`);
    if(weather.current.wind_gusts_10m > 15) insights.push(`Caution: Strong wind gusts up to ${Math.round(weather.current.wind_gusts_10m)} m/s detected.`);

    // Map AQI Logic
    let aqi = { index: 0, pm25: 0, label: "Unknown", color: "#938F99" };
    if (aqiData && aqiData.current) {
      const val = aqiData.current.european_aqi;
      aqi = {
        index: val,
        pm25: aqiData.current.pm2_5,
        label: val <= 50 ? "Good" : val <= 100 ? "Moderate" : "Poor",
        color: val <= 50 ? "#4ADE80" : val <= 100 ? "#F59E0B" : "#EF4444"
      };
      if (val > 100) insights.push("Air quality is severely reduced. Sensitive groups should remain indoors.");
    }

    // Format final JSON Contract for the Dashboard
    const responsePayload = {
      current: {
        temp: weather.current.temperature_2m,
        feelsLike: weather.current.apparent_temperature,
        high: weather.daily.temperature_2m_max[0],
        low: weather.daily.temperature_2m_min[0],
        condition: currentWMO.text,
        icon: currentWMO.icon,
        humidity: weather.current.relative_humidity_2m,
        dewPoint: weather.current.temperature_2m - ((100 - weather.current.relative_humidity_2m) / 5),
        windSpeed: weather.current.wind_speed_10m,
        windGust: weather.current.wind_gusts_10m,
        uvIndex: Math.round(maxUV),
        uvLabel: maxUV > 7 ? "Very High" : maxUV > 3 ? "Moderate" : "Low",
        pressure: weather.current.surface_pressure,
        pressureTrend: "Stable",
        visibility: Math.round(weather.current.visibility / 1000)
      },
      aqi: aqi,
      alerts: maxPop > 80 && weather.current.wind_gusts_10m > 20 ? [{
        title: "Severe Weather Warning",
        description: "Heavy rain and strong wind gusts detected in the local atmospheric sector.",
        color: "#F59E0B"
      }] : [],
      insights: insights,
      hourly: weather.hourly.time.map((t, i) => ({
        time: new Date(t).toLocaleTimeString([], { hour: 'numeric' }),
        temp: weather.hourly.temperature_2m[i],
        precip: weather.hourly.precipitation_probability[i],
        icon: mapCode(weather.hourly.weather_code[i]).icon
      })),
      daily: weather.daily.time.map((t, i) => ({
        date: new Date(t).toLocaleDateString([], { weekday: 'short' }),
        high: weather.daily.temperature_2m_max[i],
        low: weather.daily.temperature_2m_min[i],
        precip: weather.daily.precipitation_probability_max[i],
        icon: mapCode(weather.daily.weather_code[i]).icon
      }))
    };

    return Response.json(responsePayload);

  } catch (error) {
    return Response.json({ error: `Backend compute exception: ${error.message}` }, { status: 500 });
  }
};
