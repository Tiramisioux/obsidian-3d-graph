import type * as THREE from "three";

export interface ColorGroup {
  query: string;
  color: string;
}

export interface Filter {
  type: "path" | "tag";
  value: string;
  enabled: boolean;
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
  /** fork: Obsidian page preview when hovering a note node */
  hoverPreview: boolean;
  /** fork: pull notes along the vertical axis by date */
  timelineLayout: boolean;
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
  /** fork: flatten the graph into a plane facing the camera, rotation locked */
  flat2D: boolean;
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
  labelDistance: 150,
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
  hoverPreview: true,
  timelineLayout: false,
  timelineStrength: 0.08,
  timelineLength: 600,
  timelineNewestTop: false,
  storyline: false,
  timelineGrid: "off",
  flat2D: false,
  useKeyboardControls: true,
  keyboardMoveSpeed: 2.0,
  zoomOnClick: true,
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  centerForce: 0.1,
  repelForce: 10,
  linkForce: 0.01,
  useWasmPhysics: true,
};

export enum NodeType {
  File,
  Tag,
  Attachment,
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
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}
