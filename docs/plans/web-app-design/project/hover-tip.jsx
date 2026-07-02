/* Lightweight hover tooltip for sparkline bars. The design system's CSS
   [data-tooltip] bubble is single-line (nowrap) — fine for a short value, but
   run errors need to wrap and carry a title + body. This is one floating,
   fixed-positioned bubble (styled like the Basecoat tooltip) driven imperatively
   from bar mouse handlers, so hundreds of thin bars cost no per-bar React nodes.

   useTip() → { show(event, {title, body, variant}), hide(), Tip }
   Render {Tip} once at the end of a screen; wire show/hide onto each bar. */
function useTip() {
  const [tip, setTip] = React.useState(null);

  const show = (e, content) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(96, Math.min(window.innerWidth - 96, r.left + r.width / 2));
    setTip({ x, y: r.top, ...content });
  };
  const hide = () => setTip(null);

  const Tip = tip ? (
    <div className={"bar-tip" + (tip.variant ? " " + tip.variant : "")} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.title != null && <div className="bar-tip-title">{tip.title}</div>}
      {tip.body != null && <div className="bar-tip-body">{tip.body}</div>}
    </div>
  ) : null;

  return { show, hide, Tip };
}
window.GA = window.GA || {};
window.GA.useTip = useTip;
