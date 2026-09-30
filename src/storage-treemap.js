(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCStorageTreemap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const positive = value => Math.max(0, Number(value) || 0);

  // Divide a size-sorted group near its centre of mass along the longer side.
  function divide(items, bounds) {
    if (!items.length || bounds.width <= 0 || bounds.height <= 0) return [];
    const ordered = items.filter(item => positive(item.value)).sort((a, b) => b.value - a.value);
    const output = [];
    const place = (start, end, area) => {
      if (start >= end || area.width <= 0 || area.height <= 0) return;
      if (end - start === 1) { output.push({ item: ordered[start], ...area }); return; }
      let total = 0;
      for (let i = start; i < end; i++) total += ordered[i].value;
      let cut = start + 1, first = ordered[start].value;
      while (cut < end - 1 && first + ordered[cut].value <= total / 2) first += ordered[cut++].value;
      const fraction = first / total;
      if (area.width >= area.height) {
        const width = area.width * fraction;
        place(start, cut, { x: area.x, y: area.y, width, height: area.height });
        place(cut, end, { x: area.x + width, y: area.y, width: area.width - width, height: area.height });
      } else {
        const height = area.height * fraction;
        place(start, cut, { x: area.x, y: area.y, width: area.width, height });
        place(cut, end, { x: area.x, y: area.y + height, width: area.width, height: area.height - height });
      }
    };
    place(0, ordered.length, bounds);
    return output;
  }

  function layoutTree(tree, options = {}) {
    const nodes = tree?.nodes || [];
    if (!nodes.length) return [];
    const sizeKey = options.sizeKey === 'logical' ? 'logical' : 'allocated';
    const bounds = options.bounds || { x: 0, y: 0, width: 1000, height: 600 };
    const maxDepth = Math.max(1, Math.min(2, Number(options.maxDepth) || 2));
    const minTileArea = Math.max(8, Number(options.minTileArea) || 72);
    const maxChildren = Math.max(8, Math.min(56, Number(options.maxChildren) || 56));
    const maxTiles = 4000;
    const ratio = Math.max(1, Math.min(2, Number(options.pixelRatio) || 1));
    const output = [];

    const compactChain = start => {
      let index = start, traversed = 0, firstName = '';
      while (traversed++ < 128) {
        const node = nodes[index];
        if (node?.type !== 'folder' || node.childCount !== 1 || node.children?.length !== 1) break;
        const child = nodes[node.children[0]];
        if (child?.type !== 'folder') break;
        if (positive(child[sizeKey]) !== positive(node[sizeKey])) break;
        if (!firstName) firstName = child.name;
        index = node.children[0];
      }
      return { index, firstName };
    };

    const visit = (sourceIndex, area, depth, parentIndex) => {
      if (output.length >= maxTiles || area.width * area.height < 1) return;
      const chain = compactChain(sourceIndex), index = chain.index, node = nodes[index];
      if (!node) return;
      const folder = node.type === 'folder';
      const hasChildren = folder && Boolean(node.children?.length) && depth < maxDepth;
      const header = hasChildren && (depth > 0 || index !== sourceIndex) && area.width >= 150 * ratio && area.height >= 75 * ratio ? Math.min(19 * ratio, area.height * .12) : 0;
      const label = index !== sourceIndex && chain.firstName !== node.name ? `${chain.firstName} › ${node.name}` : node.name;
      output.push({ index, sourceIndex, node, label, depth, parentIndex, kind: folder ? 'folder' : 'file', ...area, header, compacted: index !== sourceIndex });
      if (!hasChildren) return;
      const content = { x: area.x + 1, y: area.y + header, width: Math.max(0, area.width - 2), height: Math.max(0, area.height - header - 1) };
      if (content.width * content.height < minTileArea * 2) return;

      const children = node.children.map(childIndex => ({ childIndex, value: positive(nodes[childIndex]?.[sizeKey]) })).filter(item => item.value).sort((a, b) => b.value - a.value);
      const total = positive(node[sizeKey]);
      const shown = [];
      let shownSize = 0;
      for (const child of children) {
        const projectedArea = total ? child.value / total * content.width * content.height : 0;
        if (shown.length >= maxChildren || output.length + shown.length >= maxTiles - 1 || projectedArea < minTileArea) break;
        shown.push(child); shownSize += child.value;
      }
      const remainder = Math.max(0, total - shownSize);
      const items = shown.map(item => ({ ...item, value: item.value }));
      if (remainder > 0) items.push({ aggregate: true, value: remainder, count: Math.max(0, (node.childCount || children.length) - shown.length), parentIndex: index });
      if (!items.length) return;
      for (const tile of divide(items, content)) {
        if (tile.item.aggregate) {
          output.push({ kind: 'aggregate', index: -1, node: { type: 'aggregate', name: 'Outros itens', logical: sizeKey === 'logical' ? remainder : 0, allocated: sizeKey === 'allocated' ? remainder : 0, parentId: node.id, count: tile.item.count }, depth: depth + 1, parentIndex: index, x: tile.x, y: tile.y, width: tile.width, height: tile.height, header: 0 });
        } else visit(tile.item.childIndex, { x: tile.x, y: tile.y, width: tile.width, height: tile.height }, depth + 1, index);
      }
    };
    visit(0, bounds, 0, -1);
    return output;
  }

  function parentTarget(tree) {
    const breadcrumbs = tree?.breadcrumbs || [];
    return breadcrumbs.length > 1 ? Number(breadcrumbs[breadcrumbs.length - 2].id) : -1;
  }

  return { divide, layoutTree, parentTarget };
});
