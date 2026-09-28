'use strict';

function createManualRollCycleGate() {
  let nextCycleId = 0;
  let activeCycleId = null;
  return Object.freeze({
    begin() {
      if (activeCycleId !== null) return null;
      activeCycleId = ++nextCycleId;
      return activeCycleId;
    },
    complete(cycleId) {
      if (activeCycleId === null || cycleId !== activeCycleId) return false;
      activeCycleId = null;
      return true;
    },
    cancel() {
      if (activeCycleId === null) return false;
      activeCycleId = null;
      return true;
    },
    isBusy() { return activeCycleId !== null; },
    get activeCycleId() { return activeCycleId; }
  });
}

module.exports = { createManualRollCycleGate };
