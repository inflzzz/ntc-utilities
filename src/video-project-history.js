((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCVideoProjectHistory = api;
})(globalThis, () => {
  'use strict';
  function createHistory(limit = 40) {
    let back = [];
    let forward = [];
    return {
      record(before, after) {
        if (before === after) return false;
        back.push(before);
        if (back.length > limit) back.shift();
        forward = [];
        return true;
      },
      undo(current) {
        if (!back.length) return null;
        forward.push(current);
        return back.pop();
      },
      redo(current) {
        if (!forward.length) return null;
        back.push(current);
        return forward.pop();
      },
      clear() { back = []; forward = []; },
      get canUndo() { return back.length > 0; },
      get canRedo() { return forward.length > 0; }
    };
  }
  return Object.freeze({ createHistory });
});
