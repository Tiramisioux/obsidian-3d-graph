import type * as THREE from "three";

export interface ColorGroup {
  query: string;
  color: string;
}

export interface Filter {
  /** fork: `prop` = frontmatter property, `key=a|b` like the colour groups' `prop:` */
  type: "path" | "tag" | "prop";
  value: string;
  enabled: boolean;
  /** fork: exclude what matches (positive filters are OR-ed, negated ones subtract) */
  negate?: boolean;
}

/** fork: what the filter dropdowns offer (negated = exclude) */
export type FilterKind = "path" | "tag" | "prop" | "!path" | "!tag" | "!prop";
export const FILTER_KINDS: [FilterKind, string][] = [
  ["path", "Path"],
  ["tag", "Tag"],
  ["prop", "Property (key=a|b)"],
  ["!path", "Not path"],
  ["!tag", "Not tag"],
  ["!prop", "Not property"],
];
export const filterKindOf = (f: Filter): FilterKind => (f.negate ? (`!${f.type}` as FilterKind) : f.type);
export function setFilterKind(f: Filter, kind: FilterKind) {
  f.type = kind.replace("!", "") as Filter["type"];
  if (kind.startsWith("!")) f.negate = true;
  else delete f.negate;
}

export enum NodeShape {
  Sphere = "Sphere",
  Cube = "Cube",
  Pyramid = "Pyramid",
  Tetrahedron = "Tetrahedron",
}

export interface Graph3DPluginSettings {
  searchQuery: string;
  showNeighboringNodes: boolean;
  filters: Filter[];
  showAttachments: boolean;
  hideOrphans: boolean;
  showTags: boolean;
  groups: ColorGroup[];
  useThemeColors: boolean;
  colorNode: string;
  colorTag: string;
  colorAttachment: string;
  colorLink: string;
  colorHighlight: string;
  backgroundColor: string;
  nodeSize: number;
  tagNodeSize: number;
  attachmentNodeSize: number;
  linkThickness: number;
  nodeShape: NodeShape;
  tagShape: NodeShape;
  attachmentShape: NodeShape;
  showNodeLabels: boolean;
  showLabelsOnHoverOnly: boolean;
  labelDistance: number;
  labelFadeThreshold: number;
  labelTextSize: number;
  labelTextColorLight: string;
  labelTextColorDark: string;
  labelBackgroundColor: string;
  labelBackgroundOpacity: number;
  labelOcclusion: boolean;
  /** fork: regex removed from file-name labels (e.g. a Zettelkasten timestamp) */
  labelStripPattern: string;
  /** fork: show underscores in labels as spaces */
  labelUnderscoresToSpaces: boolean;
  /** fork: wrap labels at about this many characters per line (0 = one line) */
  labelWrapChars: number;
  /** fork: faint outline round the label pill (0 = none) */
  labelBorderOpacity: number;
  /** fork: label card tinted with its node's colour, at rest (0–1) */
  labelTintOpacity: number;
  /** fork: the same tint while the node/label is hovered (0–1) */
  labelTintHoverOpacity: number;
  /** fork: push notes apart sideways while their labels overlap (share of
   *  the overlap per tick, 0 = off) */
  labelSeparation: number;
  /** fork: Obsidian page preview when hovering a note node */
  hoverPreview: boolean;
  /** fork: the properties block (Egenskaper) in that page preview */
  hoverPreviewProperties: boolean;
  /** fork: pull notes along the vertical axis by date */
  timelineLayout: boolean;
  /** fork: the time axis — up/down (vertical) or left/right (horizontal) */
  timelineAxis: "vertical" | "horizontal";
  /** fork: spread (the network keeps its shape across the axis) or line
   *  (every dated note on one straight line) */
  timelineShape: "spread" | "line";
  /** fork: how hard notes are pulled to their date (0.01–0.5) */
  timelineStrength: number;
  /** fork: length of the time axis in world units */
  timelineLength: number;
  /** fork: newest notes at the top instead of the bottom */
  timelineNewestTop: boolean;
  /** fork: draw a line through the notes in date order */
  storyline: boolean;
  /** fork: week/month frames behind the timeline */
  timelineGrid: "off" | "week" | "month" | "auto";
  /** fork: hovering a week/month frame lights it and its notes up */
  timelineGridHover: boolean;
  /** fork: the in-view switch panel is folded away */
  switchPanelCollapsed: boolean;
  /** fork: flatten the graph into a plane facing the camera, rotation locked */
  flat2D: boolean;
  /** fork: trackpad two-finger drag pans the view (pinch still zooms) */
  trackpadPan: boolean;
  /** fork: notes with an image in frontmatter (`thumbnailKeys`) or image attachments
   *  are drawn as camera-facing thumbnails instead of spheres */
  thumbnails: boolean;
  /** fork: frontmatter keys that hold the image link (`bild: "[[x.jpg]]"`) */
  thumbnailKeys: string[];
  /** fork: thumbnail height in world units */
  thumbnailSize: number;
  /** fork: keep the labels of thumbnail nodes */
  thumbnailLabels: boolean;
  /** fork: GPU atlas pages (2048², 16 MiB each) thumbnails may use */
  thumbnailMaxPages: number;
  /** fork: hover preview as an Obsidian popover, or docked in the lower right */
  hoverPreviewMode: "popover" | "docked";
  /** fork: docked preview size (px), saved when resized */
  dockedPreviewWidth: number;
  dockedPreviewHeight: number;
  /** fork: docked preview folded to its header */
  dockedPreviewCollapsed: boolean;
  /** fork: dated `#<eventTag>` todos become nodes of their own, at their due date */
  showEvents: boolean;
  /** fork: show the node of the tag the graph is filtered on (a project
   *  scope) — every note links to it, which pulls the layout into one knot */
  showScopeTag: boolean;
  /** fork: person notes (`typ: person`) in a tag-filtered view — a person
   *  hub carries its projects' tags but isn't project material */
  showPeople: boolean;
  /** fork: the tag that marks a meeting todo (without #) */
  eventTag: string;
  /** fork: colour of meeting/event nodes */
  colorEvent: string;
  useKeyboardControls: boolean;
  keyboardMoveSpeed: number;
  zoomOnClick: boolean;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  performanceMode: boolean;
  centerForce: number;
  repelForce: number;
  linkForce: number;
  /** fork: rest length of a link (WASM engine `link_distance`, D3 link distance) */
  linkDistance: number;
  useWasmPhysics: boolean;
}

export const DEFAULT_SETTINGS: Graph3DPluginSettings = {
  searchQuery: "",
  showNeighboringNodes: true,
  performanceMode: false,
  filters: [],
  showAttachments: false,
  hideOrphans: false,
  showTags: false,
  groups: [],
  useThemeColors: true,
  colorNode: "#2080F0",
  colorTag: "#9A49E8",
  colorAttachment: "#75B63A",
  colorLink: "#666666",
  colorHighlight: "#FFB800",
  backgroundColor: "#0E0E10",
  nodeSize: 1.5,
  tagNodeSize: 1.0,
  attachmentNodeSize: 1.2,
  linkThickness: 1,
  nodeShape: NodeShape.Sphere,
  tagShape: NodeShape.Tetrahedron,
  attachmentShape: NodeShape.Cube,
  showNodeLabels: true,
  showLabelsOnHoverOnly: false,
  labelDistance: 300, // fork: was 150 — the layout is ~2× wider now (spacing below)
  labelFadeThreshold: 0.8,
  labelTextSize: 2.5,
  labelTextColorLight: "#000000",
  labelTextColorDark: "#ffffff",
  labelBackgroundColor: "#ffffff",
  labelBackgroundOpacity: 0.3,
  labelOcclusion: false,
  labelStripPattern: "",
  labelUnderscoresToSpaces: false,
  labelWrapChars: 22,
  labelBorderOpacity: 0.18,
  labelTintOpacity: 0.15,
  labelTintHoverOpacity: 0.45,
  labelSeparation: 1,
  hoverPreview: true,
  hoverPreviewProperties: false,
  timelineLayout: false,
  timelineAxis: "vertical",
  timelineShape: "spread",
  timelineStrength: 0.08,
  timelineLength: 600,
  timelineNewestTop: false,
  storyline: false,
  timelineGrid: "off",
  timelineGridHover: true,
  switchPanelCollapsed: false,
  flat2D: false,
  trackpadPan: true,
  showEvents: true,
  showScopeTag: false,
  showPeople: false,
  thumbnails: false,
  thumbnailKeys: ["bild"],
  thumbnailSize: 14,
  thumbnailLabels: false,
  thumbnailMaxPages: 7,
  hoverPreviewMode: "popover",
  dockedPreviewWidth: 500,
  dockedPreviewHeight: 680,
  dockedPreviewCollapsed: false,
  eventTag: "röd",
  colorEvent: "#d32a32",
  useKeyboardControls: true,
  keyboardMoveSpeed: 2.0,
  zoomOnClick: true,
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  // fork: spacing for labels — neighbour distance ≈ one label width (~45
  // units for a 22-character line). Was centre 0.1 / repel 10 / link
  // distance 30 (engine default), which packed neighbours ~24 units apart.
  centerForce: 0.02,
  repelForce: 20,
  linkForce: 0.01,
  linkDistance: 50,
  useWasmPhysics: true,
};

export enum NodeType {
  File,
  Tag,
  Attachment,
  /** fork: a dated meeting todo (`#röd` + `[due:: …]`), shown at its own date */
  Event,
}

export interface GraphNode {
  id: string;
  name: string;
  filename?: string;
  type: NodeType;
  tags?: string[];
  content?: string;
  lowerCaseContent?: string;
  __threeObj?: THREE.Object3D;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  /** fork (Event): the note the todo line lives in */
  sourcePath?: string;
  /** fork (Event): the todo's due date/time, epoch ms */
  date?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}
