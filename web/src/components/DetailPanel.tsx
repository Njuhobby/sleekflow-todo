import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import type { Activity, Recurrence, Status, TodoDetail } from "@shared/todo-schemas";
import { UpdateTodoSchema } from "@shared/todo-schemas";
import { legalTargets } from "@shared/transitions";
import { ApiError } from "../api/client.js";
import {
  useActivities,
  usePickerSearch,
  useSetDependencies,
  useTodoDetail,
  useUpdateTodo,
} from "../api/hooks.js";
import {
  STATUS_LABELS,
  formatDateTime,
  isoToLocalInput,
  localInputToIso,
  transitionLabel,
} from "../lib/labels.js";
import { StatusPill } from "./pills.js";
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);

  const dirty =
    name !== todo.name ||
    description !== (todo.description ?? "") ||
    due !== isoToLocalInput(todo.dueDate) ||
    priority !== todo.priority ||
    JSON.stringify(recurrence) !== JSON.stringify(todo.recurrence);

  const save = () => {
    const input = {
      version: todo.version,
      name,
      description: description || null,
      dueDate: due ? localInputToIso(due) : null,
      priority,
      recurrence,
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
      { onError: (err) => handleError(err) }
    );
  };

  const transition = (to: Status) => {
    update.mutate(
      { id: todo.id, version: todo.version, status: to },
      {
        onSuccess: () => {
          if (to === "completed" && todo.recurrence) {
            toast.info("Completed — next occurrence created");
          }
        },
        onError: (err) => handleError(err),
      }
    );
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "STALE_VERSION") setStale(true);
    else toast.error(describeError(err));
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

      <DependenciesSection todo={todo} onNavigate={onNavigate} onError={handleError} />

      {todo.dependents.length > 0 && (
        <div className="panel-section">
          <h3>Blocking ({todo.dependents.length})</h3>
          {todo.dependents.map((d) => (
            <div key={d.id} className="related-item">
              <span className="link" onClick={() => onNavigate(d.id)}>
                {d.name}
              </span>
              <StatusPill status={d.status} />
            </div>
          ))}
        </div>
      )}

      <ActivitySection todoId={todo.id} />

      <div className="panel-footer">
        {legalTargets(todo.status).map((to) => (
          <button
            key={to}
            className={to === "completed" ? "btn btn-primary" : "btn"}
            onClick={() => transition(to)}
          >
            {transitionLabel(todo.status, to)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={!dirty || update.isPending} onClick={save}>
          Save changes
        </button>
      </div>
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
                ? { frequency: e.target.value as Recurrence["frequency"], interval: value?.interval ?? 1 }
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

/** Editable only while not_started (A11) — otherwise a hint explains why. */
function DependenciesSection({
  todo,
  onNavigate,
  onError,
}: {
  todo: TodoDetail;
  onNavigate: (id: string) => void;
  onError: (err: unknown) => void;
}) {
  const setDeps = useSetDependencies();
  const toast = useToast();
  const editable = todo.status === "not_started";
  const [search, setSearch] = useState("");
  const results = usePickerSearch(search);

  const currentIds = useMemo(() => todo.dependencies.map((d) => d.id), [todo.dependencies]);

  const mutate = (ids: string[]) => {
    setDeps.mutate(
      { id: todo.id, version: todo.version, dependencyIds: ids },
      { onSuccess: () => setSearch(""), onError }
    );
  };

  // Removal is an instant server mutation (unlike the draft-and-Save fields),
  // so like delete it gets an undo toast. Undo replays the previous list with
  // the post-mutation version the server just returned.
  const removeWithUndo = (dep: { id: string; name: string }) => {
    const previousIds = currentIds;
    setDeps.mutate(
      { id: todo.id, version: todo.version, dependencyIds: previousIds.filter((x) => x !== dep.id) },
      {
        onSuccess: (updated) =>
          toast.info(`Dependency on "${dep.name}" removed`, {
            actionLabel: "Undo",
            onAction: () =>
              setDeps.mutate(
                { id: todo.id, version: updated.version, dependencyIds: previousIds },
                { onError }
              ),
          }),
        onError,
      }
    );
  };

  const candidates = (results.data?.items ?? []).filter(
    (t) => t.id !== todo.id && !currentIds.includes(t.id)
  );

  return (
    <div className="panel-section">
      <h3>Dependencies ({todo.dependencies.length})</h3>
      {todo.dependencies.map((d) => (
        <div key={d.id} className="related-item">
          <span className="link" onClick={() => onNavigate(d.id)}>
            {d.name}
          </span>
          <span className="inline-row">
            <StatusPill status={d.status} />
            {editable && (
              <button
                className="btn-ghost"
                aria-label={`Remove dependency ${d.name}`}
                onClick={() => removeWithUndo(d)}
              >
                ✕
              </button>
            )}
          </span>
        </div>
      ))}

      {editable ? (
        <div className="field">
          <input
            type="text"
            placeholder="+ Add dependency (search by name)…"
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
                  onClick={() => mutate([...currentIds, t.id])}
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
      ) : (
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
