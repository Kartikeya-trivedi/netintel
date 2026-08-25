/** Upload dropzone, processing status, and the parsed report view with entity
 *  highlights.
 *
 *  TODO(Phase 4): wire api.uploadDocument, poll Document.status, and render
 *  <HighlightedText> for the selected document.
 */
export default function Documents() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-console-200">Documents</h1>
      <p className="mt-1 text-sm text-console-400">
        Upload reports, transaction logs, and call records. Extraction runs
        automatically once a file lands.
      </p>
      <div className="mt-6 flex h-48 items-center justify-center rounded-lg border border-dashed border-console-800 text-sm text-console-400">
        Upload dropzone — Phase 4
      </div>
    </div>
  )
}
