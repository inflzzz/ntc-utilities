// Relative to the extracted Essentials_Series_NOX_SOUND root. Never copy masters into Git.
const nature = 'Nature_Essentials_NOX_SOUND/';
const ice = 'Iceland_Packs_NOX_SOUND/Iceland_Flows_NOX_SOUND/';
const sao = 'São_Miguel_Flows_NOX_SOUND/';
const sample = 'Sample_A_Sound_Effect/';
const item = (pack, id, name, category, source, volume, tags = []) => ({ pack, id, name, category, source, volume, tags });
module.exports = [
  item('ambient-essentials', 'rain.light', 'Chuva leve', 'Chuva', nature+'Ambiance_Rain_Calm_Loop_Stereo.wav', 66, ['chuva','leve']),
  item('ambient-essentials', 'rain.heavy', 'Chuva forte', 'Chuva', nature+'Ambiance_Rain_Strong_Loop_Stereo.wav', 57, ['chuva','forte']),
  item('ambient-essentials', 'wind.soft', 'Vento suave', 'Vento', nature+'Ambiance_Wind_Calm_Loop_Stereo.wav', 66),
  item('ambient-essentials', 'fire.fireplace', 'Lareira', 'Fogo', nature+'Ambiance_Firecamp_Medium_Loop_Mono.wav', 56),
  item('ambient-essentials', 'forest.day', 'Floresta e pássaros', 'Natureza', nature+'Ambiance_Forest_Birds_Loop_Stereo.wav', 65),
  item('ambient-essentials', 'forest.night', 'Noite na natureza', 'Natureza', nature+'Ambiance_Night_Loop_Stereo.wav', 68),
  item('ambient-essentials', 'water.river', 'Rio', 'Água', nature+'Ambiance_River_Moderate_Loop_Stereo.wav', 62),
  item('ambient-essentials', 'water.ocean', 'Mar', 'Água', nature+'Ambiance_Sea_Loop_Stereo.wav', 59),
  item('ambient-essentials', 'water.waterfall', 'Cachoeira', 'Água', nature+'Ambiance_Waterfall_Calm_Loop_Stereo.wav', 44),
  item('ambient-essentials', 'insects.cicadas', 'Cigarras', 'Natureza', nature+'Ambiance_Cicadas_Loop_Stereo.wav', 62),
  item('nature', 'rain.leaves', 'Chuva nas folhas', 'Chuva', sample+'Ambiance_Nature_Rain_Calm_Leaves_Loop_Stereo.wav', 67),
  item('nature', 'wind.trees', 'Vento nas árvores', 'Vento', nature+'Ambiance_Wind_Forest_Loop_Stereo.wav', 67),
  item('nature', 'fire.small', 'Fogueira suave', 'Fogo', nature+'Ambiance_Firecamp_Small_Loop_Mono.wav', 66),
  item('nature', 'fire.large', 'Fogueira intensa', 'Fogo', nature+'Ambiance_Fire_Big_Loop_Mono.wav', 50),
  item('nature', 'cave.drips', 'Gotas na caverna', 'Caverna', nature+'Ambiance_Cave_Drips_Loop_Stereo.wav', 58),
  item('nature', 'cave.deep', 'Caverna profunda', 'Caverna', nature+'Ambiance_Cave_Deep_Loop_Stereo.wav', 54),
  item('water', 'water.stream', 'Riacho calmo', 'Água', nature+'Ambiance_Stream_Calm_Loop_Stereo.wav', 60),
  item('water', 'water.stream.iceland', 'Riacho da Islândia', 'Água', ice+'Ambiance_Stream_Light_Skaftafell_Loop_Stereo_01.wav', 58),
  item('water', 'water.river.iceland', 'Rio da Islândia', 'Água', ice+'Ambiance_Stream_Moderate_Seljalandsfoss_Loop_Stereo.wav', 52),
  item('water', 'water.ocean.waves', 'Ondas fortes', 'Água', ice+'Ambiance_Sea_Strong_Vik_Close_Loop_Stereo_02.wav', 42),
  item('water', 'water.ocean.azores', 'Oceano dos Açores', 'Água', sao+'Ambiance_Ocean_Ponta_do_Arnel_Loop_Stereo_02.wav', 48),
  item('water', 'water.waterfall.iceland', 'Cachoeira da Islândia', 'Água', ice+'Ambiance_Waterfall_Big_Skógafoss_Far_Loop_Stereo_02.wav', 44),
  item('water', 'water.waterfall.strong', 'Cachoeira forte', 'Água', nature+'Ambiance_Waterfall_Strong_Loop_Stereo.wav', 42),
  item('water', 'water.hotspring', 'Fonte termal', 'Água', sao+'Ambiance_Hot_Spring_Furnas_Caldeiras_Loop_Stereo_03.wav', 40)
];
