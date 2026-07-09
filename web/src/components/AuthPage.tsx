import { useState } from "react";
import { ApiError } from "../api/client.js";
import { useLogin, useRegister } from "../api/hooks.js";

/** Combined login / register form — shown whenever there is no session. */
export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useLogin();
  const register = useRegister();
  const pending = login.isPending || register.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const onError = (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_TAKEN") setError("That email is already registered — log in instead?");
        else if (err.code === "INVALID_CREDENTIALS") setError("Wrong email or password.");
        else if (err.code === "VALIDATION") setError("Check the fields: valid email, password of 8+ characters.");
        else setError(err.message);
      } else setError("Something went wrong.");
    };
    if (mode === "login") {
      login.mutate({ email, password }, { onError });
    } else {
      register.mutate({ email, name, password }, { onError });
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>TODOs</h1>
        <p className="hint">
          {mode === "login" ? "Welcome back — log in to the shared list." : "Create an account to join the shared list."}
        </p>

        <div className="field">
          <label htmlFor="a-email">Email</label>
          <input
            id="a-email"
            type="email"
            value={email}
            autoFocus
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {mode === "register" && (
          <div className="field">
            <label htmlFor="a-name">Name</label>
            <input
              id="a-name"
              type="text"
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="a-password">Password</label>
          <input
            id="a-password"
            type="password"
            value={password}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="field-error">{error}</div>}

        <button className="btn btn-primary auth-submit" type="submit" disabled={pending}>
          {mode === "login" ? "Log in" : "Create account"}
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "No account? Register" : "Have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
