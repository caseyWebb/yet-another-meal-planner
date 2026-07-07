// A styled NATIVE <select> (the design bundle's Basecoat `.select` look, mapped onto
// the shadcn input treatment). The mock's selects are native controls — the member
// pages keep that (no Radix listbox needed for P1's simple enumerations).
import * as React from "react";
import { cn } from "../lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input dark:bg-input/30 h-9 w-fit min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
