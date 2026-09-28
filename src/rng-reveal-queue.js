(function exposeRngRevealQueue(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NTCRngRevealQueue = api;
})(typeof globalThis === 'object' ? globalThis : this, function createRngRevealQueue() {
  function collectCandidates(results, afterRoll = 0) {
    const ordered = (Array.isArray(results) ? results : [])
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => Number.isFinite(Number(result?.roll)) && Number(result.roll) > Number(afterRoll || 0))
      .sort((a, b) => Number(a.result.roll) - Number(b.result.roll) || a.index - b.index);
    const candidates = [];

    for (const { result } of ordered) {
      const roll = Number(result.roll);
      if (result.isNew && result.title) {
        candidates.push({
          eventKey: `title:${roll}:${result.title.id || result.title.name}`,
          eventKind: 'title',
          result: { ...result, eventKind: 'title' }
        });
      }

      (Array.isArray(result.specialUnlocks) ? result.specialUnlocks : []).forEach((specialUnlock, index) => {
        if (!specialUnlock) return;
        const itemId = specialUnlock.relicId || specialUnlock.id || specialUnlock.name || index;
        candidates.push({
          eventKey: `special:${roll}:${itemId}:${index}`,
          eventKind: 'special',
          specialUnlock,
          result: {
            title: {
              id: specialUnlock.relicId || specialUnlock.id || `special-${roll}-${index}`,
              name: specialUnlock.name || 'Recompensa especial',
              tier: 'basic',
              tierLabel: specialUnlock.tierLabel || 'Recompensa'
            },
            roll,
            eventKind: 'special',
            currentOdds: '',
            baseOdds: '',
            fragmentReward: String(specialUnlock.fragmentReward || 0)
          }
        });
      });
    }

    return candidates;
  }

  function appendToQueue(queue, item) {
    const reward = item?.result?.specialUnlock;
    const duplicateRelic = item?.eventKind === 'special' && reward?.duplicate && reward.relicId;
    const pendingDuplicate = duplicateRelic && queue.find(queued => queued.eventKind === 'special' && queued.result?.specialUnlock?.duplicate && queued.result.specialUnlock.relicId === reward.relicId);
    if (pendingDuplicate) {
      const repeatCount = Math.max(1, Number(pendingDuplicate.repeatCount) || 1);
      pendingDuplicate.repeatCount = repeatCount + Math.max(1, Number(item.repeatCount) || 1);
      pendingDuplicate.fragmentTotal = (BigInt(pendingDuplicate.fragmentTotal ?? pendingDuplicate.result.specialUnlock.fragmentReward ?? 0) + BigInt(reward.fragmentReward || 0)).toString();
      pendingDuplicate.lastRoll = Number(item.result?.roll) || pendingDuplicate.lastRoll || pendingDuplicate.result.roll;
    } else queue.push(item);
    return queue;
  }

  return Object.freeze({ collectCandidates, appendToQueue });
});
