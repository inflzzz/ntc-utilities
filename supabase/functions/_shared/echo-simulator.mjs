const DAY_MS = 86_400_000;
const TZ = 'America/Sao_Paulo';
const POOL = 10n ** 80n;
const NTC_ODDS_CEILING = 10_000_000n;
const HALF_LIFE_BPS = 25_000n;
const CATEGORY_STEPS = [5, 10, 20];
const CATEGORY_BPS = [250, 500, 1000];
const ROLL_LUCK = [[100_000, 100], [1_000_000, 100], [5_000_000, 150], [10_000_000, 200]];
const TIER_LUCK = { epic: 100, unique: 200, legendary: 500, mythic: 1000, exalted: 2000, glorious: 4000, transcendent: 7500, dimensional: 15000, ntc: 50000 };

function fnv64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(value))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash || 1n;
}

function makeRandom(seed) {
  let state = fnv64(seed);
  return {
    next64() {
      state = BigInt.asUintN(64, state ^ (state >> 12n));
      state = BigInt.asUintN(64, state ^ (state << 25n));
      state = BigInt.asUintN(64, state ^ (state >> 27n));
      return BigInt.asUintN(64, state * 0x2545f4914f6cdd1dn);
    },
    unit() { return Number(this.next64() >> 11n) / 9007199254740992; }
  };
}

function localParts(date, timezone = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: weekdays[get('weekday')] };
}

function localMinuteToUtc(dateKey, minute, timezone = TZ) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  let guess = target;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const fields = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute));
    guess += target - represented;
  }
  return guess;
}

export function scheduleForDay(config, dateKey, weekday = localParts(new Date(`${dateKey}T12:00:00Z`), config.timezone || TZ).weekday) {
  const profile = config.activity_profile || 'legacy_weekly';
  const random = makeRandom(`${config.seed}:${dateKey}:activity-v2`);
  const timezone = config.timezone || TZ;
  const minRate = Number(config.min_actions_per_second ?? 0.2);
  const maxRate = Math.max(minRate, Number(config.max_actions_per_second ?? minRate));
  const makeSegment = (startMinute, durationMinutes, index) => ({
    start: localMinuteToUtc(dateKey, startMinute, timezone),
    end: localMinuteToUtc(dateKey, startMinute + durationMinutes, timezone),
    rate: minRate + random.unit() * (maxRate - minRate),
    key: `${config.id}:${dateKey}:${index}`
  });

  // The BOT is continuously active across local midnight. Each day's roll rate
  // is deterministic, but there is no offline gap between adjacent segments.
  if (profile === 'bot_24_7') {
    const [year, month, day] = dateKey.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
    const nextKey = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`;
    return [{ start: localMinuteToUtc(dateKey, 0, timezone), end: localMinuteToUtc(nextKey, 0, timezone), rate: minRate + random.unit() * (maxRate - minRate), key: `${config.id}:${dateKey}:24x7` }];
  }

  if (profile === 'legacy_weekly') {
    if (!Array.isArray(config.weekdays) || !config.weekdays.includes(weekday) || random.unit() > Number(config.session_chance ?? 1)) return [];
    const minDuration = Number(config.min_session_minutes ?? 20);
    const maxDuration = Math.max(minDuration, Number(config.max_session_minutes ?? minDuration));
    const duration = minDuration + Math.floor(random.unit() * (maxDuration - minDuration + 1));
    const startMin = Number(config.start_minute ?? 0);
    const endMin = Math.max(startMin, Number(config.end_minute ?? 1439));
    const lastStart = Math.max(startMin, Math.min(endMin, 1440 - duration));
    return [makeSegment(startMin + Math.floor(random.unit() * (lastStart - startMin + 1)), duration, 0)];
  }

  // Activity totals and session counts are stored with the profile in the DB;
  // the seeded day key makes the exact plan reproducible across retries.
  const minDaily = Number(config.min_active_minutes_per_day);
  const maxDaily = Number(config.max_active_minutes_per_day);
  const minSessions = Number(config.min_sessions_per_day);
  const maxSessions = Number(config.max_sessions_per_day);
  const minDuration = Number(config.min_session_minutes ?? 30);
  const minGap = Number(config.min_break_minutes ?? 30);
  const maxGap = Math.max(minGap, Number(config.max_break_minutes ?? minGap));
  const dailyMinutes = minDaily + Math.floor(random.unit() * (maxDaily - minDaily + 1));
  const sessionCount = minSessions + Math.floor(random.unit() * (maxSessions - minSessions + 1));
  if (dailyMinutes < sessionCount * minDuration || dailyMinutes + (sessionCount - 1) * minGap > 1440) {
    throw new Error(`Invalid daily activity configuration for ${config.id}`);
  }

  const durations = Array(sessionCount).fill(minDuration);
  let remainingActivity = dailyMinutes - sessionCount * minDuration;
  while (remainingActivity > 0) {
    const index = Math.floor(random.unit() * sessionCount);
    const addition = 1 + Math.floor(random.unit() * Math.min(remainingActivity, 45));
    durations[index] += addition;
    remainingActivity -= addition;
  }
  const gaps = Array(Math.max(0, sessionCount - 1)).fill(minGap);
  let remainingDay = 1440 - dailyMinutes - gaps.reduce((sum, value) => sum + value, 0);
  // Allocate the uncommitted day to lead-in, breaks, and wind-down. The
  // fragmented profile biases the breaks, while regular profiles keep more
  // predictable compact spacing.
  const gapWeights = Array(sessionCount + 1).fill(1);
  if (profile === 'fragmented_daily') for (let i = 1; i < gapWeights.length - 1; i++) gapWeights[i] = 2.2;
  else if (profile === 'regular_daily') { gapWeights[0] = 0.65; gapWeights[gapWeights.length - 1] = 0.65; }
  else if (profile === 'intense_daily') { gapWeights[0] = 1.8; gapWeights[gapWeights.length - 1] = 1.8; }
  const gapParts = Array(gapWeights.length).fill(0);
  for (let minute = 0; minute < remainingDay; minute++) {
    let draw = random.unit() * gapWeights.reduce((sum, value) => sum + value, 0);
    let index = 0;
    while (index < gapWeights.length - 1 && (draw -= gapWeights[index]) >= 0) index++;
    gapParts[index]++;
  }
  const segments = [];
  let minute = gapParts[0];
  for (let index = 0; index < sessionCount; index++) {
    segments.push(makeSegment(minute, durations[index], index));
    minute += durations[index];
    if (index < gaps.length) minute += gaps[index] + gapParts[index + 1];
  }
  return segments;
}

function collectionLuckBps(titles, collectedIds, totalRolls) {
  const collected = new Set(collectedIds);
  const counts = new Map();
  for (const title of titles) if (collected.has(title.id)) counts.set(title.tier, (counts.get(title.tier) || 0) + 1);
  const categoryBonus = tier => {
    const n = counts.get(tier) || 0;
    return CATEGORY_STEPS.reduce((bonus, step, index) => n >= step ? CATEGORY_BPS[index] : bonus, 0);
  };
  const total = collected.size;
  const hasTier = tier => titles.some(title => title.tier === tier && collected.has(title.id));
  let passive = Math.min(10_000, Math.floor(titles.filter(title => collected.has(title.id) && title.tier !== 'ntc').length / 2) * 100 + categoryBonus('basic'));
  let achievements = ROLL_LUCK.reduce((sum, [rolls, bonus]) => BigInt(totalRolls) >= BigInt(rolls) ? sum + bonus : sum, 0);
  for (const [tier, bonus] of Object.entries(TIER_LUCK)) if (hasTier(tier)) achievements += bonus;
  if (total >= 200) achievements -= 5000;
  if (hasTier('ntc')) achievements -= TIER_LUCK.ntc;
  const categories = [...new Set(titles.map(title => title.tier))].filter(tier => !['basic', 'ntc'].includes(tier)).reduce((sum, tier) => sum + categoryBonus(tier), 0);
  passive = Math.max(0, passive);
  const combined = 10_000 + passive + achievements + categories;
  return combined > 10_000 ? BigInt(combined - 10_000) : 0n;
}

function effectiveWeights(titles, collectedIds, totalRolls) {
  const luck = collectionLuckBps(titles, collectedIds, totalRolls);
  titles = titles.filter(title => title.active !== false && (title.acquisition || 'normal') === 'normal');
  if (!titles.length) return new Map();
  const baseWeightTotal = titles.reduce((sum, title) => sum + BigInt(title.base_weight), 0n);
  const base = new Map();
  let used = 0n;
  titles.forEach((title, index) => {
    const raw = BigInt(title.base_weight);
    const weight = baseWeightTotal === POOL ? raw : index === titles.length - 1 ? POOL - used : 1n + (POOL - BigInt(titles.length)) * raw / baseWeightTotal;
    base.set(title.id, weight);
    used += weight;
  });
  if (luck === 0n) return base;
  const rare = titles.filter(title => title.tier !== 'basic');
  const ntc = titles.filter(title => title.tier === 'ntc');
  const basics = titles.filter(title => title.tier === 'basic');
  const anchor = rare.reduce((max, title) => base.get(title.id) > max ? base.get(title.id) : max, 0n);
  const rareBase = rare.reduce((sum, title) => sum + base.get(title.id), 0n);
  const ntcBase = ntc.reduce((sum, title) => sum + base.get(title.id), 0n);
  const rareLift = BigInt(rare.length) * anchor - rareBase;
  const ntcLift = BigInt(ntc.length) * anchor - ntcBase;
  const numerator = POOL - ntcBase * NTC_ODDS_CEILING;
  const denominator = ntcLift * NTC_ODDS_CEILING - rareLift;
  if (numerator <= 0n || denominator <= 0n || !rare.length || !basics.length) return base;
  const lambdaNumerator = numerator * luck;
  const lambdaDenominator = denominator * (luck + HALF_LIFE_BPS);
  const raw = titles.map(title => {
    const baseWeight = base.get(title.id);
    return title.tier === 'basic' ? baseWeight : baseWeight + (anchor - baseWeight) * lambdaNumerator / lambdaDenominator;
  });
  const rawTotal = raw.reduce((sum, weight) => sum + weight, 0n);
  const distributable = POOL - BigInt(titles.length);
  let allocated = 0n;
  const weights = new Map();
  titles.forEach((title, index) => {
    const weight = index === titles.length - 1 ? POOL - allocated : 1n + distributable * raw[index] / rawTotal;
    weights.set(title.id, weight); allocated += weight;
  });
  const maxNtc = POOL / NTC_ODDS_CEILING;
  const ntcWeight = ntc.reduce((sum, title) => sum + weights.get(title.id), 0n);
  if (ntc.length && ntcWeight >= maxNtc) {
    const strongest = ntc[0];
    const excess = ntcWeight - (maxNtc - 1n);
    weights.set(strongest.id, weights.get(strongest.id) - excess);
    weights.set(basics[0].id, weights.get(basics[0].id) + excess);
  }
  return weights;
}

function geometricGap(random, probability) {
  if (!(probability > 0)) return Number.POSITIVE_INFINITY;
  if (probability >= 1) return 1;
  return Math.max(1, Math.floor(Math.log1p(-random.unit()) / Math.log1p(-probability)) + 1);
}

function sampleTitle(random, titles, weights, collected) {
  let total = 0n;
  for (const title of titles) if (!collected.has(title.id)) total += weights.get(title.id);
  const bits = total.toString(2).length;
  const words = Math.ceil(bits / 64);
  const mask = (1n << BigInt(bits)) - 1n;
  let draw;
  do {
    draw = 0n;
    for (let i = 0; i < words; i++) draw = (draw << 64n) | random.next64();
    draw &= mask;
  } while (draw >= total);
  for (const title of titles) {
    if (collected.has(title.id)) continue;
    const weight = weights.get(title.id);
    if (draw < weight) return title;
    draw -= weight;
  }
  return titles.find(title => !collected.has(title.id));
}

function simulateRollBudget({ state, titles, config, rollBudget, at, startAt = at, rate = 1 }) {
  const rollTitles = titles.filter(title => title.active !== false && (title.acquisition || 'normal') === 'normal');
  const collected = new Set(state.collectedIds || []);
  const discoveries = [];
  const seed = `${config.seed}:${state.random_counter || 0}:${state.total_rolls}`;
  const random = makeRandom(seed);
  let remaining = BigInt(Math.max(0, Math.floor(rollBudget)));
  let totalRolls = BigInt(state.total_rolls || 0);
  let consumed = 0n;
  while (remaining > 0n && rollTitles.some(title => !collected.has(title.id))) {
    const weights = effectiveWeights(titles, [...collected], totalRolls.toString());
    const missingWeight = rollTitles.reduce((sum, title) => collected.has(title.id) ? sum : sum + weights.get(title.id), 0n);
    const probability = Number(missingWeight) / Number(POOL);
    const gap = BigInt(geometricGap(random, probability));
    if (gap > remaining) { totalRolls += remaining; consumed += remaining; remaining = 0n; break; }
    totalRolls += gap;
    remaining -= gap;
    consumed += gap;
    const title = sampleTitle(random, rollTitles, weights, collected);
    if (!title) break;
    collected.add(title.id);
    const effectiveOddsDenominator = POOL / weights.get(title.id);
    const discoveryAt = Math.min(at, startAt + Number(consumed) / Math.max(rate, 0.001) * 1000);
    const discovery = { titleId: title.id, name: title.name, tier: title.tier, tierRank: Number(title.tier_rank || 0), catalogVersion: Number(title.catalog_version || 1), roll: totalRolls.toString(), baseDenominator: String(title.base_denominator || (POOL / BigInt(title.base_weight))), effectiveOddsDenominator: effectiveOddsDenominator.toString(), discoveredAt: new Date(discoveryAt).toISOString() };
    discoveries.push(discovery);
  }
  if (!rollTitles.some(title => !collected.has(title.id))) totalRolls += remaining;
  return { totalRolls: totalRolls.toString(), collectedIds: [...collected], discoveries, randomCounter: Number(state.random_counter || 0) + 1 };
}

export function simulateEchoBatch({ state, config, titles, now = Date.now(), maxDays = 14 }) {
  if (!Array.isArray(titles) || !titles.length || new Set(titles.map(title => title.id)).size !== titles.length) throw new Error('O catálogo do simulador está vazio ou contém IDs duplicados.');
  const activation = Date.parse(state.activation_at);
  let cursor = Math.max(activation, Date.parse(state.cursor_at));
  const end = Math.min(Number(now), cursor + maxDays * DAY_MS);
  if (!Number.isFinite(cursor) || !Number.isFinite(activation) || end <= cursor) return { ...state, simulatedTo: new Date(Number.isFinite(cursor) ? cursor : now).toISOString(), newDiscoveries: [], activeSecondsDelta: 0, status: 'offline' };
  let activeMs = 0;
  let fractional = Number(state.fractional_rolls || 0);
  let totalRolls = String(state.total_rolls || '0');
  let collectedIds = [...(state.collected_ids || [])];
  let history = [...(state.discoveries || [])];
  let equipped = state.equipped_title_id || null;
  let best = state.best_title_id || null;
  let randomCounter = Number(state.random_counter || 0);
  const newDiscoveries = [];
  const scanStart = cursor;
  while (cursor < end) {
    const point = localParts(new Date(cursor), config.timezone || TZ);
    const [year, month, day] = point.date.split('-').map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
    const nextKey = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDate.getUTCDate()).padStart(2, '0')}`;
    const nextMidnight = localMinuteToUtc(nextKey, 0, config.timezone || TZ);
    const dayEnd = Math.min(end, Math.max(cursor + 1, nextMidnight));
    const sessions = scheduleForDay(config, point.date, point.weekday);
    for (const session of sessions) {
      const overlapStart = Math.max(cursor, session.start, activation);
      const overlapEnd = Math.min(dayEnd, session.end);
      if (overlapEnd > overlapStart) {
        const seconds = (overlapEnd - overlapStart) / 1000;
        activeMs += overlapEnd - overlapStart;
        const exactRolls = seconds * session.rate + fractional;
        const rolls = Math.floor(exactRolls);
        fractional = exactRolls - rolls;
        const result = simulateRollBudget({ state: { total_rolls: totalRolls, collectedIds, random_counter: randomCounter }, titles, config, rollBudget: rolls, at: overlapEnd, startAt: overlapStart, rate: session.rate });
        totalRolls = result.totalRolls;
        collectedIds = result.collectedIds;
        randomCounter = result.randomCounter;
        for (const discovery of result.discoveries) {
          history.push(discovery);
          newDiscoveries.push(discovery);
          const title = titles.find(item => item.id === discovery.titleId);
          const equippedTitle = titles.find(item => item.id === equipped);
          if (!equipped || (title && equippedTitle && title.tier_rank > equippedTitle.tier_rank)) equipped = discovery.titleId;
          const bestTitle = titles.find(item => item.id === best);
          const currentBestRecord = history.find(item => item.titleId === best);
          const currentBestOdds = BigInt(currentBestRecord?.effectiveOddsDenominator || currentBestRecord?.odds || '0');
          const bestTierRank = Number.isSafeInteger(currentBestRecord?.tierRank) ? currentBestRecord.tierRank : Number(bestTitle?.tier_rank || 0);
          if (!best || (title && (discovery.tierRank > bestTierRank || (discovery.tierRank === bestTierRank && BigInt(discovery.effectiveOddsDenominator) > currentBestOdds)))) best = discovery.titleId;
        }
      }
    }
    cursor = dayEnd;
  }
  const activeSeconds = Number(state.active_seconds || 0) + Math.floor(activeMs / 1000);
  const currentLocal = localParts(new Date(end), config.timezone || TZ);
  const currentSessions = scheduleForDay(config, currentLocal.date, currentLocal.weekday);
  const online = currentSessions.some(session => end >= session.start && end < session.end);
  return {
    ...state,
    cursor_at: new Date(end).toISOString(),
    total_rolls: totalRolls,
    collected_ids: collectedIds,
    discoveries: history,
    equipped_title_id: equipped,
    best_title_id: best,
    active_seconds: activeSeconds,
    fractional_rolls: fractional,
    random_counter: randomCounter,
    newDiscoveries,
    activeSecondsDelta: Math.floor(activeMs / 1000),
    status: online ? 'online' : 'offline',
    processedFrom: new Date(scanStart).toISOString(),
    simulatedTo: new Date(end).toISOString()
  };
}

export function isZeroEchoActivation(entries) {
  const expected = ['nyancat99', 'lulu', 'testandoinfinito', 'AstraUltraMegaLow'];
  if (!Array.isArray(entries) || entries.length !== 4) return false;
  const byName = new Map(entries.map(entry => [String(entry.display_name), entry]));
  return expected.every(name => {
    const entry = byName.get(name);
    return entry && String(entry.total_rolls ?? '0') === '0' && Number(entry.discovered_titles) === 0
      && Number(entry.collection_percentage) === 0 && (!entry.best_title_id) && (!entry.equipped_title_id)
      && Number(entry.playtime_seconds ?? '0') === 0 && Number(entry.active_seconds ?? '0') === 0
      && Number(entry.history_count ?? 0) === 0;
  });
}

export { effectiveWeights };
export const ECHO_SIMULATOR_VERSION = 2;
