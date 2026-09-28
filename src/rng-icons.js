/* Visual-only icon registry for NTC RNG. Keep gameplay data out of this module. */
(() => {
  'use strict';

  const tierCrystals = {
    basic: '<path class="tier-silhouette" d="M32 8 49 22 46 48 32 71 18 48 15 22Z"/><path class="tier-face-light" d="M32 8 15 22 32 34Z"/><path class="tier-face-mid" d="M32 8 49 22 32 34Z"/><path class="tier-face-light" d="M15 22 32 34 18 48Z"/><path class="tier-face-deep" d="M49 22 32 34 46 48Z"/><path class="tier-face-deep" d="M18 48 32 34 32 71Z"/><path class="tier-face-mid" d="M46 48 32 34 32 71Z"/><path class="tier-edge" d="M15 22 32 34 49 22M18 48 32 34 46 48M32 8v63"/><path class="tier-glint" d="m25 18 4-3 4 30-4 5Z"/>',
    epic: '<path class="tier-silhouette" d="M32 6 51 17 58 38 46 59 32 75 18 59 6 38 13 17Z"/><path class="tier-face-light" d="M32 6 13 17 32 27Z"/><path class="tier-face-mid" d="M32 6 51 17 32 27Z"/><path class="tier-face-light" d="M13 17 6 38 25 39 32 27Z"/><path class="tier-face-deep" d="M51 17 58 38 39 39 32 27Z"/><path class="tier-face-mid" d="M6 38 25 39 18 59Z"/><path class="tier-face-light" d="M58 38 39 39 46 59Z"/><path class="tier-face-deep" d="M18 59 25 39 32 75Z"/><path class="tier-face-mid" d="M46 59 39 39 32 75Z"/><path class="tier-edge" d="M13 17 32 27 51 17M6 38 25 39 39 39 58 38M18 59 25 39 32 27 39 39 46 59M32 6v69"/><path class="tier-glint" d="m28 16 4-3 3 30-4 4Z"/>',
    unique: '<path class="tier-silhouette" d="m32 5 9 15 16-4-8 19 9 13-18 5-8 20-8-20-18-5 9-13-8-19 16 4Z"/><path class="tier-face-light" d="m32 5 9 15-9 9-9-9Z"/><path class="tier-face-deep" d="m32 5 9 15 16-4-17 13-8-4Z"/><path class="tier-face-light" d="m23 20-16-4 8 19 16-6Z"/><path class="tier-face-mid" d="m49 39 9 9-18 5-8-19Z"/><path class="tier-face-deep" d="m15 35 17-6-8 24-18-5Z"/><path class="tier-face-light" d="m24 53 8-24 8 24-8 20Z"/><path class="tier-edge" d="m23 20 9 9 9-9m-26 15 17-6 17 10m-25 18 8-29 8 29m-8-48v69"/><path class="tier-glint" d="m28 18 4-4 4 30-4 5Z"/>',
    legendary: '<path class="tier-silhouette" d="M9 25 20 8l12 13L44 8l11 17-6 29-17 20-17-20Z"/><path class="tier-face-light" d="M20 8 32 21 25 34 9 25Z"/><path class="tier-face-mid" d="M44 8 32 21 39 34 55 25Z"/><path class="tier-face-deep" d="M9 25 25 34 15 54Z"/><path class="tier-face-light" d="M55 25 39 34 49 54Z"/><path class="tier-face-mid" d="M25 34 39 34 32 74Z"/><path class="tier-face-deep" d="M15 54 25 34 32 74Z"/><path class="tier-face-light" d="M49 54 39 34 32 74Z"/><path class="tier-edge" d="M20 8 32 21 44 8M9 25 25 34 39 34 55 25M15 54 25 34 32 21 39 34 49 54M32 21v53"/><path class="tier-glint" d="m29 25 4-3 3 28-4 4Z"/>',
    mythic: '<path class="tier-silhouette" d="m32 4 8 15 17-4-8 17 10 13-19 4-8 22-8-22-19-4 10-13-8-17 17 4Z"/><path class="tier-face-light" d="m32 4 8 15-8 8-8-8Z"/><path class="tier-face-mid" d="m32 4 8 15 17-4-17 18-8-6Z"/><path class="tier-face-deep" d="m8 15 17 4 7 8-18 5Z"/><path class="tier-face-light" d="m57 15-17 4-7 8 18 5Z"/><path class="tier-face-mid" d="m14 32 18-5-8 22-19-4Z"/><path class="tier-face-light" d="m50 32-18-5 8 22 19-4Z"/><path class="tier-face-deep" d="m24 49 8-22 8 22-8 22Z"/><path class="tier-edge" d="m24 19 8 8 8-8m-26 13 18-5 18 5m-26 18 8-24 8 24m-8-49v67"/><path class="tier-glint" d="m28 20 4-4 4 29-4 4Z"/>',
    exalted: '<path class="tier-silhouette" d="m7 29 12-9 7 14 6-26 6 26 7-14 12 9-6 27-19 19-19-19Z"/><path class="tier-face-light" d="m7 29 12-9 7 14-7 16Z"/><path class="tier-face-mid" d="m19 20 13-12v26l-6 8Z"/><path class="tier-face-light" d="m32 8 13 12-7 14-6-8Z"/><path class="tier-face-deep" d="m45 20 12 9-6 21-7-16-6-4Z"/><path class="tier-face-mid" d="m19 50 13-16 13 16-13 25Z"/><path class="tier-face-deep" d="m7 29 19 5-7 16Z"/><path class="tier-face-light" d="m57 29-19 5 7 16Z"/><path class="tier-edge" d="m19 20 13 14 13-14M7 29l19 5h12l19-5M19 50l13-16 13 16m-13-42v67"/><path class="tier-glint" d="m29 17 4-4 4 28-4 5Z"/>',
    glorious: '<path class="tier-silhouette" d="m32 5 7 12 14-4-4 14 12 7-12 7 4 14-14-4-7 13-7-13-14 4 4-14-12-7 12-7-4-14 14 4Z"/><path class="tier-face-light" d="m32 5 7 12-7 10-7-10Z"/><path class="tier-face-mid" d="m39 17 14-4-4 14-17 0Z"/><path class="tier-face-light" d="m53 13 8 21-12-7Z"/><path class="tier-face-deep" d="m49 28 12 6-12 7-17-7Z"/><path class="tier-face-mid" d="m49 41 4 14-14-4-7-13Z"/><path class="tier-face-light" d="m39 51-7 13-7-13 7-13Z"/><path class="tier-face-deep" d="m25 51-14 4 4-14 17-3Z"/><path class="tier-face-light" d="m15 41  -4-7 12-6 9 12Z"/><path class="tier-edge" d="m25 17 7 10 7-10m-24 11 17 4 17-5m-24 14 7-17 7 17m-7-41v59"/><path class="tier-glint" d="m29 17 3-4 4 29-3 4Z"/>',
    transcendent: '<path class="tier-silhouette" d="m32 3 10 14-4 12 15 14-12 10-3 12-6 13-6-13-3-12-12-10 15-14-4-12Z"/><path class="tier-face-light" d="m32 3 10 14-10 9-10-9Z"/><path class="tier-face-mid" d="m42 17-4 12 15 14-15-2-6-15Z"/><path class="tier-face-deep" d="m22 17 4 12-15 14 15-2 6-15Z"/><path class="tier-face-light" d="m38 29 15 14-12 10-9-25Z"/><path class="tier-face-mid" d="m26 29-15 14 12 10 9-25Z"/><path class="tier-face-deep" d="m23 53 9-25 9 25-3 12-6 13-6-13Z"/><path class="tier-edge" d="m22 17 10 9 10-9m-31 24 15 2 16-2 15-2M23 53l9-27 9 27m-9-50v75"/><path class="tier-glint" d="m29 15 4-3 4 35-4 5Z"/>',
    dimensional: '<path class="tier-silhouette" d="m21 9 21 7 14 18-9 23-20 17-16-23-2-23Z M42 16 55 10 62 26 51 37 43 31Z"/><path class="tier-face-light" d="m21 9 21 7-9 16-22-7Z"/><path class="tier-face-deep" d="m42 16 14 18-23-2Z"/><path class="tier-face-mid" d="m11 25 22 7-6 42-16-23Z"/><path class="tier-face-light" d="m56 34-9 23-20 17 6-42Z"/><path class="tier-face-deep" d="m11 25 22 7 14 25-20 17-16-23Z"/><path class="tier-face-light" d="m42 16 13-6 7 16-11 11-9-6Z"/><path class="tier-face-deep" d="m51 37 11-11-2 18-11 8Z"/><path class="tier-edge" d="m21 9 21 7 14 18-9 23-20 17-16-23-2-23Zm21 7 9 21m-18-5-6 42m23-19-17-23"/><path class="tier-glint" d="m24 16 4-3 5 27-4 4Z"/>',
    ntc: '<path class="tier-silhouette" d="m32 4 11 14 9-5-3 18 11 11-16 6-2 15-10 15-10-15-2-15-16-6 11-11-3-18 9 5Z"/><path class="tier-face-light" d="m32 4 11 14-11 8-11-8Z"/><path class="tier-face-mid" d="m43 18 9-5-3 18-17-5Z"/><path class="tier-face-deep" d="m21 18-9-5 3 18 17-5Z"/><path class="tier-face-light" d="m15 31 17-5 17 5-6 24-11-2-1 30-10-15-2-15-16-6Z"/><path class="tier-face-deep" d="m49 31 11 11-16 6-6 7-2 30-10-15 11-5Z"/><path class="tier-face-mid" d="m32 26 17 5-6 24-11-2-11 2-6-24Z"/><path class="tier-edge" d="m21 18 11 8 11-8m-28 13 17-5 17 5m-23 24 8-26 8 26m-8-54v59"/><path class="tier-glint" d="m28 17 4-4 4 32-4 5Z"/><path class="tier-star" d="m5 57 2 4 4 2-4 2-2 4-2-4-4-2 4-2Zm51-11 1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5Z"/>'
  };

  const vectorMarks = {
    'achievement-rolls': '<circle cx="12" cy="12" r="8.7"/><path d="M12 6.3v5.9l3.6 2.1"/><path d="M4.5 4.5 6 6m12-1.5L16.5 6"/>',
    'achievement-manual-rolls': '<path d="M5 3.5h14v17H5z"/><path d="m8.5 9 2.2 2.2 4.8-4.8M8.5 15.5h7"/><path d="M8 3.5v-1m8 1v-1"/>',
    'achievement-collection': '<path d="M3.2 7.2h17.6v12.5H3.2z"/><path d="M5.2 4.3h13.6v2.9H5.2zM8 11h8m-8 3.5h5"/><path d="m7 4.3 2-2h6l2 2"/>',
    'achievement-rarities': '<path d="m12 2.5 8.2 5-1.3 9.1L12 21l-6.9-4.4-1.3-9.1 8.2-5Z"/><path d="m12 2.5 0 9.2 6.9 4.9M12 11.7 3.8 7.5m8.2 4.2-6.9 4.9"/>',
    'achievement-luck-milestones': '<path d="m12 2 2.5 6.4L21 11l-6.5 2.6L12 20l-2.5-6.4L3 11l6.5-2.6L12 2Z"/><circle cx="19.5" cy="4.5" r="1"/><circle cx="4.5" cy="19.5" r="1"/>',
    'achievement-events': '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4m9-4v4M3.5 9h17M7.5 13h3m3 0h3m-9 3.5h3"/>',
    'achievement-secrets': '<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.7"/><path d="m17.4 3.4 1.2 2.1 2.1 1.2-2.1 1.2-1.2 2.1-1.2-2.1-2.1-1.2 2.1-1.2 1.2-2.1Z"/>',
    'achievement-achievements': '<circle cx="12" cy="9" r="6.3"/><path d="m8.1 14.1-1 7 4.9-2.6 4.9 2.6-1-7"/><path d="m12 5.5 1 2 2.2.3-1.6 1.6.4 2.2-2-1-2 1 .4-2.2-1.6-1.6 2.2-.3 1-2Z"/>',
    'ui-achievements': '<path d="m12 3 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 3Z"/><path d="m8.4 17.1-.8 4 4.4-2.2 4.4 2.2-.8-4"/>',
    'ui-profile': '<circle cx="12" cy="8" r="3.2"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0Z"/>',
    'ui-history': '<path d="M4.4 8.3A8 8 0 1 1 4 13"/><path d="M4.2 4.5v4.6h4.6M12 7v5l3.2 1.8"/>',
    'ui-collection': '<path d="M3.5 5.5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3h-6z"/><path d="M20.5 5.5h-6a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h6z"/>',
    'ui-online': '<circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z"/>',
    'ui-statistics': '<path d="M4 20V11m5 9V5m5 15v-7m5 7V8"/><path d="M2.5 20.5h19"/>',
    'ui-events': '<path d="M4 7.5h16v13H4z"/><path d="M8 4v6m8-6v6M4 11h16"/><path d="m12 13 1.1 2.2 2.4.3-1.8 1.7.4 2.4-2.1-1.2-2.1 1.2.4-2.4-1.8-1.7 2.4-.3L12 13Z"/>',
    'ui-shop': '<path d="M4 8h16l1.2 12H2.8L4 8Z"/><path d="M8 9V6.5a4 4 0 0 1 8 0V9"/><path d="m8 14 2.2 2.2 5-5"/>',
    'ui-inventory': '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z"/><path d="m3.5 7.2 8.5 4 8.5-4M12 11.5V21"/><path d="m8 5 8 4"/>',
    'ui-updates': '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M15 3.5v4h4M9 12h7m-7 3.5h7"/><circle cx="5" cy="5" r="1.3"/>'
  };

  const definitions = Object.create(null);
  const addVector = (id, label, rarity = 'common', animation = 'none') => {
    definitions[id] = Object.freeze({ id, label, kind: 'vector', mark: vectorMarks[id], rarity, animation });
  };

  const tiers = [
    ['basic', 'Básico', 'common'], ['epic', 'Épico', 'rare'], ['unique', 'Singular', 'epic'],
    ['legendary', 'Lendário', 'legendary'], ['mythic', 'Mítico', 'legendary'], ['exalted', 'Exaltado', 'legendary'],
    ['glorious', 'Glorioso', 'legendary'], ['transcendent', 'Abissal', 'legendary'], ['dimensional', 'Inominável', 'legendary'],
    ['ntc', 'Além do NTC', 'legendary']
  ];
  // Percent offsets center the bright visual mass (not just the outer silhouette) in each canvas.
  const tierArtOffsets = {
    basic: [.605, -1.172], epic: [-2.227, -.391], unique: [-3.32, 1.27], legendary: [.234, 1.27],
    mythic: [1.055, .391], exalted: [.508, 1.367], glorious: [.215, .781], transcendent: [-.82, .488],
    dimensional: [-1.211, .684], ntc: [-3.008, .586]
  };
  const tierAssetNames = { transcendent: 'dimensional', dimensional: 'transcendent' };
  for (const [id, label, rarity] of tiers) {
    definitions[`tier-${id}`] = Object.freeze({ id: `tier-${id}`, label: `Símbolo · ${label}`, kind: 'raster', src: `./assets/rng/ruins/tiers/${tierAssetNames[id] || id}.webp`, rarity, animation: 'none', opticalOffset: tierArtOffsets[id] });
  }

  const illustratedAssets = [
    ['event-rain', 'Evento · Noite do Acaso', 'events/rain.webp', 'rare', 'hover'],
    ['event-eclipse', 'Evento · Noite sem Alvorecer', 'events/eclipse.webp', 'legendary', 'glow'],
    ['event-alignment', 'Evento · Ritual dos Selos', 'events/alignment.webp', 'epic', 'hover'],
    ['event-fragments', 'Evento · Queda de Cinzas', 'events/fragments.webp', 'epic', 'hover'],
    ['set-celestial', 'Conjunto · Relógios da Penitência', 'sets/celestial.webp', 'legendary', 'hover'],
    ['set-echoes', 'Conjunto · Ecos', 'sets/echoes.webp', 'epic', 'pulse'],
    ['shop-fortune-rolls', 'Loja · Tônico do Acaso por rolagens', 'shop/fortune-rolls.webp', 'epic', 'glow'],
    ['shop-fortune-time', 'Loja · Ampulheta do Acaso', 'shop/fortune-time.webp', 'epic', 'glow'],
    ['shop-enhanced-luck', 'Loja · Sorte Maculada', 'shop/enhanced-luck.webp', 'legendary', 'sparkle']
  ];
  for (const [id, label, asset, rarity, animation] of illustratedAssets) {
    definitions[id] = Object.freeze({ id, label, kind: 'raster', src: `./assets/rng/ruins/${asset}`, rarity, animation });
  }

  const achievementCategories = [
    ['rolls', 'Rolagens'], ['manual-rolls', 'Rolagens manuais'], ['collection', 'Coleção'], ['rarities', 'Raridades'],
    ['luck-milestones', 'Marcos de sorte'], ['events', 'Eventos'], ['secrets', 'Segredos'], ['achievements', 'Conquistas']
  ];
  for (const [id, label] of achievementCategories) addVector(`achievement-${id}`, `Categoria · ${label}`, 'rare');
  for (const [id, label] of [
    ['profile', 'Perfil'], ['online', 'Online'], ['history', 'Histórico'], ['collection', 'Coleção'],
    ['achievements', 'Conquistas'], ['statistics', 'Estatísticas'], ['events', 'Eventos'],
    ['shop', 'Loja'], ['inventory', 'Inventário'], ['updates', 'Atualizações']
  ]) addVector(`ui-${id}`, `Navegação · ${label}`, 'rare');

  const relics = [
    ['solar-clock', 'Relógio da Vigília', 'epic', 'hover'], ['lunar-clock', 'Relógio das Horas Mortas', 'epic', 'hover'],
    ['astrolabe', 'Astrolábio de Ferro', 'rare', 'none'], ['twin-core', 'Coração em Par', 'legendary', 'pulse'],
    ['echo-spring', 'Mola de Eco', 'rare', 'hover'], ['fragment-pouch', 'Bolsa de Fragmentos', 'rare', 'none'],
    ['lucky-feather', 'Pena do Acaso', 'epic', 'hover'], ['loose-gear', 'Engrenagem Solta', 'rare', 'rotate'],
    ['torn-pouch', 'Bolsa Remendada', 'common', 'none'], ['rain-comet', 'Estilhaço da Queda', 'epic', 'hover'],
    ['new-moon-seal', 'Selo das Horas Mortas', 'epic', 'hover'], ['eclipse-prism', 'Prisma de Ônix', 'legendary', 'glow'],
    ['cartographers-medal', 'Medalha do Cartógrafo', 'epic', 'hover'], ['atlas-of-possibilities', 'Atlas das Rotas Perdidas', 'legendary', 'legendary']
  ];
  for (const [id, label, rarity, animation] of relics) {
    definitions[`relic-${id}`] = Object.freeze({
      id: `relic-${id}`,
      label,
      kind: 'raster',
      src: `./assets/rng/ruins/relics/${id}.webp`,
      rarity,
      animation
    });
  }
  definitions['reveal-crystal'] = Object.freeze({
    id: 'reveal-crystal',
    label: 'Relíquia de revelação',
    kind: 'raster',
    src: './assets/rng/ruins/reveal/crystal.webp',
    rarity: 'legendary',
    animation: 'legendary'
  });

  const animations = Object.freeze({
    hover: {
      duration: 260,
      easing: 'cubic-bezier(.23,1,.32,1)',
      frames: [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-2px) scale(1.055)' }, { transform: 'translateY(0) scale(1)' }]
    },
    entry: {
      duration: 520,
      easing: 'cubic-bezier(.23,1,.32,1)',
      frames: [{ opacity: 0, transform: 'translateY(6px) scale(.82)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]
    },
    float: {
      duration: 1700,
      easing: 'ease-in-out',
      frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }]
    },
    pulse: {
      duration: 840,
      easing: 'ease-in-out',
      frames: [{ opacity: .72, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1.05)' }, { opacity: .9, transform: 'scale(1)' }]
    },
    glow: {
      duration: 1000,
      easing: 'ease-in-out',
      frames: [{ opacity: .7 }, { opacity: 1 }, { opacity: .86 }]
    },
    sparkle: {
      duration: 1040,
      easing: 'cubic-bezier(.23,1,.32,1)',
      frames: [{ opacity: .55, transform: 'scale(.88) rotate(-8deg)' }, { opacity: 1, transform: 'scale(1.12) rotate(4deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }]
    },
    rotate: {
      duration: 760,
      easing: 'cubic-bezier(.23,1,.32,1)',
      frames: [{ transform: 'rotate(-22deg) scale(.92)' }, { transform: 'rotate(0) scale(1)' }]
    },
    reveal: {
      duration: 1320,
      easing: 'cubic-bezier(.16,1,.3,1)',
      frames: [{ opacity: 0, transform: 'translateY(9px) scale(.7) rotate(-9deg)' }, { opacity: 1, transform: 'translateY(-2px) scale(1.05) rotate(2deg)', offset: .76 }, { opacity: 1, transform: 'translateY(0) scale(1) rotate(0)' }]
    },
    legendary: {
      duration: 1640,
      easing: 'cubic-bezier(.16,1,.3,1)',
      frames: [
        { opacity: 0, transform: 'translateY(12px) scale(.62) rotate(-12deg)', offset: 0 },
        { opacity: 1, transform: 'translateY(-3px) scale(1.13) rotate(3deg)', offset: .58 },
        { opacity: 1, transform: 'translateY(1px) scale(.98) rotate(-1deg)', offset: .82 },
        { opacity: 1, transform: 'translateY(0) scale(1) rotate(0)', offset: 1 }
      ]
    }
  });

  const classToken = value => String(value || '').split(/\s+/).filter(token => /^[a-zA-Z0-9_-]+$/.test(token)).join(' ');
  const escapeAttribute = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function render(id, options = {}) {
    const definition = definitions[id];
    if (!definition) return '';
    const size = Math.max(12, Math.min(512, Number(options.size) || 24));
    const allowedAnimations = new Set(['none', 'hover', ...Object.keys(animations)]);
    const animation = allowedAnimations.has(options.animation || definition.animation) ? options.animation || definition.animation : 'none';
    const classes = ['ntc-rng-icon', classToken(options.className)].filter(Boolean).join(' ');
    const accessible = options.label ? ` role="img" aria-label="${escapeAttribute(options.label)}"` : ' aria-hidden="true"';
    const opticalOffset = definition.opticalOffset ? `;--rng-art-offset-x:${definition.opticalOffset[0]}%;--rng-art-offset-y:${definition.opticalOffset[1]}%` : '';
    const iconStyle = `--rng-icon-size:${size}px${opticalOffset}`;
    const visual = definition.kind === 'vector'
      ? `<svg class="ntc-rng-vector" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${definition.mark}</g></svg>`
      : `<img src="${definition.src}" alt="" draggable="false" decoding="async" loading="${options.eager ? 'eager' : 'lazy'}">`;
    return `<span class="${classes}" data-rng-icon="${definition.id}" data-rng-rarity="${definition.rarity}" data-rng-animation="${animation}" style="${iconStyle}"${accessible}>${visual}</span>`;
  }

  function shouldReduceMotion() {
    const preference = document.documentElement.dataset.rngRevealMotion;
    return preference === 'off' || preference === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  }

  const activeAnimations = new WeakMap();
  function play(element, effect = element?.dataset?.rngAnimation, options = {}) {
    const animation = animations[effect];
    if (!element || !animation || (!options.force && shouldReduceMotion()) || typeof element.animate !== 'function') return null;
    activeAnimations.get(element)?.cancel();
    const instance = element.animate(animation.frames, {
      duration: Math.max(100, Math.min(5000, Number(options.duration) || animation.duration)),
      delay: Math.max(0, Math.min(2000, Number(options.delay) || 0)),
      easing: animation.easing,
      iterations: options.loop === true ? Infinity : 1,
      fill: 'both'
    });
    activeAnimations.set(element, instance);
    return instance;
  }

  function cancel(element) {
    if (!element) return;
    activeAnimations.get(element)?.cancel();
    activeAnimations.delete(element);
  }

  function list() {
    return Object.values(definitions).map(({ id, label, kind, rarity, animation }) => ({ id, label, kind, rarity, animation }));
  }

  window.NTCRngIcons = Object.freeze({ render, play, cancel, list, definition: id => definitions[id] || null });
})();
