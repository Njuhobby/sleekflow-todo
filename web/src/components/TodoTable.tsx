import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { TodoListItem } from "@shared/todo-schemas";
import { legalTargets } from "@shared/transitions";
import { isOverdue } from "@shared/overdue";
import { ApiError } from "../api/client.js";
import { useDeleteTodo, useRestoreTodo, useUpdateTodo } from "../api/hooks.js";
import { STATUS_LABELS, formatDue, transitionLabel } from "../lib/labels.js";
import { PriorityPill, StatusPill } from "./pills.js";
import { useToast } from "./toast.js";

interface Props {
  items: TodoListItem[];
  onOpen: (id: string) => void;
  trashMode?: boolean;
}

export function TodoTable({ items, onOpen, trashMode = false }: Props) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        {trashMode ? "Trash is empty." : "No matches. Adjust filters or add a todo below."}
      </div>
    );
  }
  return (
    <Tooltip.Provider delayDuration={200}>
      <table className="todo-table">
        <tbody>
          {items.map((todo) => (
            <Row key={todo.id} todo={todo} onOpen={onOpen} trashMode={trashMode} />
          ))}
        </tbody>
      </table>
    </Tooltip.Provider>
  );
}

function Row({ todo, onOpen, trashMode }: { todo: TodoListItem } & Omit<Props, "items">) {
  const update = useUpdateTodo();
  const del = useDeleteTodo();
  const restore = useRestoreTodo();
  const toast = useToast();

  const transition = (to: string) => {
    update.mutate(
      { id: todo.id, version: todo.version, status: to as TodoListItem["status"] },
      {
        onSuccess: () => {
          if (to === "completed" && todo.recurrence) {
            toast.info(`Completed "${todo.name}" — next occurrence created`);
          }
        },
        onError: (err) => toast.error(describeError(err)),
      }
    );
  };

  const handleDelete = () => {
    del.mutate(todo.id, {
      onSuccess: () =>
        toast.info(`Deleted "${todo.name}"`, {
          actionLabel: "Undo",
          onAction: () => restore.mutate(todo.id),
        }),
      onError: (err) => toast.error(describeError(err)),
    });
  };

  return (
    <tr className={`todo-row status-${todo.status}`}>
      <td style={{ width: 110 }}>
        <StatusPill status={todo.status} />
      </td>
      <td>
        <span className="todo-name" onClick={() => onOpen(todo.id)}>
          {todo.name}
        </span>
        {todo.recurrence && (
          <span className="badge" title={`Repeats every ${todo.recurrence.interval} ${todo.recurrence.frequency.replace("ly", "")}(s)`}>
            ↻
          </span>
        )}
        {todo.isBlocked && <BlockedBadge todo={todo} />}
      </td>
      <td style={{ width: 90 }}>
        <PriorityPill priority={todo.priority} />
      </td>
      <td style={{ width: 90 }}>
        <span className={`due ${isOverdue(todo) ? "overdue" : ""}`}>
          {formatDue(todo.dueDate)}
        </span>
      </td>
      <td style={{ width: 40 }} className="row-actions">
        {trashMode ? (
          <button className="btn-ghost" onClick={() => restore.mutate(todo.id)}>
            Restore
          </button>
        ) : (
          <RowMenu todo={todo} onOpen={onOpen} onTransition={transition} onDelete={handleDelete} />
        )}
      </td>
    </tr>
  );
}

/** 🔒 with the named blockers — archived ones marked (A12). */
function BlockedBadge({ todo }: { todo: TodoListItem }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="badge" data-testid="blocked-badge">
          🔒
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={4}>
          Blocked by:{" "}
          {todo.incompleteDependencies.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              {d.name}
              {d.status === "archived" && <span className="archived-note"> (archived)</span>}
            </span>
          ))}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Menu options derive from the R-1.8 table — no illegal edge is offered. */
function RowMenu({
  todo,
  onOpen,
  onTransition,
  onDelete,
}: {
  todo: TodoListItem;
  onOpen: (id: string) => void;
  onTransition: (to: string) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="btn-ghost" aria-label={`Actions for ${todo.name}`}>
          ⋯
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="end">
          {legalTargets(todo.status).map((to) => (
            <DropdownMenu.Item key={to} className="menu-item" onSelect={() => onTransition(to)}>
              {transitionLabel(todo.status, to)}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={() => onOpen(todo.id)}>
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item danger" onSelect={onDelete}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Turn API errors into human sentences (R-5.4: never silent). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "TODO_BLOCKED") {
      const deps = (err.details as { incompleteDependencies?: Array<{ name: string; status: string }> })
        ?.incompleteDependencies;
      const names = deps?.map((d) => `"${d.name}"${d.status === "archived" ? " (archived)" : ""}`);
      return `Blocked by incomplete ${names && names.length > 1 ? "dependencies" : "dependency"}: ${names?.join(", ") ?? "?"}`;
    }
    if (err.code === "STALE_VERSION") return "Changed by someone else — list refreshed, try again";
    if (err.code === "INVALID_TRANSITION") {
      const d = err.details as { from?: string; to?: string };
      return `Can't move from ${STATUS_LABELS[d.from as keyof typeof STATUS_LABELS] ?? d.from} to ${STATUS_LABELS[d.to as keyof typeof STATUS_LABELS] ?? d.to}`;
    }
    if (err.code === "DEPENDENCY_CYCLE") return "That would create a dependency cycle";
    if (err.code === "DEPENDENCY_EDIT_INVALID_STATUS")
      return "Dependencies can only be edited while the task is Not started";
    return err.message;
  }
  return "Something went wrong";
}
