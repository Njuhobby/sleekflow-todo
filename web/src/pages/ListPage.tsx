import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCreateTodo, useTodos } from "../api/hooks.js";
import { CalendarMonth } from "../components/CalendarMonth.js";
import { CreateDialog } from "../components/CreateDialog.js";
import { DetailPanel } from "../components/DetailPanel.js";
import { FilterBar, buildApiSearch } from "../components/FilterBar.js";
import { TodoTable, describeError } from "../components/TodoTable.js";
import { useToast } from "../components/toast.js";

export function ListPage({ trashMode = false }: { trashMode?: boolean }) {
  const [params, setParams] = useSearchParams();
  const calendarView = !trashMode && params.get("view") === "calendar";

  const apiSearch = trashMode
    ? `?deleted=true&status=not_started,in_progress,completed,archived&page=${params.get("page") ?? 1}`
    : buildApiSearch(params);
  const { data, isLoading } = useTodos(calendarView ? "" : apiSearch);

  const selected = params.get("selected");
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("selected", id);
    else next.delete("selected");
    setParams(next);
  };

  const page = Number(params.get("page") ?? 1);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    setParams(next);
  };

  return (
    <div className="container">
      <header className="page-header">
        <h1>{trashMode ? "Trash" : "TODOs"}</h1>
        <div className="header-actions">
          {trashMode ? (
            <Link to="/" className="btn">
              ← Back
            </Link>
          ) : (
            <>
              <ViewSwitcher calendarView={calendarView} />
              <Link to="/trash" className="btn">
                Trash
              </Link>
              <CreateDialog onCreated={(id) => setSelected(id)} />
            </>
          )}
        </div>
      </header>

      {!trashMode && <FilterBar calendarMode={calendarView} />}

      {calendarView ? (
        <CalendarMonth onOpen={(id) => setSelected(id)} />
      ) : isLoading ? (
        <div className="empty-state">Loading…</div>
      ) : data && data.total === 0 && !trashMode && !hasActiveFilters(params) ? (
        <div className="empty-state">Nothing here — add your first todo below.</div>
      ) : (
        <TodoTable items={data?.items ?? []} onOpen={(id) => setSelected(id)} trashMode={trashMode} />
      )}

      {!trashMode && !calendarView && <QuickAdd />}

      {!calendarView && data && data.total > 0 && (
        <div className="pagination">
          <span>
            {data.total} todo{data.total === 1 ? "" : "s"}
          </span>
          {totalPages > 1 && (
            <>
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ◀
              </button>
              <span>
                Page {page} / {totalPages}
              </span>
              <button
                className="btn-ghost"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                ▶
              </button>
            </>
          )}
        </div>
      )}

      {selected && (
        <DetailPanel
          id={selected}
          onClose={() => setSelected(null)}
          onNavigate={(id) => setSelected(id)}
        />
      )}
    </div>
  );
}

function ViewSwitcher({ calendarView }: { calendarView: boolean }) {
  const [params, setParams] = useSearchParams();
  const setView = (calendar: boolean) => {
    const next = new URLSearchParams(params);
    if (calendar) next.set("view", "calendar");
    else {
      next.delete("view");
      next.delete("month");
    }
    setParams(next);
  };
  return (
    <span className="view-switcher" role="group" aria-label="View">
      <button className={`chip ${!calendarView ? "active" : ""}`} onClick={() => setView(false)}>
        List
      </button>
      <button className={`chip ${calendarView ? "active" : ""}`} onClick={() => setView(true)}>
        Calendar
      </button>
    </span>
  );
}

function hasActiveFilters(params: URLSearchParams): boolean {
  return ["status", "priority", "blocked", "q", "overdue"].some((k) => params.get(k) !== null);
}

/** Notion's add-row pattern: name only, Enter to create (T-5.2). */
function QuickAdd() {
  const create = useCreateTodo();
  const toast = useToast();
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, priority: "medium" },
      {
        onSuccess: () => setName(""),
        onError: (err) => toast.error(describeError(err)),
      }
    );
  };

  return (
    <div className="quick-add">
      <input
        type="text"
        placeholder="+ New — type a name and press Enter"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        aria-label="Quick add todo"
      />
    </div>
  );
}
