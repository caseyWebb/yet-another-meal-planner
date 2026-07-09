import { WeatherNoLocation } from "@yamp/ui";

export function Default() {
  return (
    <div style={{ maxWidth: 480 }}>
      <WeatherNoLocation action={<a href="/profile">Open profile</a>} />
    </div>
  );
}
