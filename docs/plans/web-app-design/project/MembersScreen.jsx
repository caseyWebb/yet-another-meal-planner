/* Members area — the friend-group roster. Each member connected their Claude.ai
   to the grocery agent; some linked a Kroger account. Redesigned for Basecoat:
   summary tiles, a list of members (Avatar · name · handle · activity, with a
   per-member actions menu), and the invite flow (mint an invite code, shown
   once). Reads the shared GA.members roster. */
function MembersScreen({ onDetailChange }) {
  const { Button, Dialog, Field, Input, Badge, Avatar, Item, ItemGroup, DropdownMenu } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const rel = window.GA.membersMeta.relAge;
  const MemberDetail = window.GA.MemberDetail;

  const [members, setMembers] = React.useState(window.GA.members);
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [banner, setBanner] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { if (onDetailChange) onDetailChange(!!selected); }, [selected]);

  const counts = {
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    pending: members.filter((m) => m.status === "pending").length,
    kroger: members.filter((m) => m.kroger === "linked").length,
  };

  function mintCode() {
    const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
    return "GA-" + seg() + "-" + seg();
  }
  const CONNECTOR = "https://grocery.dirtbag.social/connect";

  function invite() {
    const u = username.trim().toLowerCase().replace(/\s+/g, "-");
    if (!u) return;
    setMembers((prev) => [
      ...prev,
      { user: u, status: "pending", kroger: "pending", joined: null, invited: Date.now(), cooked: 0, favorites: 0 },
    ]);
    setBanner({ kind: "invite", user: u, code: mintCode(), connector: CONNECTOR });
    setUsername("");
    setOpen(false);
  }
  function rotate(m) { setBanner({ kind: "invite", user: m.user, code: mintCode(), connector: CONNECTOR }); }
  function krogerLink(m) { setBanner({ kind: "kroger", user: m.user, url: "https://kroger.com/consent/" + mintCode().toLowerCase() }); }
  function revoke(m) {
    setMembers((prev) => prev.filter((x) => x.user !== m.user));
    setBanner(null);
  }

  function krogerBadge(m) {
    if (m.kroger === "linked") return <Badge variant="secondary"><I.link size={11} /> kroger</Badge>;
    return null;
  }

  function menuItems(m) {
    const head = [{ heading: "@" + m.user }];
    const rotateItem = { label: "Rotate invite", icon: <I.key />, onClick: () => rotate(m) };
    const sep = { separator: true };
    const revokeItem = {
      label: m.status === "pending" ? "Revoke invite" : "Revoke access",
      icon: <I.trash />, variant: "destructive", onClick: () => revoke(m),
    };
    if (m.status === "pending") return [...head, rotateItem, sep, revokeItem];
    return [
      ...head,
      rotateItem,
      { label: m.kroger === "linked" ? "Re-link Kroger" : "Link Kroger", icon: <I.link />, onClick: () => krogerLink(m) },
      sep,
      revokeItem,
    ];
  }

  const cards = [
    { icon: <I.users />, label: "Members", value: counts.total },
    { icon: <I.checkCircle />, label: "Active", value: counts.active },
    { icon: <I.clock />, label: "Pending", value: counts.pending },
    { icon: <I.link />, label: "Kroger linked", value: counts.kroger },
  ];

  if (selected) {
    const m = members.find((x) => x.user === selected);
    if (m) return <MemberDetail m={m} onBack={() => setSelected(null)} />;
  }

  const CopyRow = ({ label, value }) => {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
      const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, done);
      else done();
    };
    return (
      <div className="minted-row">
        <span className="minted-label">{label}</span>
        <code className="minted-code">{value}</code>
        <Button variant="outline" size="sm" className="minted-copy" onClick={copy} aria-label={"Copy " + label}>
          {copied ? <><I.checkCircle size={13} /> Copied</> : <><I.copy size={13} /> Copy</>}
        </Button>
      </div>
    );
  };

  return (
    <>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <span className="stat-ico">{c.icon}</span>
              <span className="stat-label">{c.label}</span>
            </div>
            <div className="stat-value">{c.value}</div>
          </div>
        ))}
      </div>

      {banner && (
        <div className="minted">
          <div className="minted-head">
            <strong>{banner.kind === "kroger" ? `Kroger consent link · @${banner.user}` : `Invite minted · @${banner.user}`}</strong>
            <button className="link-action" onClick={() => setBanner(null)}>Dismiss</button>
          </div>
          <p className="once">
            {banner.kind === "kroger"
              ? "Single-use, expires in ~10 minutes; never logged. Share it with the member to authorize Kroger."
              : "Shown once — copy it now. Share with the invitee to connect their Claude.ai."}
          </p>
          {banner.kind === "invite" ? (
            <>
              <CopyRow label="invite code" value={banner.code} />
              <CopyRow label="connector" value={banner.connector} />
            </>
          ) : (
            <CopyRow label="consent url" value={banner.url} />
          )}
        </div>
      )}

      <div className="roster-head">
        <p className="group-label">Roster</p>
        <Button size="sm" onClick={() => setOpen(true)}><I.userPlus size={14} /> Invite member</Button>
      </div>
      <ItemGroup className="member-list">
        {members.map((m) => (
          <Item
            key={m.user}
            variant="outline"
            className="member-item member-item-link"
            onClick={() => setSelected(m.user)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") setSelected(m.user); }}
            media={<Avatar fallback={m.user.slice(0, 2).toUpperCase()} size="lg" />}
            title={
              <span className="member-name">
                <span className="member-user">@{m.user}</span>
                {m.owner && <Badge variant="secondary">owner</Badge>}
              </span>
            }
            description={
              <span className="member-meta">
                {m.status === "active"
                  ? `${m.cooked} recipes cooked · ${m.favorites} favorites · active ${rel(m.lastActive)}`
                  : `Invited ${rel(m.invited)} · awaiting Claude.ai connection`}
              </span>
            }
            actions={
              <div className="member-trail" onClick={(e) => e.stopPropagation()}>
                {krogerBadge(m)}
                {m.status === "active"
                  ? <Badge variant="secondary">active</Badge>
                  : <Badge variant="outline">pending</Badge>}
                <DropdownMenu
                  align="end"
                  trigger={<Button variant="ghost" size="icon" aria-label="Member actions"><I.more /></Button>}
                  items={menuItems(m)}
                />
              </div>
            }
          />
        ))}
      </ItemGroup>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Invite member"
        description="Mint an invite code for someone in your friend group."
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={invite}>Mint invite</Button>
        </>}
      >
        <Field label="Username" htmlFor="invite-username" hint="Their tenant id — lowercase, no spaces. No email is sent.">
          <Input id="invite-username" type="text" placeholder="friend-handle"
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
window.GA = window.GA || {};
window.GA.MembersScreen = MembersScreen;
