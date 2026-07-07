// The member app's toast (member-app-core 6.1): the design bundle's bottom-right
// transient message, as a module-level emitter + a <Toaster/> host the shell mounts
// once. `toast("Added to meal plan")` from anywhere; auto-dismisses like the mock.
import * as React from "react";

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

/** Show a transient toast (no-op until a <Toaster/> is mounted). */
export function toast(msg: string): void {
  for (const l of listeners) l(msg);
}

interface Entry {
  id: number;
  msg: string;
  leaving: boolean;
}

export function Toaster() {
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const nextId = React.useRef(1);

  React.useEffect(() => {
    const onToast = (msg: string) => {
      const id = nextId.current++;
      setEntries((es) => [...es, { id, msg, leaving: false }]);
      // Mirror the mock's timings: 2.2s visible, 200ms exit transition.
      setTimeout(() => setEntries((es) => es.map((e) => (e.id === id ? { ...e, leaving: true } : e))), 2200);
      setTimeout(() => setEntries((es) => es.filter((e) => e.id !== id)), 2400);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <div className="toaster" data-testid="toaster">
      {entries.map((e) => (
        <ToastEntry key={e.id} entry={e} />
      ))}
    </div>
  );
}

function ToastEntry({ entry }: { entry: Entry }) {
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`toast-content${entered && !entry.leaving ? " in" : ""}`} role="status">
      <span>{entry.msg}</span>
    </div>
  );
}
