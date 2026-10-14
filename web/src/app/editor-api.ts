/** Tuval bileşeninin dışarıya açtığı komutlar (kısayollar ve düğmeler için). Stage monte olunca kaydeder. */
export interface EditorApi {
  fit(): void;
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  zoomToSelection(): void;
  actualSize(): void;
  focusItem(id: string): void;
  focusRegion(marker: number): void;
}

const noop = () => {};
export const editorApi: EditorApi = { fit: noop, zoomBy: noop, zoomTo: noop, zoomToSelection: noop, actualSize: noop, focusItem: noop, focusRegion: noop };

export function registerEditorApi(api: Partial<EditorApi>): () => void {
  Object.assign(editorApi, api);
  return () => { for (const k of Object.keys(api) as (keyof EditorApi)[]) (editorApi as unknown as Record<string, unknown>)[k] = noop; };
}
