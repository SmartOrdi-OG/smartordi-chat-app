// Symptom picker body figures (patient.html's "Grund für den Besuch" modal)
// -- real user request (2026-08-14, with a reference "pain infographic"
// stock image for style/proportions only, not reproduced verbatim): split
// the single generic figure into three body types (adult male, adult
// female, child) with front + back views, still built from clickable
// SVG regions (unchanged from before -- no red dots, no printed labels).
//
// Restyled 2026-08-16 (real user request, after reviewing 5 visual
// directions mocked up side by side): from a skin-tone-gradient, organic-
// silhouette look to a plain clinical line-art outline -- no fill/skin
// color at all, just a thin stroke, with a region only ever getting color
// on hover/selected (see patient.html's .body-part CSS). Same reasoning
// the mockup itself gave: this patient base speaks German/Arabic/Turkish/
// Bosnian and spans every age/skin tone, and the outline style (the same
// one real symptom-checker apps like Ada/Buoy use) sidesteps any of that
// entirely instead of picking one skin tone to draw. Every path's `d`
// shape data is UNCHANGED from before this restyle -- only how each shape
// is filled/stroked changed, so the male/female/child proportion
// differences (the whole point of the earlier 3-figure split) are exactly
// as they were.
//
// Every variant below defines the EXACT SAME data-region names as the
// original single figure did (kopf/gesicht/hals/nacken/brust/bauch/becken/
// arme/haende/beine/fuesse for front, kopf/nacken/ruecken/arme/haende/
// beine/fuesse for back) -- SYMPTOM_REGIONS, toggleRegion(), and the rest
// of the symptom-picking logic in patient.html need zero changes; only
// which markup gets injected into #bodyFrontView/#bodyBackView changes.
//
// "male" reuses the exact path data the app already shipped with (proven,
// unchanged proportions) -- only "female" (narrower shoulders, a real
// nipped waist, flared hips, a simple hair silhouette) and "child" (much
// larger head-to-body ratio, a short neck, a rounded belly, shorter limbs,
// its own shorter viewBox) are new. A first pass at female/child kept the
// same general proportions as the male figure with only small numeric
// tweaks -- checked with real Playwright screenshots, and the differences
// were too subtle to actually read as a different body type at a glance,
// so the numbers below are deliberately exaggerated well past
// "anatomically conservative" to stay unmistakable at the modal's small
// render size. Now that there's no skin tone/fill to also help tell the
// figures apart, this proportion exaggeration is doing ALL of the work --
// left as-is rather than softened, on purpose.
const BODY_FIGURES = {
  male: {
    viewBox: '0 0 200 340',
    front: `
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="30" rx="15" ry="19"></ellipse>
      <ellipse class="body-part" data-region="gesicht" onclick="toggleRegion('gesicht')" cx="100" cy="34" rx="9" ry="11"></ellipse>
      <path class="body-part" data-region="hals" onclick="toggleRegion('hals')" d="M94,49 L106,49 L109,64 L91,64 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M42,86 Q48,68 100,66 Q152,68 158,86 Q145,93 100,93 Q55,93 42,86 Z"></path>
      <path class="body-part" data-region="brust" onclick="toggleRegion('brust')" d="M64,90 C61,108 62,126 68,140 L132,140 C138,126 139,108 136,90 C136,90 118,98 100,98 C82,98 64,90 64,90 Z"></path>
      <path class="body-part" data-region="bauch" onclick="toggleRegion('bauch')" d="M68,140 C66,152 66,164 70,176 L130,176 C134,164 134,152 132,140 Z"></path>
      <path class="body-part" data-region="becken" onclick="toggleRegion('becken')" d="M70,176 C68,187 70,198 78,208 L122,208 C130,198 132,187 130,176 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M36,88 C28,108 25,135 27,162 C28,178 31,190 35,200 L51,198 C48,185 46,170 46,150 C46,126 49,104 55,90 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M164,88 C172,108 175,135 173,162 C172,178 169,190 165,200 L149,198 C152,185 154,170 154,150 C154,126 151,104 145,90 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="41" cy="207" rx="13" ry="11"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="159" cy="207" rx="13" ry="11"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M78,208 C74,225 72,250 74,275 C75,290 77,300 80,308 L96,308 C94,296 93,282 93,265 C93,245 92,225 94,210 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M122,208 C126,225 128,250 126,275 C125,290 123,300 120,308 L104,308 C106,296 107,282 107,265 C107,245 108,225 106,210 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="84" cy="316" rx="15" ry="9"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="116" cy="316" rx="15" ry="9"></ellipse>
    `,
    back: `
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="30" rx="15" ry="19"></ellipse>
      <path fill="none" stroke="var(--text)" stroke-width="1.5" d="M94,49 L106,49 L109,68 L91,68 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M42,86 Q48,68 100,66 Q152,68 158,86 Q145,93 100,93 Q55,93 42,86 Z"></path>
      <path class="body-part" data-region="ruecken" onclick="toggleRegion('ruecken')" d="M64,90 C60,110 60,140 62,170 C63,190 66,205 72,215 L128,215 C134,205 137,190 138,170 C140,140 140,110 136,90 C136,90 118,98 100,98 C82,98 64,90 64,90 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M36,88 C28,108 25,135 27,162 C28,178 31,190 35,200 L51,198 C48,185 46,170 46,150 C46,126 49,104 55,90 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M164,88 C172,108 175,135 173,162 C172,178 169,190 165,200 L149,198 C152,185 154,170 154,150 C154,126 151,104 145,90 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="41" cy="207" rx="13" ry="11"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="159" cy="207" rx="13" ry="11"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M78,208 C74,225 72,250 74,275 C75,290 77,300 80,308 L96,308 C94,296 93,282 93,265 C93,245 92,225 94,210 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M122,208 C126,225 128,250 126,275 C125,290 123,300 120,308 L104,308 C106,296 107,282 107,265 C107,245 108,225 106,210 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="84" cy="316" rx="15" ry="9"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="116" cy="316" rx="15" ry="9"></ellipse>
    `,
  },
  female: {
    viewBox: '0 0 200 340',
    front: `
      <!-- Simple crescent-shaped fringe/cap sitting on top of the head --
           the old shape (a longer flowing side-lock silhouette, drawn to
           read as hair when filled solid brown) looked like a stray loop/
           antenna once it had no fill color to unify it into "hair" at a
           glance; a plain crescent avoids that risk entirely while still
           reading clearly as hair against the bare kopf ellipse below it. -->
      <path fill="white" stroke="var(--text)" stroke-width="1.5" d="M84,23 Q100,4 116,23 Q100,15 84,23 Z"></path>
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="31" rx="14" ry="18"></ellipse>
      <ellipse class="body-part" data-region="gesicht" onclick="toggleRegion('gesicht')" cx="100" cy="35" rx="8.5" ry="10.5"></ellipse>
      <path class="body-part" data-region="hals" onclick="toggleRegion('hals')" d="M95,49 L105,49 L107,62 L93,62 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M58,84 Q63,68 100,66 Q137,68 142,84 Q130,90 100,90 Q70,90 58,84 Z"></path>
      <path class="body-part" data-region="brust" onclick="toggleRegion('brust')" d="M72,88 C68,100 70,112 82,120 L118,120 C130,112 132,100 128,88 C128,88 115,96 100,96 C85,96 72,88 72,88 Z"></path>
      <path class="body-part" data-region="bauch" onclick="toggleRegion('bauch')" d="M82,120 C76,128 74,138 78,148 L122,148 C126,138 124,128 118,120 Z"></path>
      <path class="body-part" data-region="becken" onclick="toggleRegion('becken')" d="M78,148 C70,158 66,170 70,182 C72,186 128,186 130,182 C134,170 130,158 122,148 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M46,86 C38,104 35,128 37,152 C38,168 41,182 45,193 L60,190 C57,178 55,164 55,146 C55,124 57,104 63,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M154,86 C162,104 165,128 163,152 C162,168 159,182 155,193 L140,190 C143,178 145,164 145,146 C145,124 143,104 137,88 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="42" cy="197" rx="12" ry="10"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="158" cy="197" rx="12" ry="10"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M76,183 C72,202 70,230 72,258 C73,276 76,290 80,301 L95,301 C92,288 91,272 91,253 C91,231 90,208 92,185 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M124,183 C128,202 130,230 128,258 C127,276 124,290 120,301 L105,301 C108,288 109,272 109,253 C109,231 110,208 108,185 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="85" cy="309" rx="14" ry="8.5"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="115" cy="309" rx="14" ry="8.5"></ellipse>
    `,
    back: `
      <path fill="white" stroke="var(--text)" stroke-width="1.5" d="M84,23 Q100,4 116,23 Q100,15 84,23 Z"></path>
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="31" rx="14" ry="18"></ellipse>
      <path fill="none" stroke="var(--text)" stroke-width="1.5" d="M95,49 L105,49 L107,64 L93,64 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M58,84 Q63,68 100,66 Q137,68 142,84 Q130,90 100,90 Q70,90 58,84 Z"></path>
      <path class="body-part" data-region="ruecken" onclick="toggleRegion('ruecken')" d="M72,88 C67,102 68,114 78,124 C70,134 66,148 70,162 C73,176 76,192 82,204 L118,204 C124,192 127,176 130,162 C134,148 130,134 122,124 C132,114 133,102 128,88 C128,88 115,96 100,96 C85,96 72,88 72,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M46,86 C38,104 35,128 37,152 C38,168 41,182 45,193 L60,190 C57,178 55,164 55,146 C55,124 57,104 63,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M154,86 C162,104 165,128 163,152 C162,168 159,182 155,193 L140,190 C143,178 145,164 145,146 C145,124 143,104 137,88 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="42" cy="197" rx="12" ry="10"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="158" cy="197" rx="12" ry="10"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M76,183 C72,202 70,230 72,258 C73,276 76,290 80,301 L95,301 C92,288 91,272 91,253 C91,231 90,208 92,185 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M124,183 C128,202 130,230 128,258 C127,276 124,290 120,301 L105,301 C108,288 109,272 109,253 C109,231 110,208 108,185 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="85" cy="309" rx="14" ry="8.5"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="115" cy="309" rx="14" ry="8.5"></ellipse>
    `,
  },
  child: {
    // Shorter viewBox (250 vs the adults' 340) -- a child figure drawn with
    // realistically shorter proportions inside the SAME 340-tall box would
    // leave a lot of dead space above/below it once rendered at the same
    // container width; a dedicated shorter viewBox lets it actually fill
    // its own frame at a comfortable, still-tappable size instead.
    viewBox: '0 0 200 250',
    front: `
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="38" rx="26" ry="28"></ellipse>
      <ellipse class="body-part" data-region="gesicht" onclick="toggleRegion('gesicht')" cx="100" cy="42" rx="15" ry="16"></ellipse>
      <path class="body-part" data-region="hals" onclick="toggleRegion('hals')" d="M93,64 L107,64 L108,70 L92,70 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M58,86 Q62,76 100,74 Q138,76 142,86 Q132,90 100,90 Q68,90 58,86 Z"></path>
      <path class="body-part" data-region="brust" onclick="toggleRegion('brust')" d="M66,88 C64,98 64,106 68,114 L132,114 C136,106 136,98 134,88 C134,88 116,94 100,94 C84,94 66,88 66,88 Z"></path>
      <path class="body-part" data-region="bauch" onclick="toggleRegion('bauch')" d="M68,114 C60,128 60,142 70,152 C80,158 120,158 130,152 C140,142 140,128 132,114 Z"></path>
      <path class="body-part" data-region="becken" onclick="toggleRegion('becken')" d="M70,152 C68,158 70,164 76,170 L124,170 C130,164 132,158 130,152 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M52,88 C46,100 44,114 46,128 C47,136 49,142 52,147 L64,145 C62,136 60,128 60,116 C60,102 62,92 66,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M148,88 C154,100 156,114 154,128 C153,136 151,142 148,147 L136,145 C138,136 140,128 140,116 C140,102 138,92 134,88 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="49" cy="150" rx="10" ry="9"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="151" cy="150" rx="10" ry="9"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M76,170 C73,182 72,194 74,206 C75,213 76,218 78,221 L90,221 C89,214 88,206 88,197 C88,187 87,178 88,172 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M124,170 C127,182 128,194 126,206 C125,213 124,218 122,221 L110,221 C111,214 112,206 112,197 C112,187 113,178 112,172 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="82" cy="227" rx="12" ry="7"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="118" cy="227" rx="12" ry="7"></ellipse>
    `,
    back: `
      <ellipse class="body-part" data-region="kopf" onclick="toggleRegion('kopf')" cx="100" cy="38" rx="26" ry="28"></ellipse>
      <path fill="none" stroke="var(--text)" stroke-width="1.5" d="M93,64 L107,64 L108,72 L92,72 Z"></path>
      <path class="body-part" data-region="nacken" onclick="toggleRegion('nacken')" d="M58,86 Q62,76 100,74 Q138,76 142,86 Q132,90 100,90 Q68,90 58,86 Z"></path>
      <path class="body-part" data-region="ruecken" onclick="toggleRegion('ruecken')" d="M66,88 C62,100 62,112 68,122 C60,134 60,146 70,156 C80,162 120,162 130,156 C140,146 140,134 132,122 C138,112 138,100 134,88 C134,88 116,94 100,94 C84,94 66,88 66,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M52,88 C46,100 44,114 46,128 C47,136 49,142 52,147 L64,145 C62,136 60,128 60,116 C60,102 62,92 66,88 Z"></path>
      <path class="body-part" data-region="arme" onclick="toggleRegion('arme')" d="M148,88 C154,100 156,114 154,128 C153,136 151,142 148,147 L136,145 C138,136 140,128 140,116 C140,102 138,92 134,88 Z"></path>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="49" cy="150" rx="10" ry="9"></ellipse>
      <ellipse class="body-part" data-region="haende" onclick="toggleRegion('haende')" cx="151" cy="150" rx="10" ry="9"></ellipse>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M76,170 C73,182 72,194 74,206 C75,213 76,218 78,221 L90,221 C89,214 88,206 88,197 C88,187 87,178 88,172 Z"></path>
      <path class="body-part" data-region="beine" onclick="toggleRegion('beine')" d="M124,170 C127,182 128,194 126,206 C125,213 124,218 122,221 L110,221 C111,214 112,206 112,197 C112,187 113,178 112,172 Z"></path>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="82" cy="227" rx="12" ry="7"></ellipse>
      <ellipse class="body-part" data-region="fuesse" onclick="toggleRegion('fuesse')" cx="118" cy="227" rx="12" ry="7"></ellipse>
    `,
  },
};
