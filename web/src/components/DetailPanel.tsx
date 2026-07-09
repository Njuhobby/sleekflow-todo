import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import type { Activity, Recurrence, RelatedTodo, Status, TodoDetail } from "@shared/todo-schemas";
import { UpdateTodoSchema } from "@shared/todo-schemas";
import { ApiError } from "../api/client.js";
import { useActivities, usePickerSearch, useTodoDetail, useUpdateTodo } from "../api/hooks.js";
import {
  STATUS_LABELS,
  formatDateTime,
  isoToLocalInput,
  localInputToIso,
} from "../lib/labels.js";
import { StatusPill } from "./pills.js";
import { StatusDot } from "./StatusDot.js";
import { StatusFlow } from "./StatusFlow.js";
import { describeError } from "./TodoTable.js";
import { useToast } from "./toast.js";

interface Props {
  id: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

export function DetailPanel({ id, onClose, onNavigate }: Props) {
  const { data: todo, refetch } = useTodoDetail(id);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="panel-overlay" />
        <Dialog.Content className="panel" aria-describedby={undefined}>
          <Dialog.Title style={{ display: "none" }}>Todo details</Dialog.Title>
          <Dialog.Close asChild>
            <button className="btn-ghost panel-close" aria-label="Close">
              ✕
            </button>
          </Dialog.Close>
          {todo ? (
            <PanelBody
              key={`${todo.id}:${todo.version}`}
              todo={todo}
              onNavigate={onNavigate}
              refetch={() => void refetch()}
            />
          ) : (
            <p className="hint">Loading…</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The whole panel is one DRAFT: fields, the dependency list, and the status
 * selection live in local state and hit the database only on Save changes —
 * as one atomic PATCH (all-or-nothing). Cancel discards everything. The
 * key on this component ({id}:{version}) resets the draft whenever the
 * server state advances.
 */
function PanelBody({
  todo,
  onNavigate,
  refetch,
}: {
  todo: TodoDetail;
  onNavigate: (id: string) => void;
  refetch: () => void;
}) {
  const update = useUpdateTodo();
  const toast = useToast();

  const [name, setName] = useState(todo.name);
  const [description, setDescription] = useState(todo.description ?? "");
  const [due, setDue] = useState(isoToLocalInput(todo.dueDate));
  const [priority, setPriority] = useState(todo.priority);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(todo.recurrence);
  const [draftStatus, setDraftStatus] = useState<Status | null>(null);
  const [draftDeps, setDraftDeps] = useState<RelatedTodo[]>(todo.dependencies);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);

  const serverDepIds = useMemo(
    () => todo.dependencies.map((d) => d.id).sort().join(","),
    [todo.dependencies]
  );
  const depsChanged = draftDeps.map((d) => d.id).sort().join(",") !== serverDepIds;

  const fieldsDirty =
    name !== todo.name ||
    description !== (todo.description ?? "") ||
    due !== isoToLocalInput(todo.dueDate) ||
    priority !== todo.priority ||
    JSON.stringify(recurrence) !== JSON.stringify(todo.recurrence);

  const dirty = fieldsDirty || draftStatus !== null || depsChanged;

  const cancel = () => {
    setName(todo.name);
    setDescription(todo.description ?? "");
    setDue(isoToLocalInput(todo.dueDate));
    setPriority(todo.priority);
    setRecurrence(todo.recurrence);
    setDraftStatus(null);
    setDraftDeps(todo.dependencies);
    setFieldErrors({});
  };

  // A15: saving a first-time recurrence on a completed task spawns right away
  const willSpawnOnSave =
    (draftStatus ?? todo.status) === "completed" &&
    todo.recurrence === null &&
    recurrence !== null &&
    draftStatus === null;

  const save = () => {
    const input = {
      version: todo.version,
      name,
      description: description || null,
      dueDate: due ? localInputToIso(due) : null,
      priority,
      recurrence,
      ...(draftStatus !== null && { status: draftStatus }),
      ...(depsChanged && { dependencyIds: draftDeps.map((d) => d.id) }),
    };
    const parsed = UpdateTodoSchema.safeParse(input);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0] ?? "form")] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    update.mutate(
      { id: todo.id, ...parsed.data },
      {
        onSuccess: () => {
          const spawned = (draftStatus === "completed" && recurrence) || willSpawnOnSave;
          toast.info(spawned ? "Saved — next occurrence created" : "Changes saved");
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "STALE_VERSION") setStale(true);
          else toast.error(describeError(err));
        },
      }
    );
  };

  return (
    <div>
      {stale && (
        <div className="banner" data-testid="stale-banner">
          <span>Changed by someone else while you were editing.</span>
          <button
            className="btn"
            onClick={() => {
              setStale(false);
              refetch();
            }}
          >
            Load latest
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="f-name">Name</label>
        <input id="f-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        {fieldErrors.name && <div className="field-error">{fieldErrors.name}</div>}
      </div>

      <div className="inline-row">
        <StatusPill status={todo.status} />
        <div style={{ flex: 1 }} />
        <div className="field" style={{ margin: 0, width: 120 }}>
          <label htmlFor="f-priority">Priority</label>
          <select
            id="f-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TodoDetail["priority"])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="f-due">Due</label>
          <input
            id="f-due"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="f-desc">Description</label>
        <textarea
          id="f-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
      {willSpawnOnSave && (
        <div className="hint" data-testid="spawn-hint">
          This task is already completed — saving this recurrence will immediately create
          the next occurrence.
        </div>
      )}

      <DependencyFlow
        todo={todo}
        draftDeps={draftDeps}
        setDraftDeps={setDraftDeps}
        onNavigate={onNavigate}
      />

      <ActivitySection todoId={todo.id} />

      <div className="panel-section">
        <h3>Status</h3>
        <StatusFlow todo={todo} draftStatus={draftStatus} onSelect={setDraftStatus} />
      </div>

      {dirty && (
        <div className="panel-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={cancel} disabled={update.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={update.isPending}>
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function RecurrenceEditor({
  value,
  onChange,
}: {
  value: Recurrence | null;
  onChange: (r: Recurrence | null) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="f-rec">Recurrence</label>
      <div className="inline-row">
        <select
          id="f-rec"
          value={value?.frequency ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value
                ? {
                    frequency: e.target.value as Recurrence["frequency"],
                    interval: value?.interval ?? 1,
                  }
                : null
            )
          }
        >
          <option value="">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        {value && (
          <>
            <span className="hint">every</span>
            <input
              type="number"
              min={1}
              max={999}
              style={{ width: 64 }}
              value={value.interval}
              onChange={(e) =>
                onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })
              }
              aria-label="Recurrence interval"
            />
            <span className="hint">{value.frequency.replace("ly", "")}(s)</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Dependencies and dependents as one flow — upstream → this task →
 * downstream — mirroring how the graph actually works. The left column is
 * draft-editable (A11: only while the CURRENT status is not_started); the
 * right column is read-only. Lock markers sit on the arrows where the flow
 * is actually blocked.
 */
function DependencyFlow({
  todo,
  draftDeps,
  setDraftDeps,
  onNavigate,
}: {
  todo: TodoDetail;
  draftDeps: RelatedTodo[];
  setDraftDeps: (deps: RelatedTodo[]) => void;
  onNavigate: (id: string) => void;
}) {
  const editable = todo.status === "not_started";
  const [search, setSearch] = useState("");
  const results = usePickerSearch(search);

  const draftIds = draftDeps.map((d) => d.id);
  const candidates = (results.data?.items ?? []).filter(
    (t) => t.id !== todo.id && !draftIds.includes(t.id)
  );

  const upstreamBlocks = draftDeps.some((d) => d.status !== "completed");
  const downstreamWaits = todo.dependents.length > 0 && todo.status !== "completed";

  return (
    <div className="panel-section">
      <h3>Dependencies &amp; Blocking</h3>
      <div className="dep-flow" data-testid="dep-flow">
        <div className="dep-col">
          <div className="dep-caption">Depends on</div>
          {draftDeps.length === 0 && <div className="hint">None</div>}
          {draftDeps.map((d) => (
            <div key={d.id} className="dep-chip">
              <StatusDot status={d.status} />
              <span className="dep-chip-name link" onClick={() => onNavigate(d.id)} title={d.name}>
                {d.name}
              </span>
              {editable && (
                <button
                  className="btn-ghost dep-remove"
                  aria-label={`Remove dependency ${d.name}`}
                  onClick={() => setDraftDeps(draftDeps.filter((x) => x.id !== d.id))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {editable && (
            <div className="dep-add">
              <input
                type="text"
                placeholder="+ Add…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search dependencies"
              />
              {search && candidates.length > 0 && (
                <div className="picker-results">
                  {candidates.map((t) => (
                    <div
                      key={t.id}
                      className="picker-item"
                      onClick={() => {
                        setDraftDeps([...draftDeps, { id: t.id, name: t.name, status: t.status }]);
                        setSearch("");
                      }}
                    >
                      <span>{t.name}</span>
                      <StatusPill status={t.status} />
                    </div>
                  ))}
                </div>
              )}
              {search && results.data && candidates.length === 0 && (
                <div className="hint">No matches.</div>
              )}
            </div>
          )}
        </div>

        <div className="dep-arrow" title={upstreamBlocks ? "Incomplete dependencies block this task" : undefined}>
          {upstreamBlocks ? "🔒" : "→"}
        </div>

        <div className="dep-self" title={todo.name}>
          <StatusDot status={todo.status} />
          <span className="dep-chip-name">{todo.name}</span>
        </div>

        <div className="dep-arrow" title={downstreamWaits ? "These tasks wait for this one to complete" : undefined}>
          {downstreamWaits ? "🔒" : "→"}
        </div>

        <div className="dep-col">
          <div className="dep-caption">Blocks</div>
          {todo.dependents.length === 0 && <div className="hint">None</div>}
          {todo.dependents.map((d) => (
            <div key={d.id} className="dep-chip">
              <StatusDot status={d.status} />
              <span className="dep-chip-name link" onClick={() => onNavigate(d.id)} title={d.name}>
                {d.name}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!editable && (
        <div className="hint">
          Dependencies can only be edited while the task is Not started — move it back first.
        </div>
      )}
    </div>
  );
}

function ActivitySection({ todoId }: { todoId: string }) {
  const { data } = useActivities(todoId);
  if (!data || data.items.length === 0) return null;
  return (
    <div className="panel-section">
      <h3>Activity</h3>
      <ul className="timeline">
        {data.items.map((a) => (
          <li key={a.id}>
            <span>{describeActivity(a)}</span>
            <time>{formatDateTime(a.createdAt)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeActivity(a: Activity): string {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case "created":
      return "Created";
    case "created_from_recurrence":
      return "Created by recurrence";
    case "status_changed":
      return `Status: ${STATUS_LABELS[p.from as Status] ?? p.from} → ${STATUS_LABELS[p.to as Status] ?? p.to}`;
    case "updated": {
      const fields = Object.keys((p.changed as object) ?? {});
      return `Edited ${fields.join(", ")}`;
    }
    case "dependencies_changed": {
      const added = (p.added as Array<{ name: string }>) ?? [];
      const removed = (p.removed as Array<{ name: string }>) ?? [];
      const parts = [
        ...added.map((d) => `now depends on "${d.name}"`),
        ...removed.map((d) => `dependency on "${d.name}" removed`),
      ];
      return parts.join("; ") || "Dependencies changed";
    }
    case "deleted":
      return "Deleted";
    case "restored":
      return "Restored from trash";
    case "spawned_next":
      return "Completed — next occurrence created";
    default:
      return a.type;
  }
}

// Re-exported for the create form
export { RecurrenceEditor };
