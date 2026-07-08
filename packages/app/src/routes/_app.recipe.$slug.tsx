// Recipe detail (member-app-core 7.4, D14): overlay-merged frontmatter + derived
// description, the Cook-with-Claude deep link (no model call in the app — anything
// conversational deep-links out), add-to-plan / log-as-cooked / favorite actions,
// the markdown body, the notes section (own editable incl. private; other members'
// shared notes read-only), and Similar recipes — the design bundle's detail page.
import * as React from "react";
import { Link, createFileRoute, useLoaderData } from "@tanstack/react-router";
import {
  Button,
  Crumbs,
  EmptyState,
  IconBack,
  IconCalendar,
  IconCheck,
  IconClock,
  IconEdit,
  IconHeart,
  IconHeartFill,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
  Input,
  RecipeFacets,
  Textarea,
  toast,
} from "@grocery-agent/ui";
import {
  useNotes,
  useOverlay,
  usePlan,
  useRecipe,
  useSimilar,
  type NoteRow,
} from "../lib/data";
import {
  useLogAdd,
  useNoteAdd,
  useNoteEdit,
  useNoteRemove,
  usePlanOps,
  useSetFavorite,
} from "../lib/mutations";
import { RecipeList } from "../components/recipe-list";
import { mdToHtml } from "../lib/md";
import { relAge, isoToday } from "../lib/format";

export const Route = createFileRoute("/_app/recipe/$slug")({
  component: RecipeDetailPage,
});

function RecipeDetailPage() {
  const { slug } = Route.useParams();
  const recipe = useRecipe(slug);
  const planOps = usePlanOps();
  const favorite = useSetFavorite();
  const logAdd = useLogAdd();
  const similar = useSimilar(slug);
  const notes = useNotes(slug);
  const overlay = useOverlay();
  const plan = usePlan();

  if (recipe.isError) {
    return (
      <div data-testid="recipe-detail">
        <Crumbs
          items={[{ label: "Cookbook", to: "/" }, { label: "Not found" }]}
          renderLink={(to, label) => (
            <Link to={to} key={to}>
              {label}
            </Link>
          )}
        />
        <EmptyState
          title="Recipe not found"
          sub="It may have been renamed or removed."
          icon={<IconSearch />}
          action={
            <Button asChild variant="outline">
              <Link to="/">
                <IconBack /> Browse the cookbook
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (!recipe.data) return null;

  const fm = recipe.data.frontmatter;
  const title = typeof fm.title === "string" ? fm.title : slug;
  const fav = Boolean(overlay.data?.overlay[slug]?.favorite);
  const planned = Boolean(plan.data?.planned.some((p) => p.recipe.toLowerCase() === slug.toLowerCase()));
  const timeTotal = typeof fm.time_total === "number" ? fm.time_total : null;
  const source = typeof fm.source === "string" ? fm.source : null;

  function onAddToPlan() {
    planOps.mutate({ ops: [{ op: "add", recipe: slug }] }, { onSuccess: () => toast("Added to meal plan") });
  }

  function onLogCooked() {
    // Registry mutation: the defaults invalidate log/plan/vibes on settle (a cook
    // clears its planned row and advances last_satisfied).
    logAdd.mutate(
      { type: "recipe", recipe: slug, date: isoToday() },
      { onSuccess: () => toast("Logged as cooked") },
    );
  }

  return (
    <div data-testid="recipe-detail">
      <Crumbs
        items={[{ label: "Cookbook", to: "/" }, { label: title }]}
        renderLink={(to, label) => (
          <Link to={to} key={to}>
            {label}
          </Link>
        )}
      />
      <article className="detail">
        <div className="detail-titlerow">
          <h1 data-testid="recipe-title">{title}</h1>
          <button
            type="button"
            className={`fav-btn lg${fav ? " on" : ""}`}
            aria-pressed={fav}
            title={fav ? "Unfavorite" : "Favorite"}
            data-testid="detail-fav"
            onClick={() => favorite.mutate({ slug, favorite: !fav })}
          >
            {fav ? <IconHeartFill /> : <IconHeart />}
          </button>
        </div>
        <div className="detail-meta">
          <RecipeFacets
            protein={typeof fm.protein === "string" ? fm.protein : null}
            cuisine={typeof fm.cuisine === "string" ? fm.cuisine : null}
          />
          {timeTotal ? (
            <span className="detail-time">
              <IconClock /> {timeTotal} min
            </span>
          ) : null}
        </div>
        {source ? (
          <p className="detail-source">
            Source:{" "}
            <a href={source} target="_blank" rel="noopener noreferrer">
              {source}
            </a>
          </p>
        ) : null}
        <div className="action-row">
          <Button asChild data-testid="cook-with-claude">
            <a
              href={`https://claude.ai/new?q=${encodeURIComponent(`/cook ${slug}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconSparkles /> Cook with Claude
            </a>
          </Button>
          <Button variant="outline" disabled={planned} data-testid="detail-plan" onClick={onAddToPlan}>
            <IconCalendar /> {planned ? "In meal plan" : "Add to meal plan"}
          </Button>
          <Button variant="ghost" data-testid="detail-log" onClick={onLogCooked}>
            <IconCheck /> Log as cooked
          </Button>
        </div>

        {/* Escape-first markdown render (lib/md.ts) — authored corpus text, no raw HTML. */}
        <div className="prose" data-testid="recipe-body" dangerouslySetInnerHTML={{ __html: mdToHtml(recipe.data.body) }} />

        <NotesSection slug={slug} notes={notes.data?.notes ?? []} />

        {similar.data && similar.data.similar.length > 0 ? (
          <section className="similar" data-testid="similar-recipes">
            <h2>Similar recipes</h2>
            <RecipeList recipes={similar.data.similar} />
          </section>
        ) : null}
      </article>
    </div>
  );
}

// --- notes (D14: own editable incl. private; community read-only) ----------------

function NotesSection({ slug, notes }: { slug: string; notes: NoteRow[] }) {
  const noteAdd = useNoteAdd();
  const session = useSessionTenant();
  const mine = notes.filter((n) => n.author === session);
  const community = notes.filter((n) => n.author !== session && !n.private);

  const [body, setBody] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [priv, setPriv] = React.useState(false);

  function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    // Client-minted created_at is the idempotency key (D8/D14) — a replayed queued
    // delivery upserts, never duplicates. Fire-and-clear.
    noteAdd.mutate({
      slug,
      body: body.trim(),
      tags: tag.trim() ? [tag.trim()] : [],
      private: priv,
      created_at: new Date().toISOString(),
    });
    setBody("");
    setTag("");
    setPriv(false);
  }

  return (
    <section className="notes" data-testid="notes-section">
      <h2>Your notes</h2>
      <form className="note-form" onSubmit={addNote} data-testid="note-form">
        <Textarea
          className="textarea"
          rows={2}
          placeholder="Add a note for next time…"
          aria-label="Note body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="note-form-row">
          <Input
            className="note-tag-input"
            placeholder="tag (optional)"
            autoComplete="off"
            aria-label="Tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
          <label className="note-priv">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private
          </label>
          <Button type="submit" size="sm" disabled={!body.trim()}>
            <IconPlus /> Add note
          </Button>
        </div>
      </form>
      {mine.length ? (
        <ul className="notelist mine" data-testid="own-notes">
          {mine.map((n) => (
            <OwnNote key={n.created_at} slug={slug} note={n} />
          ))}
        </ul>
      ) : (
        <p className="muted-line">No notes yet — jot down a tweak after you cook it.</p>
      )}
      {community.length ? (
        <>
          <h2 className="community-h">From other members</h2>
          <ul className="notelist" data-testid="community-notes">
            {community.map((n) => (
              <CommunityNote key={`${n.author}-${n.created_at}`} note={n} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function OwnNote({ slug, note }: { slug: string; note: NoteRow }) {
  const noteEdit = useNoteEdit();
  const noteRemove = useNoteRemove();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(note.body);

  function save() {
    noteEdit.mutate({ slug, created_at: note.created_at, body: draft.trim() });
    setEditing(false);
  }

  function remove() {
    noteRemove.mutate({ slug, created_at: note.created_at });
  }

  return (
    <li className="note" data-testid="own-note">
      <span className="note-avatar you" aria-hidden="true">
        {note.author.charAt(0).toUpperCase()}
      </span>
      <div className="note-main">
        <div className="note-head">
          <span className="note-author">you</span>
          {note.tags[0] ? <span className="note-tag">{note.tags[0]}</span> : null}
          {note.private ? <span className="note-priv-badge">private</span> : null}
          <span className="note-time">{relAge(note.created_at)}</span>
          <span className="note-actions">
            <button type="button" className="icon-btn" title="Edit" data-testid="note-edit" onClick={() => setEditing(true)}>
              <IconEdit />
            </button>
            <button type="button" className="icon-btn" title="Delete" data-testid="note-delete" onClick={remove}>
              <IconTrash />
            </button>
          </span>
        </div>
        {editing ? (
          <div className="note-edit">
            <Textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="note-edit-actions">
              <Button size="sm" onClick={save} disabled={!draft.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="note-body">{note.body}</p>
        )}
      </div>
    </li>
  );
}

function CommunityNote({ note }: { note: NoteRow }) {
  return (
    <li className="note" data-testid="community-note">
      <span className="note-avatar" aria-hidden="true">
        {note.author.charAt(0).toUpperCase()}
      </span>
      <div className="note-main">
        <div className="note-head">
          <span className="note-author">{note.author}</span>
          {note.tags[0] ? <span className="note-tag">{note.tags[0]}</span> : null}
          <span className="note-time">{relAge(note.created_at)}</span>
        </div>
        <p className="note-body">{note.body}</p>
      </div>
    </li>
  );
}

/** The signed-in tenant id, from the shell route's whoami loader data. */
function useSessionTenant(): string {
  const data = useLoaderData({ from: "/_app" }) as { tenant: { id: string } };
  return data.tenant.id;
}
