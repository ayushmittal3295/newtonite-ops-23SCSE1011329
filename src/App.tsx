import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, getToken } from './lib/api';

const queryClient = new QueryClient();
const itemTypes = ['INCIDENT', 'CUSTOMER_ISSUE', 'PAYMENT', 'COMPLIANCE', 'TASK'];
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const statuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED'];
const roles = ['VIEWER', 'MEMBER', 'LEAD', 'ADMIN'];

type Team = {
  id: string;
  name: string;
  description?: string | null;
  members: Array<{ id: string; name: string; email: string; role: string }>;
};

type WorkItem = {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  teamId: string;
  teamName: string;
  creatorName: string;
  assigneeName?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

type WorkItemDetail = WorkItem & {
  comments: Array<{ id: string; content: string; authorName: string; createdAt: string }>;
  activities: Array<{ id: string; action: string; actorName: string; createdAt: string; details?: unknown }>;
  approvals: Array<{ id: string; status: string; approverName: string; createdAt: string; updatedAt: string }>;
};

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const setup = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api<{ setupRequired: boolean }>('/setup/status'),
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const body = await api<{ token: string }>('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('newtonite_token', body.token);
      queryClient.clear();
      navigate('/dashboard');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Newtonite Operations</h1>
        <p className="muted">Your team’s work, moving forward.</p>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button disabled={pending}>{pending ? 'Signing in...' : 'Login'}</button>
        {setup.data?.setupRequired && <p className="muted">New installation? <Link to="/setup">Set up the first account and team</Link></p>}
        {setup.error && <p className="error-box">Could not check database setup status. Try again shortly.</p>}
      </form>
    </div>
  );
}

function SetupPage() {
  const navigate = useNavigate();
  const setup = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api<{ setupRequired: boolean }>('/setup/status'),
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ token: string }>('/setup', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          teamName: form.get('teamName'),
          teamDescription: form.get('teamDescription') || undefined,
        }),
      });
      localStorage.setItem('newtonite_token', result.token);
      queryClient.clear();
      navigate('/dashboard');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Setup failed');
    } finally {
      setPending(false);
    }
  };

  if (setup.isLoading) return <div className="auth-shell">Checking database setup...</div>;
  if (setup.error) return <div className="auth-shell"><div className="error-box">Could not check database setup status.</div></div>;
  if (!setup.data?.setupRequired) return <Navigate to="/login" replace />;

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>Set up Newtonite</h1>
        <p className="muted">Create the first administrator account and operations team.</p>
        <label>Your name<input name="name" minLength={2} maxLength={120} required /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" minLength={12} autoComplete="new-password" required /><small className="muted">Use at least 12 characters.</small></label>
        <label>First team<input name="teamName" minLength={2} maxLength={120} required /></label>
        <label>Team description (optional)<input name="teamDescription" maxLength={500} /></label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button disabled={pending}>{pending ? 'Creating account...' : 'Create admin account'}</button>
        <Link to="/login">Back to login</Link>
      </form>
    </div>
  );
}

function AppNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = () => {
    localStorage.removeItem('newtonite_token');
    queryClient.clear();
    navigate('/login');
  };
  return (
    <nav className="app-nav">
      <Link className="brand" to="/dashboard"><span className="brand-mark">N</span><span>Newtonite <small>OPERATIONS</small></span></Link>
      <div className="nav-links">
        <Link className={location.pathname === '/dashboard' ? 'active' : ''} to="/dashboard">Overview</Link>
        <Link className={location.pathname.startsWith('/work-items') ? 'active' : ''} to="/work-items">Work items</Link>
        <Link className={location.pathname === '/teams' ? 'active' : ''} to="/teams">Teams</Link>
        <span className="nav-divider" />
        <button className="ghost nav-logout" onClick={logout}><span className="avatar-mini">U</span> Sign out</button>
      </div>
    </nav>
  );
}

function PageLayout({ children }: { children: ReactNode }) {
  return <div className="app-frame"><AppNav /><main className="page shell">{children}<footer className="app-footer"><span>Newtonite Operations</span><span>Team workspace · Local instance</span></footer></main></div>;
}

function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<{ stats: { assignedToMe: number; unassignedUrgent: number; awaitingMyApproval: number; totalWorkItems: number; statusCounts: Array<{ status: string; count: number }> } }>('/dashboard'),
  });
  const workQuery = useQuery({
    queryKey: ['work-items', 'recent'],
    queryFn: () => api<{ items: WorkItem[] }>('/work-items?limit=6'),
  });
  if (isLoading || workQuery.isLoading) return <PageLayout><p>Loading dashboard...</p></PageLayout>;
  if (error || workQuery.error) return <PageLayout><div className="error-box">Unable to load dashboard. Please refresh.</div></PageLayout>;

  const items = workQuery.data?.items ?? [];
  const statusCounts = statuses.map((status) => ({
    status,
    count: data?.stats.statusCounts.find((entry) => entry.status === status)?.count ?? 0,
  }));
  const activeCount = statusCounts.filter((entry) => !['CLOSED', 'RESOLVED'].includes(entry.status)).reduce((sum, entry) => sum + entry.count, 0);

  return (
    <PageLayout>
      <header className="topbar">
        <div><div className="eyebrow">WORKSPACE OVERVIEW</div><h2>Good to see you.</h2><small className="muted">Here’s what’s happening across your operations today.</small></div>
        <Link className="button-link" to="/work-items/new"><span className="button-plus">+</span> New work item</Link>
      </header>
      <div className="stats-grid">
        <Card tone="blue" marker="MY" label="Assigned to me" value={String(data?.stats.assignedToMe ?? 0)} helper="Items in your queue" />
        <Card tone="red" marker="!" label="Urgent unassigned" value={String(data?.stats.unassignedUrgent ?? 0)} helper="Needs an owner" />
        <Card tone="amber" marker="✓" label="Awaiting approval" value={String(data?.stats.awaitingMyApproval ?? 0)} helper="Needs your review" />
        <Card tone="green" marker="↗" label="Active workload" value={String(activeCount)} helper={`${data?.stats.totalWorkItems ?? 0} total tracked`} />
      </div>
      <div className="dashboard-grid">
        <section className="panel status-panel">
          <div className="section-heading"><div><div className="eyebrow">PIPELINE</div><h3>Work by status</h3></div><Link className="subtle-link" to="/work-items">Explore all <span>→</span></Link></div>
          <div className="status-chart">
            {statusCounts.map(({ status, count }) => {
              const percent = data?.stats.totalWorkItems ? Math.max(count ? 6 : 0, Math.round(count / data.stats.totalWorkItems * 100)) : 0;
              return <div className="status-chart-row" key={status}>
                <div className="status-chart-label"><StatusBadge status={status} /><strong>{count}</strong></div>
                <div className="meter"><span className={`meter-fill meter-${status.toLowerCase()}`} style={{ width: `${percent}%` }} /></div>
              </div>;
            })}
          </div>
        </section>
        <section className="panel focus-panel">
          <div className="eyebrow">FOCUS FOR TODAY</div>
          <h3>Keep work moving</h3>
          <p className="muted">Pick up an unassigned item or review a pending approval to keep your team on track.</p>
          <div className="focus-actions">
            <Link to="/work-items?priority=URGENT"><span className="focus-dot red-dot" />Urgent queue<span>→</span></Link>
            <Link to="/work-items?status=AWAITING_APPROVAL"><span className="focus-dot amber-dot" />Approvals<span>→</span></Link>
          </div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="section-heading"><div><div className="eyebrow">LATEST UPDATES</div><h3>Recent work</h3></div><Link className="subtle-link" to="/work-items">View all work items <span>→</span></Link></div>
        <WorkItemList items={items} />
      </section>
    </PageLayout>
  );
}

function Card({ label, value, helper, tone, marker }: { label: string; value: string; helper: string; tone: string; marker: string }) {
  return <div className={`card metric-card metric-${tone}`}>
    <div className="metric-head"><small>{label}</small><span className="metric-marker">{marker}</span></div>
    <strong>{value}</strong><span className="metric-helper">{helper}</span>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><i />{status.replaceAll('_', ' ')}</span>;
}

function WorkItemList({ items }: { items: WorkItem[] }) {
  if (!items.length) return <div className="empty-state"><span className="empty-icon">＋</span><strong>No work items yet</strong><p className="muted">Create your first item to start tracking team operations.</p><Link className="button-link" to="/work-items/new">Create work item</Link></div>;
  return (
    <div className="list work-list">
      <div className="work-list-head"><span>Work item</span><span>Team</span><span>Status</span><span>Priority</span><span>Owner</span><span /></div>
      {items.map((item) => (
        <Link key={item.id} to={`/work-items/${item.id}`} className="work-row">
          <div className="work-title-cell"><span className={`type-icon type-${item.type.toLowerCase()}`}>{item.type === 'INCIDENT' ? '!' : item.type === 'PAYMENT' ? '$' : item.type === 'COMPLIANCE' ? '✓' : '•'}</span><span><strong>{item.title}</strong><small>{item.type.replaceAll('_', ' ')} · {new Date(item.updatedAt).toLocaleDateString()}</small></span></div>
          <span className="team-cell">{item.teamName}</span>
          <StatusBadge status={item.status} />
          <span className={`priority-label priority-${item.priority.toLowerCase()}`}><i />{item.priority}</span>
          <span className="owner-cell">{item.assigneeName ? <><span className="owner-avatar">{item.assigneeName.slice(0, 1).toUpperCase()}</span>{item.assigneeName}</> : <span className="unassigned-label">Unassigned</span>}</span>
          <span className="row-arrow">→</span>
        </Link>
      ))}
    </div>
  );
}

function WorkItemsPage() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? '');
  const [priority, setPriority] = useState(() => searchParams.get('priority') ?? '');
  const [teamId, setTeamId] = useState(() => searchParams.get('teamId') ?? '');
  const [page, setPage] = useState(1);
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ teams: Team[] }>('/teams') });
  const params = new URLSearchParams({ limit: '50', page: String(page) });
  if (search.trim()) params.set('search', search.trim());
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (teamId) params.set('teamId', teamId);
  const query = useQuery({
    queryKey: ['work-items', search, status, priority, teamId, page],
    queryFn: () => api<{ items: WorkItem[]; pagination: { total: number; pages: number } }>(`/work-items?${params}`),
  });

  return (
    <PageLayout>
      <header className="topbar"><div><h2>Work items</h2><small className="muted">Search and filter team work</small></div><Link className="button-link" to="/work-items/new">Create work item</Link></header>
      <section className="panel filter-grid">
        <label>Search<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Title or description" /></label>
        <label>Team<select value={teamId} onChange={(event) => { setTeamId(event.target.value); setPage(1); }}><option value="">All my teams</option>{(teams.data?.teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map((entry) => <option key={entry} value={entry}>{entry.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}><option value="">All priorities</option>{priorities.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
      </section>
      <section className="panel">
        {query.isLoading && <p>Loading work items...</p>}
        {query.error && <div className="error-box">Unable to load work items.</div>}
        {query.data && <><p className="muted">{query.data.pagination.total} work item(s)</p><WorkItemList items={query.data.items} /><div className="pagination"><button className="ghost" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span className="muted">Page {page} of {query.data.pagination.pages}</span><button className="ghost" disabled={page >= query.data.pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button></div></>}
      </section>
    </PageLayout>
  );
}

function CreateWorkItemPage() {
  const navigate = useNavigate();
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api<{ teams: Team[] }>('/teams') });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<{ item: WorkItem }>('/work-items', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          title: form.get('title'),
          description: form.get('description'),
          type: form.get('type'),
          priority: form.get('priority'),
          teamId: form.get('teamId'),
          dueDate: form.get('dueDate') ? new Date(String(form.get('dueDate'))).toISOString() : null,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['work-items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/work-items/${response.item.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create work item');
    } finally {
      setPending(false);
    }
  };

  return (
    <PageLayout>
      <header className="topbar"><div><h2>Create work item</h2><small className="muted">Add an operational issue or task</small></div><Link to="/work-items">Cancel</Link></header>
      <form className="panel form-grid" onSubmit={submit}>
        <label>Title<input name="title" minLength={3} maxLength={160} required /></label>
        <label>Team<select name="teamId" required disabled={teams.isLoading || !teams.data?.teams.length}><option value="">Select a team</option>{(teams.data?.teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Type<select name="type" required>{itemTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Priority<select name="priority" required>{priorities.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
        <label className="full-width">Description<textarea name="description" minLength={10} maxLength={4000} rows={5} required /></label>
        <label>Due date (optional)<input name="dueDate" type="datetime-local" /></label>
        {teams.error && <div className="error-box full-width">Unable to load your teams.</div>}
        {!teams.isLoading && !teams.error && !teams.data?.teams.length && <p className="muted full-width">You need a team before creating work items. Ask an administrator to add you to a team.</p>}
        {error && <div className="error-box full-width" role="alert">{error}</div>}
        <button className="form-submit" disabled={pending || !teams.data?.teams.length}>{pending ? 'Creating...' : 'Create work item'}</button>
      </form>
    </PageLayout>
  );
}

function TeamsPage() {
  const queryClient = useQueryClient();
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => api<{ teams: Team[] }>('/teams') });
  const [selectedTeam, setSelectedTeam] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(formElement);
    try {
      await api('/teams', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || undefined }) });
      formElement.reset();
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setMessage('Team created.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create team');
    } finally {
      setPending(false);
    }
  };
  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTeam) return;
    const formElement = event.currentTarget;
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(formElement);
    try {
      await api(`/teams/${selectedTeam}/members`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('memberName'),
          email: form.get('memberEmail'),
          password: form.get('memberPassword'),
          role: form.get('role'),
        }),
      });
      formElement.reset();
      await queryClient.invalidateQueries({ queryKey: ['teams'] });
      setMessage('Team member created. Share the login details securely.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not add member');
    } finally {
      setPending(false);
    }
  };

  return (
    <PageLayout>
      <header className="topbar"><div><h2>Teams</h2><small className="muted">Manage teams and team access</small></div></header>
      {teamsQuery.isLoading && <p>Loading teams...</p>}
      {teamsQuery.error && <div className="error-box">Unable to load teams.</div>}
      <div className="details-grid">
        <section className="panel">
          <h3>Your teams</h3>
          {(teamsQuery.data?.teams ?? []).map((team) => <div className="team-card" key={team.id}><strong>{team.name}</strong><p className="muted">{team.description || 'No description'}</p><ul>{team.members.map((member) => <li key={member.id}>{member.name} · {member.role}</li>)}</ul></div>)}
          {!teamsQuery.isLoading && !teamsQuery.data?.teams.length && <p className="muted">No team memberships found.</p>}
        </section>
        <div className="stack">
          <form className="panel stack" onSubmit={createTeam}>
            <h3>Create team</h3><label>Team name<input name="name" minLength={2} maxLength={120} required /></label><label>Description (optional)<input name="description" maxLength={500} /></label><button disabled={pending}>Create team</button>
          </form>
          <form className="panel stack" onSubmit={addMember}>
            <h3>Add a member</h3>
            <label>Team<select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)} required><option value="">Select team</option>{(teamsQuery.data?.teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
            <label>Name<input name="memberName" minLength={2} required /></label>
            <label>Email<input name="memberEmail" type="email" required /></label>
            <label>Temporary password<input name="memberPassword" type="password" minLength={12} autoComplete="new-password" required /></label>
            <label>Role<select name="role">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <button disabled={pending || !selectedTeam}>Create member account</button>
          </form>
        </div>
      </div>
      {message && <div className="success-box" role="status">{message}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
    </PageLayout>
  );
}

function WorkItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['work-item', id],
    queryFn: () => api<{ item: WorkItemDetail }>(`/work-items/${id}`),
  });
  const item = data?.item;

  const claim = useMutation({
    mutationFn: () => api(`/work-items/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: item?.version }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      await queryClient.invalidateQueries({ queryKey: ['work-items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Could not claim item'),
  });

  const submitTransition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || !status) return;
    setPending(true);
    setError('');
    try {
      await api(`/work-items/${item.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ toStatus: status, comment: comment.trim() || undefined, expectedVersion: item.version }),
      });
      setStatus('');
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      await queryClient.invalidateQueries({ queryKey: ['work-items'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not update status');
    } finally {
      setPending(false);
    }
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || !comment.trim()) return;
    setPending(true);
    setError('');
    try {
      await api(`/work-items/${item.id}/comments`, { method: 'POST', body: JSON.stringify({ content: comment.trim() }) });
      setComment('');
      await queryClient.invalidateQueries({ queryKey: ['work-item', id] });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not post comment');
    } finally {
      setPending(false);
    }
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item) return;
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.get('title'),
          description: form.get('description'),
          type: form.get('type'),
          priority: form.get('priority'),
          version: item.version,
        }),
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['work-item', id] });
      await queryClient.invalidateQueries({ queryKey: ['work-items'] });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not edit work item');
    } finally {
      setPending(false);
    }
  };

  if (isLoading) return <PageLayout><p>Loading work item...</p></PageLayout>;
  if (queryError || !item) return <PageLayout><div className="error-box">Unable to load this work item. <Link to="/work-items">Back to work items</Link></div></PageLayout>;
  const allowedTransitions: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS', 'AWAITING_APPROVAL'],
    IN_PROGRESS: ['AWAITING_APPROVAL', 'RESOLVED'],
    AWAITING_APPROVAL: ['RESOLVED', 'OPEN'],
    RESOLVED: ['CLOSED'],
    CLOSED: [],
  };

  return (
    <PageLayout>
      <header className="topbar"><div><h2>{item.title}</h2><small className="muted">{item.teamName} · {item.status.replaceAll('_', ' ')}</small></div><Link to="/work-items">Back to work items</Link></header>
      <div className="details-grid">
        <section className="panel">
          <div className="section-heading"><h3>Overview</h3><button className="ghost compact-button" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel edit' : 'Edit details'}</button></div>
          {editing ? <form className="stack" onSubmit={submitEdit}>
            <label>Title<input name="title" defaultValue={item.title} minLength={3} maxLength={160} required /></label>
            <label>Description<textarea name="description" defaultValue={item.description} minLength={10} maxLength={4000} rows={5} required /></label>
            <label>Type<select name="type" defaultValue={item.type}>{itemTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Priority<select name="priority" defaultValue={item.priority}>{priorities.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
            <button disabled={pending}>{pending ? 'Saving...' : 'Save details'}</button>
          </form> : <>
            <p>{item.description}</p>
            <div className="meta-strip"><span>Type: {item.type.replaceAll('_', ' ')}</span><span>Priority: {item.priority}</span><span>Assignee: {item.assigneeName ?? 'Unassigned'}</span><span>Created by: {item.creatorName}</span><span>Version: {item.version}</span>{item.dueDate && <span>Due: {new Date(item.dueDate).toLocaleString()}</span>}</div>
          </>}
          {!item.assigneeName && item.status !== 'CLOSED' && <button className="secondary-button" disabled={claim.isPending} onClick={() => claim.mutate()}>{claim.isPending ? 'Claiming...' : 'Claim this work item'}</button>}
        </section>
        <form className="panel stack" onSubmit={submitTransition}>
          <h3>Workflow</h3>
          {allowedTransitions[item.status]?.length ? <>
            <label>Move to<select value={status} onChange={(event) => setStatus(event.target.value)} required><option value="">Select next status</option>{allowedTransitions[item.status].map((entry) => <option value={entry} key={entry}>{entry.replaceAll('_', ' ')}</option>)}</select></label>
            <label>Optional status comment<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} /></label>
            <button disabled={pending || !status}>{pending ? 'Updating...' : 'Apply transition'}</button>
          </> : <p className="muted">This work item is closed.</p>}
        </form>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <section className="panel">
        <h3>Comments</h3>
        <div className="stack">{item.comments.map((entry) => <div key={entry.id} className="comment-box"><strong>{entry.authorName}</strong><small className="muted">{new Date(entry.createdAt).toLocaleString()}</small><p>{entry.content}</p></div>)}</div>
        <form className="stack comment-form" onSubmit={submitComment}><label>Add a comment<textarea value={comment} onChange={(event) => setComment(event.target.value)} minLength={1} maxLength={2000} required /></label><button disabled={pending || !comment.trim()}>{pending ? 'Posting...' : 'Post comment'}</button></form>
      </section>
      <section className="panel">
        <h3>Activity</h3>
        <div className="stack">{item.activities.map((entry) => <div key={entry.id} className="activity-row"><strong>{entry.action.replaceAll('_', ' ')}</strong><span>{entry.actorName}</span><small className="muted">{new Date(entry.createdAt).toLocaleString()}</small></div>)}</div>
      </section>
      {item.approvals.length > 0 && <section className="panel">
        <h3>Approval history</h3>
        <div className="stack">{item.approvals.map((approval) => <div key={approval.id} className="activity-row"><strong>{approval.status}</strong><span>{approval.approverName}</span><small className="muted">{new Date(approval.updatedAt).toLocaleString()}</small></div>)}</div>
      </section>}
    </PageLayout>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppShell() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/work-items" element={<ProtectedRoute><WorkItemsPage /></ProtectedRoute>} />
        <Route path="/work-items/new" element={<ProtectedRoute><CreateWorkItemPage /></ProtectedRoute>} />
        <Route path="/work-items/:id" element={<ProtectedRoute><WorkItemDetailPage /></ProtectedRoute>} />
        <Route path="/teams" element={<ProtectedRoute><TeamsPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={getToken() ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider>;
}
