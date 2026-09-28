'use strict';

const { POOL, TIERS, CATALOG_VERSION, oddsLabel } = require('./rng.cjs');

const PROFILE_DATA_VERSION = 1;
const MIN_INDEX_ROLLS = 100;
const MIN_INDEX_EXPECTED_HITS = 5;

function countNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function scaledProbability(value) {
  try { return Number(BigInt(value || '0')) / Number(POOL); } catch { return 0; }
}

function buildLuckIndex(metrics = {}) {
  const sampleRolls = countNumber(metrics.measuredRolls);
  const observed = countNumber(metrics.singularPlusObserved);
  const expected = scaledProbability(metrics.singularPlusExpectedWeight);
  const variance = scaledProbability(metrics.singularPlusVarianceWeight);
  const ready = sampleRolls >= MIN_INDEX_ROLLS && expected >= MIN_INDEX_EXPECTED_HITS;
  const z = ready ? (observed - expected) / Math.sqrt(variance + 1) : null;
  return {
    version: countNumber(metrics.version),
    ready,
    score: ready ? Math.max(0, Math.min(100, Math.round(50 + 10 * z))) : null,
    measuredRolls: sampleRolls,
    threshold: 'Singular+',
    observed,
    expected,
    variance
  };
}

function buildPlayerProfileData(snapshot = {}) {
  const catalog = Array.isArray(snapshot.catalog) ? snapshot.catalog : [];
  const tiers = Array.isArray(snapshot.tiers) ? snapshot.tiers : TIERS;
  const collectedIds = new Set(Array.isArray(snapshot.collectedIds) ? snapshot.collectedIds : []);
  const statistics = snapshot.statistics || {};
  const history = Array.isArray(snapshot.titleHistory) ? snapshot.titleHistory : [];
  const equipped = catalog.find(title => title.id === snapshot.profile?.equippedTitleId && collectedIds.has(title.id));
  const recordTitle = catalog.find(title => title.id === statistics.rarestTitleId && collectedIds.has(title.id));
  const recordHistory = recordTitle ? history.find(item => item.titleId === recordTitle.id) : null;
  const collectionEligible = title => title.collectionEligible !== false && ((title.active !== false && title.acquisition !== 'unobtainable') || collectedIds.has(title.id));
  const collectedForCompletion = catalog.filter(title => collectionEligible(title) && collectedIds.has(title.id)).length;
  const countsByTier = Object.fromEntries(tiers.map(tier => [tier.id, catalog.reduce((count, title) => count + (collectionEligible(title) && title.tier === tier.id && collectedIds.has(title.id) ? 1 : 0), 0)]));
  const luckMetrics = snapshot.luckMetrics || {};
  const rarityByTier = Object.fromEntries(tiers.map(tier => {
    const aggregate = luckMetrics.byTier?.[tier.id] || {};
    return [tier.id, {
      observed: countNumber(aggregate.observed),
      expected: scaledProbability(aggregate.expectedWeight),
      variance: scaledProbability(aggregate.varianceWeight)
    }];
  }));
  const outlier = luckMetrics.bestOutlier;
  const outlierTitle = outlier ? catalog.find(title => title.id === outlier.titleId) : null;
  let outlierOdds = '';
  try { if (outlier?.weight && BigInt(outlier.weight) > 0n) outlierOdds = oddsLabel(BigInt(outlier.weight)); } catch { /* Ignore malformed legacy metadata. */ }

  return {
    version: PROFILE_DATA_VERSION,
    catalogVersion: CATALOG_VERSION,
    source: 'local',
    identity: {
      displayName: snapshot.profile?.displayName || '',
      equippedTitleId: equipped?.id || null,
      equippedTitle: equipped ? { id: equipped.id, name: equipped.name, tierId: equipped.tier, tierLabel: equipped.tierLabel, assetId: equipped.assetId || null, presentationId: equipped.presentationId || null } : null
    },
    record: recordTitle ? {
      titleId: recordTitle.id,
      name: recordHistory?.titleNameAtDiscovery || recordTitle.name,
      tierId: recordHistory?.tierAtDiscovery || recordTitle.tier,
      tierLabel: recordHistory?.tierLabelAtDiscovery || recordTitle.tierLabel,
      assetId: recordTitle.assetId || null,
      presentationId: recordTitle.presentationId || null,
      baseOdds: recordTitle.baseOdds,
      acquisitionOdds: recordHistory?.currentOdds || null,
      roll: recordHistory?.roll || null
    } : null,
    discoveries: history.map(item => {
      const title = catalog.find(candidate => candidate.id === item.titleId);
      if (!title || !collectedIds.has(title.id)) return null;
      return {
        titleId: title.id,
        name: item.titleNameAtDiscovery || title.name,
        tierId: item.tierAtDiscovery || title.tier,
      tierRank: Number.isSafeInteger(item.tierRankAtDiscovery) ? item.tierRankAtDiscovery : (tiers.find(candidate => candidate.id === (item.tierAtDiscovery || title.tier))?.rank ?? 0),
        tierLabel: item.tierLabelAtDiscovery || title.tierLabel,
        catalogVersion: countNumber(item.catalogVersionAtDiscovery) || CATALOG_VERSION,
        assetId: title.assetId || null,
        roll: String(item.roll),
        odds: String(item.currentOdds || ''),
        discoveredAt: item.rolledAt ? new Date(item.rolledAt).toISOString() : null
      };
    }).filter(Boolean),
    collection: {
      collected: collectedForCompletion,
      owned: collectedIds.size,
      total: countNumber(snapshot.totalTitles) || catalog.length,
      completion: (countNumber(snapshot.totalTitles) || catalog.length) ? collectedForCompletion / (countNumber(snapshot.totalTitles) || catalog.length) : 0,
      countsByTier
    },
    progress: {
      totalRolls: countNumber(snapshot.totalRolls),
      appOpenSeconds: countNumber(snapshot.totalAppSeconds),
      automaticRollSeconds: countNumber(snapshot.totalAutoRollSeconds),
      achievementsUnlocked: (snapshot.achievements || []).filter(item => item.unlocked).length,
      achievementsTotal: countNumber(snapshot.achievementsTotal) || (snapshot.achievements || []).length + 2,
      secretsUnlocked: (snapshot.secrets || []).length,
      relicsOwned: countNumber(snapshot.relics?.ownedCount),
      relicsTotal: Array.isArray(snapshot.relics?.catalog) ? snapshot.relics.catalog.length : 0,
      eventsParticipated: countNumber(snapshot.eventsParticipated),
      longestSingularDrought: countNumber(statistics.longestSingularDrought),
      longestSameTitleStreak: countNumber(statistics.longestSameTitleStreak)
    },
    luck: {
      index: buildLuckIndex(luckMetrics),
      rarityByTier,
      bestOutlier: outlierTitle ? {
        titleId: outlierTitle.id,
        name: outlierTitle.name,
        tierId: outlierTitle.tier,
        tierLabel: outlierTitle.tierLabel,
        odds: outlierOdds,
        roll: countNumber(outlier.roll)
      } : null
    }
  };
}

module.exports = { PROFILE_DATA_VERSION, MIN_INDEX_ROLLS, MIN_INDEX_EXPECTED_HITS, buildLuckIndex, buildPlayerProfileData };
