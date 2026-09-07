// Shows the most recent screenshot with a simple fade-in on update.
// `src` is the full image URL (caller builds it from API_BASE + runId + path).
export default function ScreenshotPane({ src, alt = 'Latest screenshot' }) {
  return (
    <div className="screenshot-pane">
      {src ? (
        <img key={src} src={src} alt={alt} className="screenshot-image" />
      ) : (
        <div className="screenshot-placeholder">No screenshot yet</div>
      )}
    </div>
  );
}
