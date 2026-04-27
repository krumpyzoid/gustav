export function reorderList(
  ids: string[],
  draggedId: string,
  targetId: string,
  edge: 'top' | 'bottom',
): string[] {
  const result = ids.filter((id) => id !== draggedId);
  let toIdx = result.indexOf(targetId);
  if (toIdx === -1) return ids;
  if (edge === 'bottom') toIdx += 1;
  result.splice(toIdx, 0, draggedId);
  return result;
}
