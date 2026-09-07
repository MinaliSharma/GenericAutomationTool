import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createProject, listProjects } from '../lib/api';
import StatusBadge from '../components/StatusBadge';

const EMPTY_FORM = { name: '', target_url: '', api_base_url: '', java_repo_path: '' };

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects();
      setProjects(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      await createProject({
        name: form.name.trim(),
        target_url: form.target_url.trim() || undefined,
        api_base_url: form.api_base_url.trim() || undefined,
        java_repo_path: form.java_repo_path.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Projects</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'New Project'}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showForm && (
        <form className="panel form" onSubmit={handleCreate}>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Target URL
            <input
              value={form.target_url}
              onChange={(e) => setForm({ ...form, target_url: e.target.value })}
              placeholder="https://example.com"
            />
          </label>
          <label>
            API Base URL (optional)
            <input
              value={form.api_base_url}
              onChange={(e) => setForm({ ...form, api_base_url: e.target.value })}
              placeholder="https://api.example.com"
            />
          </label>
          <label>
            Java Repo Path (optional)
            <input
              value={form.java_repo_path}
              onChange={(e) => setForm({ ...form, java_repo_path: e.target.value })}
              placeholder="/path/to/java/repo"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Project'}
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet. Create one to get started.</p>
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }) {
  const runs = project.recent_runs || project.runs || [];

  return (
    <div className="panel project-card">
      <div className="project-card-header">
        <Link to={`/projects/${project.id}`} className="project-name-link">
          <h2>{project.name}</h2>
        </Link>
      </div>
      {project.target_url && <div className="muted small">{project.target_url}</div>}
      <div className="project-runs">
        {runs.length === 0 ? (
          <div className="muted small">No runs yet.</div>
        ) : (
          <ul className="run-list">
            {runs.map((run) => (
              <li key={run.id} className="run-list-item">
                <StatusBadge status={run.status} />
                <span className="run-id">Run #{run.id}</span>
                <Link
                  to={run.status === 'running' || run.status === 'pending'
                    ? `/runs/${run.id}/live`
                    : `/runs/${run.id}/report`}
                >
                  {run.status === 'running' || run.status === 'pending' ? 'View live' : 'View report'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link to={`/projects/${project.id}`} className="btn btn-secondary">
        Open test cases
      </Link>
    </div>
  );
}
