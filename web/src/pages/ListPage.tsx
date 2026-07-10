import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCreateTodo, useLogout, useMe, useTodos } from "../api/hooks.js";
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
  // null = the filter combination is unsatisfiable — render empty, don't fetch
  const impossible = apiSearch === null;
  const query = useTodos(calendarView || impossible ? "" : (apiSearch as string), {
    enabled: !calendarView && !impossible,
  });
  const data = impossible
    ? { items: [], total: 0, page: 1, pageSize: 20 }
    : query.data;
  const isLoading = !impossible && query.isLoading;

  const selected = params.get("selected");
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("selected", id);
    else next.delete("selected");
    setParams(next);
  };

  // In-panel navigation trail: following dependency links pushes the current
  // task; ← pops back. Opening from the list starts a fresh trail.
  const [trail, setTrail] = useState<string[]>([]);
  const openFromList = (id: string) => {
    setTrail([]);
    setSelected(id);
  };
  const navigateFromPanel = (id: string) => {
    if (selected) setTrail((t) => [...t, selected]);
    setSelected(id);
  };
  const goBack = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail((t) => t.slice(0, -1));
    setSelected(prev);
  };
  const closePanel = () => {
    setTrail([]);
    setSelected(null);
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
        <div className="header-left">
          <h1>{trashMode ? "Trash" : "TODOs"}</h1>
          {!trashMode && <ViewSwitcher calendarView={calendarView} />}
        </div>
        <div className="header-actions">
          {trashMode ? (
            <Link to="/" className="btn">
              ← Back
            </Link>
          ) : (
            <>
              <UserChip />
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
        <CalendarMonth onOpen={openFromList} />
      ) : isLoading ? (
        <div className="empty-state">Loading…</div>
      ) : data && data.total === 0 && !trashMode && !hasActiveFilters(params) ? (
        <div className="empty-state">Nothing here — add your first todo below.</div>
      ) : (
        <TodoTable items={data?.items ?? []} onOpen={openFromList} trashMode={trashMode} />
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
          onClose={closePanel}
          onNavigate={navigateFromPanel}
          onBack={trail.length > 0 ? goBack : null}
        />
      )}
    </div>
  );
}

/** Initials avatar opening the account menu (name/email + Log out). */
function UserChip() {
  const me = useMe();
  const logout = useLogout();
  if (!me.data) return null;

  const initials = me.data.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  // deterministic muted color per name
  const hash = [...me.data.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const AVATAR_COLORS = ["#2b6a83", "#3a8159", "#8a6d1f", "#9f8767", "#a13c3c", "#57564f"];
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="avatar-btn"
          style={{ background: bg }}
          aria-label={`Account: ${me.data.name}`}
          title={me.data.name}
        >
          {initials}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="end" sideOffset={6}>
          <div className="menu-label">
            <div className="menu-label-name">{me.data.name}</div>
            <div className="hint">{me.data.email}</div>
          </div>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={() => logout.mutate()}>
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Segmented icon toggle (the Notion/Linear pattern), next to the title. */
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
      <button
        className={`view-btn ${!calendarView ? "active" : ""}`}
        onClick={() => setView(false)}
        aria-label="List view"
        title="List view"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 4h8M5.5 8h8M5.5 12h8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="2.5" cy="4" r="1" fill="currentColor" />
          <circle cx="2.5" cy="8" r="1" fill="currentColor" />
          <circle cx="2.5" cy="12" r="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`view-btn ${calendarView ? "active" : ""}`}
        onClick={() => setView(true)}
        aria-label="Calendar view"
        title="Calendar view"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect
            x="2"
            y="3"
            width="12"
            height="11"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M5.5 1.5v2.5M10.5 1.5v2.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
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
