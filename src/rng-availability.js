(function exposeRngAvailability(root, factory) {
  const availability = factory();
  if (typeof module === 'object' && module.exports) module.exports = availability;
  if (root) root.NTCRngAvailability = availability;
})(typeof window === 'undefined' ? null : window, () => {
  // Revert this single setting to "available" when the game is ready to return.
  const mode = 'maintenance';

  return Object.freeze({
    mode,
    gameUiEnabled: mode === 'available',
    resolveView(target) {
      return target === 'rng' && mode === 'maintenance' ? 'rngMaintenance' : target;
    }
  });
});
