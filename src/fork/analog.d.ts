/** fork: types for analog.js (pure helpers of the analog view, see there). */
export interface AnalogFilter { type: "path" | "tag" | "prop"; value: string; enabled: boolean; negate?: boolean }
export interface Vec3 { x: number; y: number; z: number }
export interface ViewState { s: number; x: number; y: number }

export function parseProp(body: string): { key: string; values: string[] };
export function propMatches(fm: Record<string, unknown> | undefined | null, key: string, values: string[]): boolean;
export function parseFilterLine(text: string): AnalogFilter | null;
export function formatFilter(f: AnalogFilter): string;
export function filterPredicate<N>(filters: AnalogFilter[], matchOne: (node: N, f: AnalogFilter) => boolean): ((node: N) => boolean) | null;

export function parseSwitch(v: string): boolean | null;
export function parseGraphBlock(source: string): {
	filters: AnalogFilter[]; timeline: boolean; thumbnails: boolean; neighbors: boolean; label: string; errors: string[];
};

export const IMAGE_EXT: string[];
export function linkpathOf(value: unknown): string;
export function isImagePath(p: string): boolean;
export function imageLinkCandidates(fm: Record<string, unknown> | undefined | null, keys: string[]): string[];
export function collectionName(samling: unknown): string;

export interface AtlasGrid { pageSize: number; cellW: number; cellH: number; cols: number; rows: number; perPage: number }
export function atlasGrid(pageSize: number, cellW: number, cellH: number): AtlasGrid;
export function slotRect(slot: number, grid: AtlasGrid): { page: number; x: number; y: number };
export function fitCell(w: number, h: number, cellW: number, cellH: number): { w: number; h: number };
export class SlotAllocator {
	constructor(maxSlots: number);
	alloc(): number | null;
	free(slot: number): void;
	static fromUsed(maxSlots: number, used: number[]): SlotAllocator;
	readonly used: number;
	readonly pagesTouched: number;
}

export const OUTSIDE: number;
export function priorityKeys(pos: Float32Array, count: number, cam: Vec3, inView: (x: number, y: number, z: number) => boolean, out?: Float64Array): Float64Array;
export function loadOrder(keys: ArrayLike<number>, count: number): number[];
export function evictionVictim(keys: ArrayLike<number>, loaded: Iterable<number>, requesterKey: number): number;

export function pickQuad(origin: Vec3, dir: Vec3, fwd: Vec3, right: Vec3, up: Vec3, centres: Float32Array, size: Float32Array, count: number): number;

export function fitScale(iw: number, ih: number, vw: number, vh: number, margin?: number): number;
export function fitState(iw: number, ih: number, vw: number, vh: number, margin?: number): ViewState;
export function clampPan(st: ViewState, iw: number, ih: number, vw: number, vh: number): ViewState;
export function zoomAt(st: ViewState, factor: number, cx: number, cy: number, fit: number, minRel?: number, maxRel?: number): ViewState;
export function neighbourId(ids: string[], current: string, delta: number): string | null;

export const DOCK_DEFAULT: { w: number; h: number };
export const DOCK_MIN: { w: number; h: number };
export const DOCK_MAX_FRAC: { w: number; h: number };
export function clampDockSize(w: number, h: number, viewW: number, viewH: number): { w: number; h: number };
export function dockSizeFromDrag(start: { w: number; h: number }, dx: number, dy: number, viewW: number, viewH: number): { w: number; h: number };
