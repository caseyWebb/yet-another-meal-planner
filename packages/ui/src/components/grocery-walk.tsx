import * as React from "react";
import type { GroceryLine, GroceryListData, OfflineWalkContext, ShopReceipt } from "@yamp/contract";
import { projectGroceryWalk } from "../grocery-controller";
import { Button } from "./button";
import { Progress } from "./progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export function GroceryWalk({ data, context, online, pendingCommit, receipt, conflict, onCheck, onPause, onFinish, onRetry }: {
  data: GroceryListData; context: OfflineWalkContext; online: boolean; pendingCommit: boolean; receipt: ShopReceipt | null; conflict: string | null;
  onCheck(line: GroceryLine, checked: boolean): void; onPause(): void; onFinish(keys: string[]): void;
  onRetry?(): void;
}) {
  const projection = projectGroceryWalk(data, context);
  const [review, setReview] = React.useState(false);
  const [opened, setOpened] = React.useState<string[]>([]);
  const checkedKeys = projection.groups.flatMap((group) => group.lines).filter((line) => line.checked_at != null).map((line) => line.key).sort();
  if (receipt) return <section className="walk-receipt" data-testid="walk-receipt"><h1>Shop complete</h1><p>{receipt.totals.items} items received{receipt.totals.priced ? ` · estimated $${receipt.totals.amount.toFixed(2)}` : " · prices unavailable"}</p><p className="muted">Receipt {receipt.session_id}</p></section>;
  return <section className="grocery-walk" data-testid="grocery-walk">
    <header className="walk-head"><div><p className="eyebrow">Store walk</p><h1>{context.display_name}</h1><p>{projection.checked} of {projection.total} picked</p></div><Progress value={projection.total ? projection.checked / projection.total * 100 : 0} aria-label="Shopping progress" /></header>
    {!online ? <p className="muted" role="status">Offline — changes will sync</p> : null}
    {context.aisle_map.state === "stale" ? <p role="note">Map may be out of date.</p> : null}
    {conflict ? <p role="alert">{conflict}</p> : null}
    {pendingCommit ? <div className="walk-pending" role="status"><p>Finishing when online. Checked items stay visible until the receipt arrives.</p>{onRetry ? <Button size="sm" onClick={onRetry}>Retry finish</Button> : null}</div> : null}
    <div className="walk-groups">{projection.groups.map((group) => {
      const open = !group.complete || group.id === projection.current_group || opened.includes(group.id);
      return <section key={group.id} className={group.id === projection.current_group ? "walk-group active" : "walk-group"} data-testid="walk-group" data-group={group.id}>
        <button type="button" className="walk-group-title" aria-expanded={open} onClick={() => setOpened((cur) => cur.includes(group.id) ? cur.filter((id) => id !== group.id) : [...cur, group.id])}><span>{group.label}</span><small>{group.lines.filter((line) => line.checked_at != null).length}/{group.lines.length}</small></button>
        {group.warning ? <p className="muted">Map may be out of date</p> : null}
        {open ? <ul>{group.lines.map((line) => <li key={line.key}><label className={line.checked_at ? "checked" : undefined}><input type="checkbox" checked={line.checked_at != null} disabled={pendingCommit} onChange={(event) => onCheck(line, event.target.checked)} /><span>{line.display_name ?? line.name}</span><small>{line.quantity}</small></label></li>)}</ul> : <p className="muted">{group.lines.map((line) => line.display_name ?? line.name).join(", ")}</p>}
      </section>;
    })}</div>
    <footer className="walk-footer"><Button variant="outline" onClick={onPause} disabled={pendingCommit}>Pause</Button><Button onClick={() => setReview(true)} disabled={!checkedKeys.length || pendingCommit}>Finish</Button></footer>
    <Dialog open={review} onOpenChange={setReview}><DialogContent><DialogHeader><DialogTitle>Finish this shop?</DialogTitle><DialogDescription>{checkedKeys.length} of {projection.total} items will be received. Unchecked items stay on the list. Grocery items refresh pantry verification; spend is an estimate, not a checkout receipt.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setReview(false)}>Keep shopping</Button><Button onClick={() => { setReview(false); onFinish(checkedKeys); }}>Finish {online ? "shop" : "when online"}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
