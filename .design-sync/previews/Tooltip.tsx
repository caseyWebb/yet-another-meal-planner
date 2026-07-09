import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Button,
  IconAlert,
} from "@yamp/ui";

export function WeatherAware() {
  return (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Why this pick">
          <IconAlert />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Swapped to a cold-comfort stew — rain and a high of 60°F on Thursday.
      </TooltipContent>
    </Tooltip>
  );
}
