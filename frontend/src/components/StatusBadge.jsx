const LABELS = {
  pending: 'Pending',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  error: 'Error',
};

export default function StatusBadge({ status }) {
  const cls = `status-badge status-${status || 'pending'}`;
  return <span className={cls}>{LABELS[status] || status || 'Unknown'}</span>;
}
