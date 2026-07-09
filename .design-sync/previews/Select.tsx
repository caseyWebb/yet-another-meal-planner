import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@yamp/ui";

export function Open() {
  return (
    <Select defaultValue="kroger" defaultOpen>
      <SelectTrigger>
        <SelectValue placeholder="Pick a store" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Nearby stores</SelectLabel>
          <SelectItem value="kroger">Kroger — Downtown</SelectItem>
          <SelectItem value="whole-foods">Whole Foods Market</SelectItem>
          <SelectItem value="trader-joes">Trader Joe's</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="other">Other store…</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function Closed() {
  return (
    <Select defaultValue="salmon">
      <SelectTrigger>
        <SelectValue placeholder="Pick a protein" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="chicken">Chicken</SelectItem>
        <SelectItem value="beef">Beef</SelectItem>
        <SelectItem value="salmon">Salmon</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function Disabled() {
  return (
    <Select defaultValue="mediterranean" disabled>
      <SelectTrigger>
        <SelectValue placeholder="Pick a cuisine" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mediterranean">Mediterranean</SelectItem>
      </SelectContent>
    </Select>
  );
}
