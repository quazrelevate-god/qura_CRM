import { signIn } from './actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Wrong username or password.',
  inactive: 'Your account is not active yet. Ask your admin to activate it.',
  missing: 'Enter your username and password.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <form className="login-card" action={signIn}>
        <div className="logo">QURA</div>
        <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>Admissions CRM · sign in</p>
        {error && <div className="notice error">{ERRORS[error] ?? 'Could not sign in.'}</div>}
        <div className="field">
          <label htmlFor="email">Username or email</label>
          <input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} type="submit">Sign in</button>
        <p className="muted small" style={{ marginTop: 14 }}>Forgot your password? Ask your admin to reset it from the Team page.</p>
      </form>
    </div>
  );
}
