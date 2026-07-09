import { WeatherStrip } from "@yamp/ui";

export function WeekForecast() {
  return (
    <div style={{ maxWidth: 640 }}>
      <WeatherStrip
        days={[
          { date: "2024-09-02", high: 88, low: 72, condition: "Sunny", category: "grill" },
          { date: "2024-09-03", high: 91, low: 74, condition: "Hot", category: "grill" },
          { date: "2024-09-04", high: 75, low: 65, condition: "Rain", category: "wet" },
          { date: "2024-09-05", high: 60, low: 48, condition: "Cloudy", category: "cold-comfort" },
          { date: "2024-09-06", high: 72, low: 59, condition: "Clear", category: "mild" },
        ]}
      />
    </div>
  );
}
