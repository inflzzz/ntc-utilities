# NTC RNG icon assets

The visual registry lives in `src/rng-icons.js`; presentation and motion rules live in `src/rng-icons.css`. The registry is deliberately separate from `src/rng.cjs`: changing art, rarity presentation, or animation does not change roll weights, saved collection data, or rewards.

## Current asset map

| Asset ID | Object type | Replacement file | What it depicts and where it appears |
| --- | --- | --- | --- |
| `tier-*` (10) | Rarity insignia / faceted stone | `src/assets/rng/ruins/tiers/<tier>.webp` | One distinct silhouette per rarity; collection, history, filters, result/reveal cards and the development atelier. |
| `event-*` (4) | Ritual/event emblem | `src/assets/rng/ruins/events/*.webp` | Noite do Acaso, Noite sem Alvorecer, Ritual dos Selos and Queda de Cinzas; shared by schedule cards and event reward details. |
| `ui-history`, `ui-collection` (2) | Archive/book marks | `src/assets/rng/ruins/interface/*.webp` | Separate artwork for the Histórico and Coleção section tabs. |
| `set-*` (2) | Paired relic composition | `src/assets/rng/ruins/sets/*.webp` | Relógios da Penitência and Ecos; set-completion cards. |
| `shop-*` (3) | Permanent charm, vial and hourglass | `src/assets/rng/ruins/shop/*.webp` | Sorte Maculada, Tônico do Acaso and Ampulheta do Acaso; shared by shop and inventory cards. |
| `reveal-crystal` (1) | Faceted crystal | `src/assets/rng/ruins/reveal/crystal.webp` | Legacy standalone crystal preview in the development icon atelier; real title reveals use their rarity-specific art. |
| `relic-solar-clock` | Antique iron clock | `src/assets/rng/ruins/relics/solar-clock.webp` | Relógio da Vigília; shop, inventory and equipment slot. |
| `relic-lunar-clock` | Antique moon-phase clock | `src/assets/rng/ruins/relics/lunar-clock.webp` | Relógio das Horas Mortas; shop, inventory and equipment slot. |
| `relic-astrolabe` | Navigation instrument | `src/assets/rng/ruins/relics/astrolabe.webp` | Astrolábio de Ferro; shop, inventory and equipment slot. |
| `relic-twin-core` | Paired mechanical core | `src/assets/rng/ruins/relics/twin-core.webp` | Coração em Par; random find, inventory and equipment slot. |
| `relic-echo-spring` | Mechanical spring | `src/assets/rng/ruins/relics/echo-spring.webp` | Mola de Eco; shop, inventory and equipment slot. |
| `relic-fragment-pouch` | Fragment pouch | `src/assets/rng/ruins/relics/fragment-pouch.webp` | Bolsa de Fragmentos; shop, inventory and equipment slot. |
| `relic-lucky-feather` | Feather relic | `src/assets/rng/ruins/relics/lucky-feather.webp` | Pena do Acaso; random find, inventory and equipment slot. |
| `relic-loose-gear` | Worn iron gear | `src/assets/rng/ruins/relics/loose-gear.webp` | Engrenagem Solta; random find, inventory and equipment slot. |
| `relic-torn-pouch` | Patched pouch | `src/assets/rng/ruins/relics/torn-pouch.webp` | Bolsa Remendada; random find, inventory and equipment slot. |
| `relic-rain-comet` | Falling mineral shard | `src/assets/rng/ruins/relics/rain-comet.webp` | Estilhaço da Queda; event reward, inventory and equipment slot. |
| `relic-new-moon-seal` | Wax/iron seal | `src/assets/rng/ruins/relics/new-moon-seal.webp` | Selo das Horas Mortas; event reward, inventory and equipment slot. |
| `relic-eclipse-prism` | Onyx prism | `src/assets/rng/ruins/relics/eclipse-prism.webp` | Prisma de Ônix; event reward, inventory and equipment slot. |
| `relic-cartographers-medal` | Tarnished medal | `src/assets/rng/ruins/relics/cartographers-medal.webp` | Medalha do Cartógrafo; achievement reward, inventory and equipment slot. |
| `relic-atlas-of-possibilities` | Lost archive/book | `src/assets/rng/ruins/relics/atlas-of-possibilities.webp` | Atlas das Rotas Perdidas; achievement reward, inventory and equipment slot. |

The 36 existing WebPs under `src/assets/rng/{tiers,events,interface,sets,shop,relics,reveal}` are preserved as the rollback set. New AI-generated source PNGs are kept outside the app under the local Codex generated-images directory; the app uses separate 512 × 512 transparent WebP derivatives under `src/assets/rng/ruins/`. No online stock art or new runtime dependency is used.

## Vector symbols

All 36 game illustrations are raster assets. The art direction uses charcoal, obsidian, blackened iron, tarnished silver, and restrained dried-wine details; it preserves each object's original silhouette and material identity instead of turning every object into a crystal. Collection/history row marks stay static at small sizes; the rarity-specific reveal keeps its entrance, subdued masked reflection, restrained particles, and tier pacing. The 8 achievement-category marks remain compact line drawings in `vectorMarks`. Visual assets are separate from gameplay data and cannot change odds or rewards.

## Adding or replacing art

For a new icon, use a square 512 × 512 image, WebP or PNG with genuine alpha transparency, one centered subject, generous padding, and a silhouette that reads at 24–48 px. Use the matching current asset as the shape reference; describe the dark material palette in text so a shared style image cannot overwrite that object's silhouette. Preserve alpha when exporting. Avoid embedded halos and glows; the reveal adds its own restrained lighting.

Add a definition to `illustratedAssets` or `relics` in `src/rng-icons.js` with its stable ID, Portuguese visible label, default rarity, animation choice, and path under `src/assets/rng/ruins/`. Use `window.NTCRngIcons.render(id, { size, animation })` in the relevant renderer. For a new rarity, add its WebP under `ruins/tiers/` and keep `TIERS` ordering in sync. The app packaging rule already includes `src/**`.

The supported motion names are `none`, `hover`, `entry`, `float`, `pulse`, `glow`, `sparkle`, `rotate`, `reveal`, and `legendary`. `window.NTCRngIcons.play(element, name, { loop: true })` is available for an explicitly requested continuous effect; no catalog art starts an indefinite loop by default. Use `cancel(element)` when replacing or leaving a preview. Programmatic motion respects the app's RNG motion setting and `prefers-reduced-motion`; the development-only icon lab can preview every category, event, set, product, relic, and rarity and force an effect for deliberate testing. The registry uses CSS/Web Animations API only.

## Generated-art direction and subject prompts

Shared direction for new generated icons: “Repaint this existing game icon; preserve its exact recognizable object, silhouette, number of parts, proportions, orientation and placement. Transparent alpha. Dark gothic, decadent, ritualistic cursed relic; matte charcoal, obsidian, aged stone, smoked glass or worn leather as appropriate; blackened iron, sparse tarnished silver and nearly invisible dried-wine details. Low-key light; no neon, saturated violet/blue, gold, bronze, cosmic scenery, text, frame, background, circle or extra objects. Centered premium game-inventory illustration, crisp at small UI scale.”

The subject-specific briefs used for this set were:

- Tiers: preserve the original silhouettes while changing the material finish; each remains visually distinct from Básico through Além do NTC.
- Events: Noite do Acaso (dark rain vessel), Noite sem Alvorecer (eclipse relic), Ritual dos Selos (old ritual instrument), and Queda de Cinzas (descending mineral fragments).
- Interface: Coleção is an iron-bound archive; Histórico is a worn chronicle/timepiece.
- Sets: Relógios da Penitência combines two distinct antique timepieces; Ecos uses paired relic cores with quiet afterimages.
- Store: Sorte Maculada is an ascending sealed charm; Tônico do Acaso is an old dark-glass vial; Ampulheta do Acaso uses black iron, smoke-dark glass and ash-like sand.
- Relic objects: preserve each source silhouette—two antique clocks, an astrolabe, paired mechanical core, spring, two distinct pouches, feather, gear, falling shard, wax seal, onyx prism, cartographer's medal, and a closed lost atlas.

## Testing

Use the development **Ateliê de títulos → Ateliê de ícones** to pick any registered tier, category, event, set, shop product, relic, or the legacy reveal crystal and preview a static, entrance, hover-style, or one-shot animation. The “Repetir efeito contínuo” option is intentionally opt-in. Also verify an actual new-title reveal, an achievement notification, locked/unlocked icon states, keyboard focus, and the reduced/off motion settings. Never use the development icon lab to grant gameplay rewards as part of visual tests.
