import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useMe } from "./api/hooks.js";
import { AuthPage } from "./components/AuthPage.js";
import { ListPage } from "./pages/ListPage.js";
import { ToastProvider } from "./components/toast.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
  },
});

/** No session → the login page; expired session mid-use → back to it. */
function AuthGate() {
  const me = useMe();

  useEffect(() => {
    const onExpired = () => void queryClient.invalidateQueries({ queryKey: ["me"] });
    window.addEventListener("auth-expired", onExpired);
    return () => window.removeEventListener("auth-expired", onExpired);
  }, []);

  if (me.isLoading) return null;
  if (me.isError) return <AuthPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/trash" element={<ListPage trashMode />} />
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </QueryClientProvider>
  );
}
