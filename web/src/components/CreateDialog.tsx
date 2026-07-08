import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { Recurrence } from "@shared/todo-schemas";
import { CreateTodoSchema } from "@shared/todo-schemas";
import { useCreateTodo } from "../api/hooks.js";
import { localInputToIso } from "../lib/labels.js";
import { RecurrenceEditor } from "./DetailPanel.js";
import { describeError } from "./TodoTable.js";
import { useToast } from "./toast.js";

/** "+ New" — the full-detail create form; quick-add bypasses this. */
export function CreateDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const create = useCreateTodo();
  const toast = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setName("");
    setDescription("");
    setDue("");
    setPriority("medium");
    setRecurrence(null);
    setErrors({});
  };

  const submit = () => {
    const parsed = CreateTodoSchema.safeParse({
      name,
      description: description || undefined,
      dueDate: due ? localInputToIso(due) : undefined,
      priority,
      recurrence,
    });
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) map[String(issue.path[0] ?? "form")] = issue.message;
      setErrors(map);
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (todo) => {
        setOpen(false);
        reset();
        onCreated(todo.id);
      },
      onError: (err) => toast.error(describeError(err)),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="btn btn-primary">+ New</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="panel-overlay" />
        <Dialog.Content className="panel" aria-describedby={undefined}>
          <Dialog.Title>New TODO</Dialog.Title>
          <Dialog.Close asChild>
            <button className="btn-ghost panel-close" aria-label="Close">
              ✕
            </button>
          </Dialog.Close>

          <div className="field">
            <label htmlFor="c-name">Name</label>
            <input
              id="c-name"
              type="text"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <div className="field-error">{errors.name}</div>}
          </div>

          <div className="inline-row">
            <div className="field" style={{ margin: 0, width: 120 }}>
              <label htmlFor="c-priority">Priority</label>
              <select
                id="c-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as typeof priority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="c-due">Due</label>
              <input
                id="c-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="c-desc">Description</label>
            <textarea
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
          <p className="hint">Dependencies can be added after creation, from the task's panel.</p>

          <div className="panel-footer">
            <button className="btn btn-primary" disabled={create.isPending} onClick={submit}>
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
