# NetIntel design system

## Product and direction

NetIntel is an investigation workspace for following a connection back to original records, separating claims from records, testing assumptions, and recording reasoned decisions. The selected finding and its next verification step lead the screen. Case context is available without displacing the evidence.

The visual language uses warm white and ink, neutral charcoal in dark mode, a vermilion primary action, flat reading lists, ruled evidence sections, and restrained semantic colour. The custom N wordmark, source-format stamps, domain marks and functional controls are drawn locally. Colour communicates evidence, status and data; navigation relies on text and position.

## Foundations

| Role             | Light                 | Dark                  |
| ---------------- | --------------------- | --------------------- |
| Canvas / surface | `#f5f5f3` / `#ffffff` | `#151719` / `#1c1f22` |
| Heading / body   | `#202124` / `#4c5058` | `#f3f3f1` / `#c8cbd1` |
| Secondary text   | `#656b74`             | `#a6aeb9`             |
| Primary action   | `#ad3d21`             | `#f29979`             |
| Supported / lead | `#117151` / `#754507` | `#76d4b2` / `#edc477` |

- Inter supplies reading text and controls. Manrope supplies display titles; Noto Sans Devanagari supports local-language text. All fonts are served locally. The browser's root size is preserved so rem-based type and spacing remain correct. Metadata is generally 12px, prose 13-14px, section titles 16-20px and page titles 26-36px. Numbers use tabular figures; source identifiers and commands use monospace.
- Spacing follows a 4px grid. Controls have modest 4-6px corners; dialogs use 10px. Lists and evidence sections use rules rather than nested rounded cards. Shadows distinguish floating controls and dialogs.
- Actions have three weights: solid primary for the next step, outlined secondary for discrete operations, and text for supporting actions. Selected tabs have a simple underline. Inputs, focus and disabled states are shared.
- Records and claims remain distinguishable by words, marks and solid/dashed line styles. Analytical status, integrity, human review and whether evidence counts remain separate concepts.

## Stylesheet ownership

`src/index.css` imports fonts, Tailwind, then the following component layers in order:

1. `src/ui/system.css`: theme tokens, shared primitives, graph and page foundations.
2. `src/ui/workspace.css`: navigation, context bar, footer and shell breakpoints.
3. `src/ui/primitives.css`: domain marks, metadata and source stamps.
4. `src/ui/controls.css`: settings, secondary-control popovers and the keyboard view switcher.
5. `src/components/signals/signals.css`: event queue, record plots and reader.
6. `src/ui/surfaces.css`: finding composition, disclosures, mobile reader flows, loading and final surface styles.

`src/ui/index.tsx` provides buttons, loading shapes, empty states, errors, native dialogs and copy controls. `Symbols.tsx` contains functional controls; `Identity.tsx` contains the wordmark and domain marks. Graph/chart tokens stay hexadecimal because Cytoscape paints to canvas. Both explicit themes and system preference use the same roles.

## Screen hierarchy

- **Public landing (`/`):** an independent charcoal presentation with large display type, warm accent, flat sections and locally drawn evidence diagrams. The three-step Broken Mirror walkthrough changes between connections, source lineage and verification, and is explicitly synthetic. Supported formats, the investigation workflow and candid capability answers follow. CCTV/video, IPDR/device tracing, live integrations and production authentication are identified as missing. The header collapses to a keyboard-operable menu on phones; native disclosures hold the capability answers. The page has its own scoped `src/pages/landing.css` and lazy JavaScript chunk, sets a temporary page title/theme colour and makes no backend requests. The case provider stays mounted while its fetch is disabled, preserving a selected case when visiting home. `/app` opens Findings in live mode and Network in static mode. Existing workspace routes are retained.
- **Shell:** grouped text navigation separates the cross-case investigation from case tools. The 54px desktop / 60px phone context bar holds the active workspace/case, searchable view switcher and Settings. Settings contains theme and the explicit demo-identity notice and selector. Ctrl/Cmd K opens the switcher with the search field focused; arrow keys browse and Enter opens a view. View-name matches precede description matches. Switching between finding views preserves the finding query. Below 1024px navigation opens in a native dialog. Route changes reset the main scroll position. The synthetic-data notice stays visible.
- **Findings:** compact workspace heading, searchable queue, selected people, four evidence totals and one primary Review action. The case-file disclosure contains workspace details, counts and demo reset. Basis & scope contains the full interpretation, assumptions and additional counts. The first explanation starts at about 437px on a 1440px-wide desktop and 599px on a 390px-wide phone. Generated task dates use concise day/month ranges; original source quotations remain exact. Status labels use a filled dot, hollow dot or dash with explicit wording. Finding queue rows retain the people, source counts, hops and caveats without repeating the next action. Reading guide and Display hold secondary evidence controls; originals, fold controls and full count breakdowns remain available. Four keyboard-navigable tabs retain URL state and mounted drafts. On mobile the finding opens first; Browse findings opens a focus-contained queue. Arrow keys browse that modal; Enter selects and focuses the detail.
- **Compare methods:** conclusions and paired results lead; the exact assumptions of both methods are in a labelled disclosure. Comparison tables scroll within their own region.
- **Network:** ranking, graph and evidence inspector form a working layout. A rotation chosen for the available viewport makes better use of the canvas without altering distances or topology. Labels retain a minimum 11px rendered size when zoomed out, with graph overlays reserving their space. Overlapping labels give priority to selected or hovered nodes, then the chosen centrality score; names are revealed on hover or selection and every entity stays available in the keyboard-accessible list. Selecting a person emphasizes their neighbourhood while retaining all positions. Zoom controls sit above the graph. An idle inspector offers the top three actual ranked people as starting points. Type/community colours preserve their data meaning. Graph controls, tracing and simulation remain available.
- **Sources:** searchable library, original reader and extracted mentions. The initial reader offers the newest source and three actual recent sources, hiding the empty entity inspector until a document is selected. Below 1024px selecting a document opens and focuses the reader; All sources restores the selected row. Selecting another case never displays the previous case's document.
- **Overview:** a concise case heading, six inline totals, actual graph, ranked people and links to signals and sources. Selecting a ranked person highlights the graph.
- **Signals:** filtered event queue plus selected reader. Amount/baseline comparisons and plots derive from supplied records. Charts have a labelled vertical scale, a labelled date/time axis, exact-value readout and keyboard-operable bars. Arrow keys move between bars; Enter, Space or click selects and focuses the corresponding source-table row. Table, readout and time axis consistently display IST; the original timestamp remains available on the table cell. Charts and tables scroll locally on narrow screens. Exact values remain in the table. Partial call samples are explicitly labelled. Mobile selection opens and focuses the reader; Back restores the row.
- **Entity dossier:** the original unimplemented state remains explicit.

## Interaction, accessibility and performance

A visible 2px focus ring supports keyboard use. Controls meet at least 24px targets; regular buttons are 34px high. Native dialogs contain focus, support Escape and restore a meaningful target. Case details and secondary-control popovers dismiss on Escape, outside interaction or focus leaving. Popover placement is constrained to the viewport at 320px and wider. The view switcher restores its trigger on Escape and moves focus to main content after navigation; it does not open over another modal. Loading reserves the evidence layout; error states remain visible on mobile and expose retry. Motion is limited to 120-140ms feedback and a waiting indicator; reduced-motion preferences disable sustained movement.

All route pages load on demand, keeping the graph engine out of the initial application bundle. Long commands, comparison tables and timelines scroll locally instead of widening the page. The layout is checked at phone, tablet and desktop widths in both themes.

API modules, routes, `X-Principal`, workspace persistence, query selection, optimistic versions and server messages remain intact. Reason gates and source semantics are preserved. `netintel.theme`, static preview routing and read-only behaviour remain intact. Local verification uses an isolated synthetic database under `.build/redesign-qa`; it does not establish production authentication, a completed entity dossier or a live deployment.

## Refinement review

The ten-point critique and before/after captures are recorded in `.build/premium-review/REVIEW.md`. Source changes are compared against the per-pass snapshot. Route definitions, API modules and package manifests were unchanged during this refinement.
