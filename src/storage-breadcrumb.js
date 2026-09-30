(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCStorageBreadcrumb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parts(crumbs, hiddenCount = 0) {
    const count = Math.min(Math.max(0, Math.floor(Number(hiddenCount) || 0)), Math.max(0, crumbs.length - 3));
    if (!count) return crumbs.map(item => ({ kind: 'segment', item }));
    return [
      { kind: 'segment', item: crumbs[0] },
      { kind: 'overflow', items: crumbs.slice(1, count + 1) },
      ...crumbs.slice(count + 1).map(item => ({ kind: 'segment', item })),
    ];
  }

  return { parts };
});
