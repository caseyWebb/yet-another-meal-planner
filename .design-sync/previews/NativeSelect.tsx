import { NativeSelect } from "@yamp/ui";

export function Default() {
  return (
    <NativeSelect defaultValue="salmon">
      <option value="chicken">Chicken</option>
      <option value="beef">Beef</option>
      <option value="salmon">Salmon</option>
      <option value="tofu">Tofu</option>
    </NativeSelect>
  );
}

export function Placeholder() {
  return (
    <NativeSelect defaultValue="">
      <option value="">All cuisines</option>
      <option value="italian">Italian</option>
      <option value="mediterranean">Mediterranean</option>
      <option value="asian">Asian</option>
    </NativeSelect>
  );
}

export function Disabled() {
  return (
    <NativeSelect defaultValue="kroger" disabled>
      <option value="kroger">Kroger</option>
      <option value="whole-foods">Whole Foods</option>
    </NativeSelect>
  );
}
