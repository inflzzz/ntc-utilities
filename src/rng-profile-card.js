(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const number = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const percent = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format((Number(value) || 0) * 100) + '%';
  const durationHours = seconds => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format((Number(seconds) || 0) / 3600)} h`;

  window.renderRngProfileCard = async (profile, format, renderScale = 1) => {
    const size = format === 'portrait' ? { width: 1080, height: 1350 } : { width: 1920, height: 1080 };
    const scale = Math.max(.5, Math.min(1, Number(renderScale) || 1));
    document.documentElement.style.width = `${Math.round(size.width * scale)}px`;
    document.documentElement.style.height = `${Math.round(size.height * scale)}px`;
    document.body.style.width = `${Math.round(size.width * scale)}px`;
    document.body.style.height = `${Math.round(size.height * scale)}px`;
    const card = $('#profileCard');
    card.style.width = `${size.width}px`;
    card.style.height = `${size.height}px`;
    card.style.transformOrigin = 'top left';
    card.style.transform = scale < 1 ? `scale(${scale})` : 'none';
    card.dataset.format = format === 'portrait' ? 'portrait' : 'landscape';
    const equipped = profile?.identity?.equippedTitle;
    const record = profile?.record;
    const tierId = equipped?.tierId || 'basic';
    card.dataset.tier = tierId;
    $('#cardTierLabel').textContent = (equipped?.tierLabel || 'Básico').toLocaleUpperCase('pt-BR');
    const playerName = profile?.identity?.displayName || 'Viajante';
    const equippedName = equipped?.name || 'Nenhum título equipado';
    $('#cardPlayerName').textContent = playerName;
    $('#cardPlayerName').dataset.length = [...playerName].length > 24 ? 'long' : [...playerName].length > 15 ? 'medium' : 'short';
    $('#cardEquippedTitle').textContent = equippedName;
    $('#cardEquippedTitle').dataset.length = [...equippedName].length > 34 ? 'long' : 'short';
    $('#cardEquippedTier').textContent = equipped ? equipped.tierLabel : 'Uma jornada começa com a primeira descoberta.';
    const equippedArt = equipped?.assetId && window.NTCRngIcons?.definition(equipped.assetId) ? equipped.assetId : `tier-${tierId}`;
    $('#cardCrystal').innerHTML = window.NTCRngIcons?.render(equipped ? equippedArt : 'ui-collection', { size: format === 'portrait' ? 420 : 460, eager: true, animation: 'none' }) || '';
    if (record) {
      $('#cardRecord').hidden = false;
      $('#cardRecord').dataset.tier = record.tierId || 'basic';
      $('#cardRecordTitle').textContent = record.name;
      $('#cardRecordTier').textContent = record.tierLabel;
      const recordOdds = record.acquisitionOdds || record.baseOdds || '';
      $('#cardRecordOdds').textContent = recordOdds;
      $('#cardRecordOdds').dataset.length = [...recordOdds].length > 26 ? 'very-long' : [...recordOdds].length > 18 ? 'long' : 'short';
      $('#cardRecordRoll').textContent = record.roll ? `Obtido na rolagem #${number(record.roll)}` : 'Descoberta registrada';
    } else {
      $('#cardRecord').hidden = true;
    }
    $('#cardRolls').textContent = number(profile?.progress?.totalRolls);
    $('#cardCollection').textContent = `${number(profile?.collection?.collected)} / ${number(profile?.collection?.total)}`;
    $('#cardCompletion').textContent = percent(profile?.collection?.completion);
    $('#cardAppTime').textContent = durationHours(profile?.progress?.appOpenSeconds);
    const index = profile?.luck?.index;
    $('#cardLuckIndex').textContent = index?.ready ? `${number(index.score)} / 100` : 'Calibrando';
    $('#cardLuckDetail').textContent = index?.ready
      ? `${number(index.observed)} Singular+ · ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(index.expected)} esperados · não é percentil`
      : `${number(index?.measuredRolls)} rolagens medidas · não é percentil`;
    await document.fonts.ready;
    await Promise.all([...card.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)));
    await new Promise(resolve => setTimeout(resolve, 60));
    return true;
  };
})();
