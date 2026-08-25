/** cytoscape-fcose ships no type declarations. The layout is registered through
 *  cytoscape.use() and configured via the layout options object, so a
 *  module-level shim is all that is needed. */
declare module 'cytoscape-fcose' {
  import type { Ext } from 'cytoscape'
  const fcose: Ext
  export default fcose
}
