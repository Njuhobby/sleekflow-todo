import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Login, Register, User as AuthUser } from "@shared/auth-schemas";
import type {
  ActivityList,
  Calendar,
  CreateTodo,
  SetDependencies,
  Todo,
  TodoDetail,
  TodoList,
  UpdateTodo,
} from "@shared/todo-schemas";
import { api } from "./client.js";

/** The session gate: 401 means "show the login page". */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<AuthUser>("/auth/me"),
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Login) =>
      api<AuthUser>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Register) =>
      api<AuthUser>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Cache keys mirror the URL params one-to-one — navigating IS cache addressing. */
export function useTodos(search: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["todos", search],
    queryFn: () => api<TodoList>(`/todos${search}`),
    placeholderData: (prev) => prev, // keep the table stable while refetching
    enabled: opts.enabled ?? true,
  });
}

export function useTodoDetail(id: string | null) {
  return useQuery({
    queryKey: ["todo", id],
    queryFn: () => api<TodoDetail>(`/todos/${id}`),
    enabled: id !== null,
  });
}

export function useActivities(id: string | null) {
  return useQuery({
    queryKey: ["activities", id],
    queryFn: () => api<ActivityList>(`/todos/${id}/activities?pageSize=50`),
    enabled: id !== null,
  });
}

/** Per-day digests for the calendar view (DL-13). */
export function useCalendar(search: string) {
  return useQuery({
    queryKey: ["todos", "calendar", search],
    queryFn: () => api<Calendar>(`/todos/calendar${search}`),
    placeholderData: (prev) => prev,
  });
}

/** Search feeding the dependency picker — server-side q, first 10 hits. */
export function usePickerSearch(q: string) {
  return useQuery({
    queryKey: ["picker", q],
    queryFn: () =>
      api<TodoList>(`/todos?q=${encodeURIComponent(q)}&pageSize=10&sortBy=name&order=asc`),
    enabled: q.trim().length > 0,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["todos"] });
    void qc.invalidateQueries({ queryKey: ["picker"] });
    if (id) {
      void qc.invalidateQueries({ queryKey: ["todo", id] });
      void qc.invalidateQueries({ queryKey: ["activities", id] });
    }
  };
}

export function useCreateTodo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateTodo) =>
      api<Todo>("/todos", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTodo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTodo & { id: string }) =>
      api<TodoDetail>(`/todos/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useSetDependencies() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: SetDependencies & { id: string }) =>
      api<TodoDetail>(`/todos/${id}/dependencies`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useDeleteTodo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/todos/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useRestoreTodo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<Todo>(`/todos/${id}/restore`, { method: "POST" }),
    onSuccess: (todo) => invalidate(todo.id),
  });
}
