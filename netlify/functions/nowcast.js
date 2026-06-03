export default async (request, context) => {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));

  if (isNaN(lat) || isNaN(lon)) return Response.json({ error: "Invalid geographic coordinates." }, { status: 400 });

  const tomorrowKey = process.env.TOMORROW_IO_KEY;
  const isHongKong = lat >= 22.15 && lat <= 22.60 && lon >= 113.80 && lon <= 114.40;

  // 1. Core Endpoints (Open-Meteo is the Unbreakable Foundation)
  const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m,wind_gusts_10m,visibility&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&wind_speed_unit=ms&timezone=auto`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5`;
  const tomorrowUrl = `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1m&apikey=${tomorrowKey}`;
  const hkoUrl = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rwr&lang=en";

  try {
    // 2. Safe Fetcher (Returns null instead of crashing on 429/500 errors)
    const safeFetch = async (fetchUrl) => {
      try { const res = await fetch(fetchUrl); return res.ok ? await res.json() : null; } 
      catch { return null; }
    };

    const [om, aqi, tomorrow, hko] = await Promise.all([
      safeFetch(omUrl),
      safeFetch(aqiUrl),
      tomorrowKey ? safeFetch(tomorrowUrl) : null,
      isHongKong ? safeFetch(hkoUrl) : null
    ]);

    // If Open-Meteo completely fails, the system is truly down
    if (!om) return Response.json({ error: "Core atmospheric network offline." }, { status: 500 });

    // 3. WMO Weather Code Translator
    const mapCode = (code) => {
      const map = {
        0: { text: "Clear Sky", icon: "sun" },
        1: { text: "Mostly Clear", icon: "sun" }, 2: { text: "Partly Cloudy", icon: "cloud-sun" }, 3: { text: "Overcast", icon: "cloud" },
        45: { text: "Fog", icon: "cloud-fog" }, 48: { text: "Freezing Fog", icon: "cloud-fog" },
        51: { text: "Light Drizzle", icon: "cloud-drizzle" }, 53: { text: "Drizzle", icon: "cloud-drizzle" }, 61: { text: "Light Rain", icon: "cloud-rain" }, 63: { text: "Moderate Rain", icon: "cloud-rain" }, 65: { text: "Heavy Rain", icon: "cloud-rain" },
        71: { text: "Light Snow", icon: "cloud-snow" }, 95: { text: "Thunderstorm", icon: "cloud-lightning" }, 99: { text: "Severe Storm", icon: "cloud-lightning" }
      };
      return map[code] || { text: "Cloudy", icon: "cloud" };
    };

    // 4. Construct Baseline Payload
    const currentWMO = mapCode(om.current.weather_code);
    let payload = {
      sources: ["Open-Meteo Global"],
      current: {
        temp: om.current.temperature_2m, feelsLike: om.current.apparent_temperature,
        high: om.daily.temperature_2m_max[0] || om.current.temperature_2m,
        low: om.daily.temperature_2m_min[0] || om.current.temperature_2m,
        condition: currentWMO.text, icon: currentWMO.icon,
        humidity: om.current.relative_humidity_2m,
        dewPoint: om.current.temperature_2m - ((100 - om.current.relative_humidity_2m) / 5),
        windSpeed: om.current.wind_speed_10m, windGust: om.current.wind_gusts_10m || 0,
        uvIndex: om.daily.uv_index_max[0] || 0,
        pressure: om.current.surface_pressure, pressureTrend: "Stable",
        visibility: Math.round((om.current.visibility || 10000) / 1000)
      },
      aqi: { index: 0, pm25: 0, label: "Good", color: "#4ADE80" },
      alerts: [],
      insights: [],
      minutely: [], // Will populate below
      hourly: om.hourly.time.map((t, i) => ({
        time: new Date(t).toLocaleTimeString([], { hour: 'numeric' }),
        temp: om.hourly.temperature_2m[i], precip: om.hourly.precipitation_probability[i] || 0,
        icon: mapCode(om.hourly.weather_code[i]).icon
      })),
      daily: om.daily.time.map((t, i) => ({
        date: new Date(t).toLocaleDateString([], { weekday: 'short' }),
        high: om.daily.temperature_2m_max[i], low: om.daily.temperature_2m_min[i],
        precip: om.daily.precipitation_probability_max[i] || 0, icon: mapCode(om.daily.weather_code[i]).icon
      }))
    };

    // 5. Apply Enhancers Safely
    if (aqi && aqi.current) {
      payload.sources.push("European AQI Core");
      const val = aqi.current.european_aqi;
      payload.aqi = {
        index: val, pm25: aqi.current.pm2_5,
        label: val <= 50 ? "Good" : val <= 100 ? "Moderate" : "Poor",
        color: val <= 50 ? "#4ADE80" : val <= 100 ? "#F59E0B" : "#EF4444"
      };
    }

    if (tomorrow && tomorrow.data && tomorrow.data.timelines) {
      payload.sources.push("Tomorrow.io Nowcast");
      const mData = tomorrow.data.timelines.minutely || [];
      payload.minutely = mData.slice(0, 60).map((m, i) => ({
        time: `+${i}m`,
        precip: m.values.rainIntensity || 0, temp: m.values.temperature,
        wind: m.values.windSpeed, humidity: m.values.humidity
      }));
    } else {
      // Fallback: If Tomorrow.io is 429 rate-limited, simulate flatline minutely data from OM current conditions so UI doesn't break
      for(let i=0; i<60; i++) {
        payload.minutely.push({ time: `+${i}m`, precip: 0, temp: payload.current.temp, wind: payload.current.windSpeed, humidity: payload.current.humidity });
      }
    }

    if (hko && hko.temperature && hko.temperature.data) {
      payload.sources.push("HKO Precision Sensor");
      const hkoTemp = hko.temperature.data.find(d => d.place === "Hong Kong Observatory") || hko.temperature.data[0];
      if (hkoTemp) payload.current.temp = (payload.current.temp * 0.4) + (parseFloat(hkoTemp.value) * 0.6);
    }

    // 6. Generate Intelligence Insights
    payload.current.uvLabel = payload.current.uvIndex > 7 ? "Very High" : payload.current.uvIndex > 3 ? "Moderate" : "Low";
    if (payload.current.uvIndex > 7) payload.insights.push(`UV exposure is dangerous (Index ${Math.round(payload.current.uvIndex)}). Protection is strictly required.`);
    if (payload.current.windGust > 15) payload.insights.push(`Caution: Strong wind gusts up to ${Math.round(payload.current.windGust)} m/s detected.`);
    const maxPop = Math.max(...payload.hourly.slice(0, 12).map(h => h.precip));
    if (maxPop > 60) payload.insights.push(`High probability of precipitation (${maxPop}%) expected in the coming hours.`);
    else payload.insights.push(`Atmospheric moisture levels suggest stable, dry conditions in the short term.`);

    return Response.json(payload);

  } catch (error) {
    return Response.json({ error: `Compute exception: ${error.message}` }, { status: 500 });
  }
};
